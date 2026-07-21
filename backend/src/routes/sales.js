import { Router } from "express";
import { prisma } from "../db.js";
import { currentCompanyId } from "../tenant.js";
import { paymentCost, computeSaleCosts, buildTariffLookup } from "../services/costs.js";
import { nextInvoiceNumber, buildInvoiceDoc, discriminateTax } from "../services/invoice.js";
import { toWorkbook, sendXlsx } from "../services/excel.js";
import { auth, actor } from "../auth.js";
import { ensureOpenShift } from "./shifts.js";
import { refreshAfterSaleChange, refreshDailyClosingIfExists } from "../services/consistency.js";
import { permsForRole } from "../permissions.js";

const router = Router();

const normalizePlate = (v) => String(v || "").trim().toUpperCase().replace(/\s+/g, "");
const MOTO_PLATE_RE = /^[A-Z]{3}\d{2}[A-Z]$/;
const PIN_RE = /^\d{19,20}$/; // SICOV: 19 o 20 digitos

function rangeFromModel(year) {
  const y = Number(year) || 0;
  if (y >= 2024) return "MOTOCICLETAS 2024-2026";
  if (y >= 2019) return "MOTOCICLETAS 2019-2023";
  if (y >= 2010) return "MOTOCICLETAS 2010-2018";
  return "MOTOCICLETAS 2009-ANTES";
}

// Construye las lineas fiscales a partir del paquete RTM (precios IVA-incluido).
async function buildLines(packageCode) {
  const comps = await prisma.packageComponent.findMany({ where: { packageCode } });
  if (!comps.length) return [];
  const prods = await prisma.product.findMany({ where: { code: { in: comps.map((c) => c.productCode) } } });
  const byCode = Object.fromEntries(prods.map((p) => [p.code, p]));
  return comps.map((c) => {
    const p = byCode[c.productCode];
    const unitPrice = c.priceOverride ?? p.unitPrice;
    const rate = (p.taxRate || 0) / 100;
    const baseUnit = Math.round(unitPrice / (1 + rate));
    const taxUnit = unitPrice - baseUnit;
    const qty = c.quantity || 1;
    return {
      productCode: p.code,
      description: p.name,
      quantity: qty,
      unitPrice,
      taxRate: p.taxRate || 0,
      base: baseUnit * qty,
      tax: taxUnit * qty,
      total: unitPrice * qty
    };
  });
}

async function nextSaleNumber() {
  const count = await prisma.sale.count();
  return `VTA-${String(count + 1).padStart(6, "0")}`;
}

// Tarifas vigentes para un tipo de vehiculo a una fecha.
async function tariffsFor(vehicleType, date) {
  const rows = await prisma.tariff.findMany({ where: { vehicleType, active: true } });
  return buildTariffLookup(rows, date);
}

// Motor de cálculo de una venta (lineas, totales, estado RTM, pagos+costos, provisión,
// cartera y facturación). NO escribe nada: valida y lanza Error con .status si algo no
// cuadra. Lo usan tanto crear (POST) como editar-recalculando (PUT). `excludeSaleId`
// evita que el chequeo de PIN duplicado choque con la propia venta al editar.
async function computeSaleFinancials(b, { excludeSaleId = null } = {}) {
  const v = b.vehicle || {};
  const plate = normalizePlate(v.plate);
  const modelYear = Number(v.modelYear) || null;
  const vehicleType = v.vehicleType || "MOTO";
  const rangeName = v.rangeName || (modelYear ? rangeFromModel(modelYear) : null);
  if (vehicleType === "MOTO" && plate && !MOTO_PLATE_RE.test(plate)) {
    throw Object.assign(new Error("La placa de moto debe tener formato AAA00A (3 letras, 2 numeros y 1 letra)"), { status: 400 });
  }

  // Lineas + totales.
  const lines = b.packageCode ? await buildLines(b.packageCode) : [];
  const totalBase = lines.reduce((s, l) => s + l.base, 0);
  const totalIva = lines.reduce((s, l) => s + l.tax, 0);
  const total = lines.reduce((s, l) => s + l.total, 0);

  // Estado RTM y PIN.
  const rtmAlreadyPaid = !!b.rtmAlreadyPaid;
  const rtmToday = b.rtmToday !== false; // por defecto se realiza hoy
  const rtmStatus = rtmAlreadyPaid ? (rtmToday ? "paid_done" : "paid_not_done") : (rtmToday ? "done" : "pending");
  const pinAdquirido = rtmToday ? 1 : 0;
  const pinNumber = String(b.pinNumber || "").trim();
  if (rtmToday && !PIN_RE.test(pinNumber)) {
    throw Object.assign(new Error("El PIN es obligatorio cuando la RTM se realiza hoy y debe tener 19 o 20 digitos numericos"), { status: 400 });
  }
  if (pinNumber) {
    const dupPin = await prisma.sale.findFirst({
      where: { pinNumber, status: "activa", ...(excludeSaleId ? { id: { not: excludeSaleId } } : {}) },
      select: { saleNumber: true, plate: true, saleDate: true }
    });
    if (dupPin) throw Object.assign(new Error(`Ese PIN ya está registrado en la venta ${dupPin.saleNumber} (placa ${dupPin.plate || "-"}, ${dupPin.saleDate}). El PIN no se puede repetir.`), { status: 409 });
  }

  // Convenio / comision (DEDUCCIONES CONVENIOS).
  const allyName = b.ally?.name || "USUARIO";
  const allyType = b.ally?.type || (allyName.toUpperCase() === "USUARIO" ? "usuario" : "referido");
  const discountApplied = allyType === "usuario" ? false : (b.ally?.discountApplied !== false);
  const ally = await prisma.ally.findFirst({ where: { name: allyName } });
  const baseCommission = ally?.commission ?? (allyType === "usuario" ? 20000 : 40000);
  const hasFenix = (b.payments || []).some((p) => p && p.methodCode === "DESCUENTO_FENIX" && Number(p.amount) > 0);
  if (hasFenix && allyType !== "usuario") {
    throw Object.assign(new Error("El cupón/descuento solo aplica a clientes directos, no a referidos."), { status: 400 });
  }
  const deduction = hasFenix ? 0 : (discountApplied ? baseCommission : 0);

  // Pagos (mixtos) + costo de transaccion congelado por pago.
  const methods = await prisma.paymentMethod.findMany();
  const methodByCode = Object.fromEntries(methods.map((m) => [m.code, m]));
  const payments = (b.payments || [])
    .filter((p) => p && p.methodCode && Number(p.amount) > 0)
    .map((p) => {
      const m = methodByCode[p.methodCode];
      if (!m) throw Object.assign(new Error(`Metodo de pago desconocido: ${p.methodCode}`), { status: 400 });
      const cost = paymentCost(m, p.amount);
      return { methodCode: m.code, methodName: m.name, groupCode: m.groupCode, amount: Math.round(Number(p.amount)), costType: cost.costType, costAmount: cost.costAmount, costTax: cost.costTax, _method: m };
    });

  const hasSupergiros = payments.some((p) => p._method.groupCode === "SG");
  if (hasSupergiros && !rtmToday) {
    throw Object.assign(new Error("Si el pago es por SuperGiros (Datáfono SG / QR SG), la RTM no puede quedar pendiente: debe realizarse hoy con su PIN."), { status: 400 });
  }

  const paidAmount = payments.reduce((s, p) => s + p.amount, 0);
  const cashPaid = payments.filter((p) => p.methodCode === "EFECTIVO").reduce((s, p) => s + p.amount, 0);
  if (!rtmAlreadyPaid && paidAmount < total) throw Object.assign(new Error("El pago no cubre el total de la venta"), { status: 400 });
  if (paidAmount - cashPaid > total) throw Object.assign(new Error("Los pagos distintos a efectivo no pueden superar el total"), { status: 400 });
  const changeAmount = Math.max(0, paidAmount - total);

  // Facturacion: ADDI/GORA siempre facturan; o el usuario pidio facturar.
  const forcedDian = payments.some((p) => p._method.facturaDian);
  const facturada = !!b.facturar || forcedDian;

  // Costos congelados (tarifas por tipo de vehiculo y vigencia).
  const saleDate0 = b.date || new Date().toISOString().slice(0, 10);
  const tariffs = await tariffsFor(vehicleType, saleDate0);
  const costs = computeSaleCosts({ tariffs, pinAdquirido, modelYear, facturada, payments });

  // Provision (RTM pendiente) y cartera (ADDI/GORA/credito).
  const provisionAmount = rtmStatus === "pending" ? total : 0;
  const receivablePayments = payments.filter((p) => p._method.generatesReceivable);
  const receivableAmount = receivablePayments.reduce((s, p) => s + p.amount, 0);

  return {
    plate, modelYear, vehicleType, rangeName, lines, totalBase, totalIva, total,
    rtmAlreadyPaid, rtmToday, rtmStatus, pinAdquirido, pinNumber,
    allyName, allyType, discountApplied, ally, deduction,
    payments, paidAmount, changeAmount, facturada, costs,
    provisionAmount, receivablePayments, receivableAmount
  };
}

// POST /api/sales — registra la venta (siempre, se facture o no).
router.post("/", async (req, res, next) => {
  try {
    const b = req.body || {};
    const c = b.client || {};
    const v = b.vehicle || {};
    if (!c.docNumber || !c.name) return res.status(400).json({ error: "Cliente (docNumber, name) obligatorio" });

    // Facturar con fecha de un dia anterior requiere permiso (admin o rol con canBackdate).
    const today = new Date().toISOString().slice(0, 10);
    if (b.date && String(b.date).slice(0, 10) !== today) {
      const perms = await permsForRole(req.user?.role);
      if (!perms.canBackdate) {
        return res.status(403).json({ error: "No tienes permiso para facturar con fecha de un día anterior." });
      }
    }

    // Turnos invisibles: si no hay turno abierto se abre uno AUTOMATICO (el usuario no
    // gestiona turnos). La venta queda atada a ese turno igual que antes.
    const shift = await ensureOpenShift({ openedBy: req.user?.name || req.user?.username || null });
    if (!shift) return res.status(500).json({ error: "No se pudo iniciar el turno automático" });

    // 1) Cliente y moto (upsert / find-or-create, sin FK).
    // En update solo se tocan los campos que vienen en la venta: no se pisan
    // telefono/email/direccion existentes con null si la venta no los reenvia.
    const clientDoc = String(c.docNumber).trim();
    await prisma.client.upsert({
      where: { companyId_docNumber: { companyId: currentCompanyId(), docNumber: clientDoc } },
      update: {
        name: c.name,
        ...(c.phone ? { phone: c.phone } : {}),
        ...(c.email ? { email: c.email } : {}),
        ...(c.address ? { address: c.address } : {}),
        ...(c.docType ? { docType: c.docType } : {})
      },
      create: { docType: c.docType || "CC", docNumber: clientDoc, name: c.name, phone: c.phone || null, email: c.email || null, address: c.address || null }
    });

    // 2-8) Motor de cálculo (mismo que usa la edición-recalculando): lineas, totales,
    // estado RTM, pagos+costos, provisión, cartera y facturación. Valida y lanza si falla.
    const fin = await computeSaleFinancials(b);
    const {
      plate, modelYear, vehicleType, rangeName, lines, totalBase, totalIva, total,
      rtmAlreadyPaid, rtmToday, rtmStatus, pinAdquirido, pinNumber,
      allyName, allyType, discountApplied, ally, deduction,
      payments, paidAmount, changeAmount, facturada, costs,
      provisionAmount, receivablePayments, receivableAmount
    } = fin;

    // Registrar la moto del cliente si es nueva.
    if (plate) {
      const existing = await prisma.vehicle.findFirst({ where: { plate, clientDoc: String(c.docNumber) } });
      if (!existing) {
        await prisma.vehicle.create({ data: { clientDoc: String(c.docNumber), plate, modelYear, rangeName, vehicleType } });
      }
    }

    const saleNumber = await nextSaleNumber();
    const invoiceNumber = facturada ? await nextInvoiceNumber(prisma) : null;
    const saleDate = b.date || shift.businessDate;

    // 9) Persistir todo en una transaccion (sin FK; referencias por saleId).
    const sale = await prisma.$transaction(async (tx) => {
      const created = await tx.sale.create({
        data: {
          saleNumber,
          saleDate,
          saleTime: b.time || new Date().toTimeString().slice(0, 8),
          shiftId: shift.id,
          clientDoc: String(c.docNumber),
          clientName: c.name,
          plate: plate || null,
          modelYear,
          rangeName,
          vehicleType,
          packageCode: b.packageCode || null,
          allyId: ally?.id ?? null,
          allyName,
          allyType,
          discountApplied,
          deduction,
          totalBase,
          totalIva,
          total,
          paidAmount,
          changeAmount,
          rtmAlreadyPaid,
          rtmToday,
          rtmStatus,
          pinAdquirido,
          pinNumber: rtmToday ? pinNumber : null,
          provisionAmount,
          receivableAmount,
          dianStatus: facturada ? "facturada" : "no_emitida",
          invoiceNumber,
          responsable: b.responsable || null,
          observaciones: b.observaciones || null,
          createdBy: actor(req)
        }
      });

      if (lines.length) {
        await tx.saleLine.createMany({ data: lines.map((l) => ({ ...l, saleId: created.id })) });
      }
      if (payments.length) {
        await tx.salePayment.createMany({
          data: payments.map(({ _method, ...p }) => ({ ...p, saleId: created.id }))
        });
      }
      await tx.saleCost.create({ data: { saleId: created.id, ...costs } });

      // Historial del cliente (bitacora): como llego (directo|referido) y si hizo RTM.
      await tx.clientHistory.create({
        data: {
          clientDoc: String(c.docNumber),
          saleId: created.id,
          plate: plate || null,
          year: Number(saleDate.slice(0, 4)) || new Date().getFullYear(),
          eventType: allyType === "usuario" ? "directo" : "referido",
          allyId: ally?.id ?? null,
          allyName,
          note: pinAdquirido > 0 ? "RTM realizada" : (rtmStatus === "pending" ? "RTM pendiente" : null)
        }
      });

      if (facturada) {
        const tax = discriminateTax(lines);
        await tx.invoice.create({
          data: { saleId: created.id, number: invoiceNumber, base: tax.base, iva: tax.iva, total: tax.total }
        });
      }

      // Provision: si la RTM queda pendiente, el dinero se aparta (caja menor -> provision RTM).
      if (rtmStatus === "pending" && provisionAmount > 0) {
        await tx.cashMovement.create({ data: { boxCode: "CAJA_MENOR", type: "egreso", amount: provisionAmount, refType: "sale", refId: created.id, date: saleDate, note: `Provision RTM ${plate || ""}`.trim() } });
        await tx.cashMovement.create({ data: { boxCode: "PROV_RTM", type: "ingreso", amount: provisionAmount, refType: "sale", refId: created.id, date: saleDate, note: `Provision RTM ${plate || ""}`.trim() } });
      }

      for (const p of receivablePayments) {
        await tx.receivable.create({
          data: {
            saleId: created.id,
            provider: p.methodName,
            clientDoc: String(c.docNumber),
            plate: plate || null,
            amount: p.amount,
            pending: p.amount,
            status: "abierta",
            dueFrom: saleDate
          }
        });
      }
      return created;
    });

    await refreshAfterSaleChange(sale);
    res.status(201).json({ sale, lines, payments: payments.map(({ _method, ...p }) => p), costs });
  } catch (e) {
    next(e);
  }
});

// POST /api/sales/:id/recompute — recalcula una venta ACTIVA cambiando método(s) de pago,
// paquete/valor, PIN y/o "RTM se realiza hoy". Reemplaza líneas, pagos, costos, provisión,
// cartera y factura, manteniendo el mismo número de venta, turno, fecha y cliente (solo admin).
router.post("/:id/recompute", auth(["admin"]), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const sale = await prisma.sale.findUnique({ where: { id } });
    if (!sale) return res.status(404).json({ error: "No existe" });
    if (sale.status === "anulada") return res.status(400).json({ error: "No se puede recalcular una venta anulada. Reactívala primero." });
    // Si la RTM pendiente ya fue realizada (provisión consumida), recalcular dejaría el
    // estado y la caja inconsistentes: se bloquea. Para cambiarla: anular y rehacer.
    if (sale.provisionConsumed) {
      return res.status(400).json({ error: "Esta venta ya tuvo su RTM realizada (provisión consumida). No se puede recalcular; anúlala y vuelve a facturarla si necesitas cambiarla." });
    }

    const bIn = req.body || {};
    // Pagos actuales de la venta (para usarlos si el request no reenvía los pagos).
    const currentPayments = await prisma.salePayment.findMany({ where: { saleId: id } });
    // Arma el input del motor mezclando lo que llega con lo que ya tiene la venta.
    const b = {
      date: sale.saleDate, // la fecha NO se cambia aquí (para eso está la edición de fecha)
      vehicle: {
        plate: bIn.vehicle?.plate ?? sale.plate,
        modelYear: bIn.vehicle?.modelYear ?? sale.modelYear,
        vehicleType: bIn.vehicle?.vehicleType ?? sale.vehicleType,
        rangeName: bIn.vehicle?.rangeName ?? sale.rangeName
      },
      packageCode: bIn.packageCode !== undefined ? bIn.packageCode : sale.packageCode,
      rtmAlreadyPaid: bIn.rtmAlreadyPaid !== undefined ? bIn.rtmAlreadyPaid : sale.rtmAlreadyPaid,
      rtmToday: bIn.rtmToday !== undefined ? bIn.rtmToday : sale.rtmToday,
      pinNumber: bIn.pinNumber !== undefined ? bIn.pinNumber : (sale.pinNumber || ""),
      ally: bIn.ally !== undefined ? bIn.ally : { name: sale.allyName, type: sale.allyType, discountApplied: sale.discountApplied },
      payments: bIn.payments !== undefined ? bIn.payments : currentPayments.map((p) => ({ methodCode: p.methodCode, amount: p.amount })),
      // Si ya estaba facturada, sigue facturada (no se des-factura al recalcular).
      facturar: bIn.facturar !== undefined ? bIn.facturar : (sale.dianStatus === "facturada")
    };

    const fin = await computeSaleFinancials(b, { excludeSaleId: id });
    const saleDate = sale.saleDate;
    // Numero de factura: si queda facturada y aun no tenia, se asigna uno nuevo; si ya
    // tenia, se conserva. (No se des-factura una venta ya emitida.)
    const willBeFacturada = fin.facturada || sale.dianStatus === "facturada";
    const invoiceNumber = sale.invoiceNumber || (willBeFacturada ? await nextInvoiceNumber(prisma) : null);

    const updated = await prisma.$transaction(async (tx) => {
      const s = await tx.sale.update({
        where: { id },
        data: {
          plate: fin.plate || null,
          modelYear: fin.modelYear,
          rangeName: fin.rangeName,
          vehicleType: fin.vehicleType,
          packageCode: b.packageCode || null,
          allyId: fin.ally?.id ?? null,
          allyName: fin.allyName,
          allyType: fin.allyType,
          discountApplied: fin.discountApplied,
          deduction: fin.deduction,
          totalBase: fin.totalBase,
          totalIva: fin.totalIva,
          total: fin.total,
          paidAmount: fin.paidAmount,
          changeAmount: fin.changeAmount,
          rtmAlreadyPaid: fin.rtmAlreadyPaid,
          rtmToday: fin.rtmToday,
          rtmStatus: fin.rtmStatus,
          pinAdquirido: fin.pinAdquirido,
          pinNumber: fin.rtmToday ? fin.pinNumber : null,
          provisionAmount: fin.provisionAmount,
          receivableAmount: fin.receivableAmount,
          dianStatus: willBeFacturada ? "facturada" : "no_emitida",
          invoiceNumber,
          // Si cambia la comisión y ya estaba pagada a un convenio, se libera el enlace.
          ...(sale.commissionPaidBy != null && fin.deduction !== sale.deduction ? { commissionPaidBy: null } : {}),
          updatedBy: actor(req)
        }
      });

      // Reemplaza los sub-registros de la venta.
      await tx.saleLine.deleteMany({ where: { saleId: id } });
      if (fin.lines.length) await tx.saleLine.createMany({ data: fin.lines.map((l) => ({ ...l, saleId: id })) });

      await tx.salePayment.deleteMany({ where: { saleId: id } });
      if (fin.payments.length) await tx.salePayment.createMany({ data: fin.payments.map(({ _method, ...p }) => ({ ...p, saleId: id })) });

      await tx.saleCost.deleteMany({ where: { saleId: id } });
      await tx.saleCost.create({ data: { saleId: id, ...fin.costs } });

      // Factura: crea si ahora corresponde y no existía; si ya existía, actualiza montos.
      if (willBeFacturada) {
        const tax = discriminateTax(fin.lines);
        const existingInv = await tx.invoice.findFirst({ where: { saleId: id } });
        if (existingInv) await tx.invoice.update({ where: { id: existingInv.id }, data: { base: tax.base, iva: tax.iva, total: tax.total } });
        else await tx.invoice.create({ data: { saleId: id, number: invoiceNumber, base: tax.base, iva: tax.iva, total: tax.total } });
      }

      // Provisión: borra los movimientos de la venta y recrea si la RTM queda pendiente.
      await tx.cashMovement.deleteMany({ where: { refType: "sale", refId: id } });
      if (fin.rtmStatus === "pending" && fin.provisionAmount > 0) {
        await tx.cashMovement.create({ data: { boxCode: "CAJA_MENOR", type: "egreso", amount: fin.provisionAmount, refType: "sale", refId: id, date: saleDate, note: `Provision RTM ${fin.plate || ""}`.trim() } });
        await tx.cashMovement.create({ data: { boxCode: "PROV_RTM", type: "ingreso", amount: fin.provisionAmount, refType: "sale", refId: id, date: saleDate, note: `Provision RTM ${fin.plate || ""}`.trim() } });
      }

      // Cartera: borra la anterior y recrea según los nuevos pagos con crédito.
      await tx.receivable.deleteMany({ where: { saleId: id } });
      for (const p of fin.receivablePayments) {
        await tx.receivable.create({ data: { saleId: id, provider: p.methodName, clientDoc: sale.clientDoc, plate: fin.plate || null, amount: p.amount, pending: p.amount, status: "abierta", dueFrom: saleDate } });
      }

      // Historial del cliente: actualiza tipo (directo/referido) y nota (RTM).
      await tx.clientHistory.updateMany({
        where: { saleId: id },
        data: {
          plate: fin.plate || null,
          eventType: fin.allyType === "usuario" ? "directo" : "referido",
          allyId: fin.ally?.id ?? null,
          allyName: fin.allyName,
          note: fin.pinAdquirido > 0 ? "RTM realizada" : (fin.rtmStatus === "pending" ? "RTM pendiente" : null)
        }
      });
      return s;
    });

    await refreshAfterSaleChange(updated);
    res.json({ sale: updated });
  } catch (e) {
    next(e);
  }
});

// POST /api/sales/:id/void — anula la venta (no se borra) + reversa + cancela cartera.
router.post("/:id/void", auth(["admin"]), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const sale = await prisma.sale.findUnique({ where: { id } });
    if (!sale) return res.status(404).json({ error: "No existe" });
    if (sale.status === "anulada") return res.json({ alreadyVoided: true, sale });
    const updated = await prisma.$transaction(async (tx) => {
      const s = await tx.sale.update({ where: { id }, data: { status: "anulada", updatedBy: actor(req) } });
      await tx.reversal.create({
        data: { saleId: id, saleNumber: sale.saleNumber, reason: req.body?.reason || null, authorizedBy: req.body?.authorizedBy || null }
      });
      await tx.receivable.updateMany({ where: { saleId: id, status: "abierta" }, data: { status: "anulada", pending: 0 } });
      const movements = await tx.cashMovement.findMany({ where: { refType: "sale", refId: id } });
      for (const m of movements) {
        await tx.cashMovement.create({
          data: {
            boxCode: m.boxCode,
            type: m.type === "ingreso" ? "egreso" : "ingreso",
            amount: m.amount,
            refType: "sale_void",
            refId: id,
            date: new Date().toISOString().slice(0, 10),
            note: `Anula venta ${sale.saleNumber}${m.note ? `: ${m.note}` : ""}`
          }
        });
      }
      return s;
    });
    await refreshAfterSaleChange(sale);
    res.json({ sale: updated });
  } catch (e) {
    next(e);
  }
});

// POST /api/sales/:id/reactivate — des-anula una venta anulada (revierte la anulación).
router.post("/:id/reactivate", auth(["admin"]), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const sale = await prisma.sale.findUnique({ where: { id } });
    if (!sale) return res.status(404).json({ error: "No existe" });
    if (sale.status !== "anulada") return res.json({ alreadyActive: true, sale });
    // Conflicto de PIN: si otra venta activa ya usa este PIN, no se puede reactivar.
    if (sale.pinNumber) {
      const dup = await prisma.sale.findFirst({ where: { pinNumber: sale.pinNumber, status: "activa", id: { not: id } }, select: { saleNumber: true, plate: true } });
      if (dup) return res.status(409).json({ error: `No se puede reactivar: el PIN ya lo usa la venta activa ${dup.saleNumber} (placa ${dup.plate || "-"}).` });
    }
    const updated = await prisma.$transaction(async (tx) => {
      const s = await tx.sale.update({ where: { id }, data: { status: "activa", updatedBy: actor(req) } });
      // 1) Quita el registro de reversa (la anulación).
      await tx.reversal.deleteMany({ where: { saleId: id } });
      // 2) Restaura las carteras que la anulación cerró: pending = monto − abonos.
      const receivables = await tx.receivable.findMany({ where: { saleId: id, status: "anulada" } });
      for (const r of receivables) {
        const pays = await tx.receivablePayment.findMany({ where: { receivableId: r.id } });
        const paid = pays.reduce((a, p) => a + (p.amount || 0), 0);
        const pending = Math.max(0, (r.amount || 0) - paid);
        await tx.receivable.update({ where: { id: r.id }, data: { status: pending > 0 ? "abierta" : "pagada", pending } });
      }
      // 3) Elimina los movimientos de caja compensatorios que creó la anulación.
      await tx.cashMovement.deleteMany({ where: { refType: "sale_void", refId: id } });
      return s;
    });
    await refreshAfterSaleChange(updated);
    res.json({ sale: updated });
  } catch (e) {
    next(e);
  }
});

// GET /api/sales?date=&clientDoc=&plate=&range=&shiftId=&status=
router.get("/", async (req, res, next) => {
  try {
    const { date, clientDoc, plate, range, shiftId } = req.query;
    const where = {};
    if (date) where.saleDate = String(date);
    if (clientDoc) where.clientDoc = String(clientDoc);
    if (plate) where.plate = normalizePlate(plate);
    if (range) where.rangeName = String(range);
    if (shiftId) where.shiftId = Number(shiftId);
    const items = await prisma.sale.findMany({ where, orderBy: { id: "desc" }, take: 500 });
    // Adjunta el resumen de medios de pago por venta (por donde se pago).
    const ids = items.map((s) => s.id);
    const pays = ids.length ? await prisma.salePayment.findMany({ where: { saleId: { in: ids } } }) : [];
    const bySale = {};
    for (const p of pays) (bySale[p.saleId] ||= []).push({ methodName: p.methodName, methodCode: p.methodCode, groupCode: p.groupCode, amount: p.amount });
    const enriched = items.map((s) => ({
      ...s,
      payments: bySale[s.id] || [],
      methods: (bySale[s.id] || []).map((p) => `${p.methodName}: ${p.amount}`).join(" | ")
    }));
    res.json(enriched);
  } catch (e) {
    next(e);
  }
});

// GET /api/sales/export?date=&clientDoc=&plate=&range=  -> descarga las ventas en Excel.
// (Debe ir ANTES de /:id para no chocar con la ruta por id.)
router.get("/export", async (req, res, next) => {
  try {
    const { date, clientDoc, plate, range } = req.query;
    const where = {};
    if (date) where.saleDate = String(date);
    if (clientDoc) where.clientDoc = String(clientDoc);
    if (plate) where.plate = normalizePlate(plate);
    if (range) where.rangeName = String(range);
    const items = await prisma.sale.findMany({ where, orderBy: { id: "desc" }, take: 5000 });
    const ids = items.map((s) => s.id);
    const pays = ids.length ? await prisma.salePayment.findMany({ where: { saleId: { in: ids } }, orderBy: { id: "asc" } }) : [];
    const bySale = {};
    for (const p of pays) (bySale[p.saleId] ||= []).push({ methodName: p.methodName, amount: p.amount });
    // Una fila por MEDIO DE PAGO: si la venta tiene varios métodos, cada uno va en su
    // propia fila (método y valor en columnas separadas). Los datos de la venta se
    // repiten en cada fila; Base/IVA/Total solo en la primera fila de la venta para
    // no duplicar el total al sumar la columna.
    const rows = [];
    for (const s of items) {
      const sale = {
        fecha: s.saleDate, venta: s.saleNumber, factura: s.invoiceNumber || "", cliente: s.clientName, doc: s.clientDoc,
        placa: s.plate || "", modelo: s.modelYear || "", tipo: s.allyType, convenio: s.allyName || "",
        rtm: s.rtmStatus, pin: s.pinNumber || "", estado: s.status,
        registro: s.createdBy || "", modifico: s.updatedBy || ""
      };
      const ps = bySale[s.id] || [];
      if (!ps.length) {
        rows.push({ ...sale, metodo: "", valorPago: "", base: s.totalBase, iva: s.totalIva, total: s.total });
      } else {
        ps.forEach((p, i) => rows.push({
          ...sale, metodo: p.methodName, valorPago: p.amount,
          base: i === 0 ? s.totalBase : "", iva: i === 0 ? s.totalIva : "", total: i === 0 ? s.total : ""
        }));
      }
    }
    const total = items.filter((s) => s.status !== "anulada").reduce((a, s) => a + s.total, 0);
    const iva = items.filter((s) => s.status !== "anulada").reduce((a, s) => a + s.totalIva, 0);
    const buf = await toWorkbook({
      sheets: [{
        name: "Ventas", title: `Ventas${date ? " " + date : ""}`,
        columns: [
          { header: "Fecha", key: "fecha", width: 12 }, { header: "Venta", key: "venta", width: 14 },
          { header: "Factura", key: "factura", width: 14 }, { header: "Cliente", key: "cliente", width: 28 },
          { header: "Documento", key: "doc", width: 16 }, { header: "Placa", key: "placa", width: 10 },
          { header: "Modelo", key: "modelo", width: 8, number: true }, { header: "Tipo", key: "tipo", width: 10 },
          { header: "Convenio", key: "convenio", width: 22 }, { header: "RTM", key: "rtm", width: 12 },
          { header: "PIN", key: "pin", width: 22 },
          { header: "Método de pago", key: "metodo", width: 22 }, { header: "Valor pago", key: "valorPago", width: 14, money: true },
          { header: "Base", key: "base", width: 14, money: true }, { header: "IVA", key: "iva", width: 14, money: true },
          { header: "Total", key: "total", width: 14, money: true }, { header: "Estado", key: "estado", width: 10 },
          { header: "Registró", key: "registro", width: 18 }, { header: "Modificó", key: "modifico", width: 18 }
        ],
        rows, totals: { base: total - iva, iva, total }
      }]
    });
    sendXlsx(res, buf, `ventas${date ? "-" + date : ""}.xlsx`);
  } catch (e) {
    next(e);
  }
});

router.get("/:id", async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const sale = await prisma.sale.findUnique({ where: { id } });
    if (!sale) return res.status(404).json({ error: "No existe" });
    const [lines, payments, cost, receivables] = await Promise.all([
      prisma.saleLine.findMany({ where: { saleId: id } }),
      prisma.salePayment.findMany({ where: { saleId: id } }),
      prisma.saleCost.findUnique({ where: { saleId: id } }),
      prisma.receivable.findMany({ where: { saleId: id } })
    ]);
    res.json({ sale, lines, payments, cost, receivables });
  } catch (e) {
    next(e);
  }
});

// PUT /api/sales/:id — edita campos descriptivos de una venta activa (solo admin).
router.put("/:id", auth(["admin"]), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const sale = await prisma.sale.findUnique({ where: { id } });
    if (!sale) return res.status(404).json({ error: "No existe" });
    if (sale.status === "anulada") return res.status(400).json({ error: "No se puede editar una venta anulada" });

    const b = req.body || {};
    const data = {};

    if (b.clientName !== undefined) data.clientName = String(b.clientName).trim();
    if (b.plate !== undefined) data.plate = normalizePlate(b.plate) || null;
    if (b.modelYear !== undefined) data.modelYear = Number(b.modelYear) || null;
    if (b.invoiceNumber !== undefined) data.invoiceNumber = String(b.invoiceNumber).trim() || null;
    if (b.observaciones !== undefined) data.observaciones = String(b.observaciones).trim() || null;
    if (b.responsable !== undefined) data.responsable = String(b.responsable).trim() || null;

    // Cambio de fecha de la venta (día operativo). Reajusta los cálculos del día
    // viejo y del nuevo: mueve la venta, sus movimientos de caja, cartera e historial.
    const oldDate = sale.saleDate;
    let newDate = null;
    const rawDate = b.saleDate !== undefined ? b.saleDate : b.date;
    if (rawDate !== undefined && rawDate && String(rawDate).slice(0, 10) !== oldDate) {
      newDate = String(rawDate).slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(newDate) || isNaN(new Date(newDate).getTime())) {
        return res.status(400).json({ error: "La fecha de la venta no es válida (AAAA-MM-DD)." });
      }
      if (newDate > new Date().toISOString().slice(0, 10)) {
        return res.status(400).json({ error: "La fecha de la venta no puede ser futura." });
      }
      data.saleDate = newDate;
    }

    // Cambio de convenio / referido / comisión. El admin puede: poner referido,
    // cambiarlo, quitarlo (USUARIO) y activar/desactivar la comisión (deduction).
    if (b.allyName !== undefined || b.allyType !== undefined || b.discountApplied !== undefined) {
      const allyNameRaw = b.allyName !== undefined ? String(b.allyName).trim() : sale.allyName;
      const allyName = allyNameRaw || "USUARIO";
      const allyType = b.allyType !== undefined
        ? b.allyType
        : (allyName.toUpperCase() === "USUARIO" ? "usuario" : "referido");
      // Venta directa (usuario): nunca deduccion automatica (solo via cupon). Referido: segun flag.
      const discountApplied = allyType === "usuario"
        ? false
        : (b.discountApplied !== undefined ? !!b.discountApplied : sale.discountApplied);
      const ally = await prisma.ally.findFirst({ where: { name: allyName } });
      const baseCommission = ally?.commission ?? (allyType === "usuario" ? 20000 : 40000);
      data.allyName = allyName;
      data.allyType = allyType;
      data.allyId = ally?.id ?? null;
      data.discountApplied = discountApplied;
      data.deduction = discountApplied ? baseCommission : 0;
    }

    // Si la comisión cambia y la venta ya estaba marcada como pagada a un convenio,
    // se libera el enlace (vuelve a "pendiente") para que cuadre el nuevo monto.
    if (data.deduction !== undefined && sale.commissionPaidBy != null) {
      data.commissionPaidBy = null;
    }

    data.updatedBy = actor(req);
    let updated;
    if (newDate) {
      const yearNew = Number(newDate.slice(0, 4)) || new Date().getFullYear();
      updated = await prisma.$transaction(async (tx) => {
        const u = await tx.sale.update({ where: { id }, data });
        // Mueve solo los movimientos de caja de la venta que estaban en su fecha original
        // (no toca los generados en otra fecha, p.ej. una provisión consumida después).
        await tx.cashMovement.updateMany({ where: { refType: "sale", refId: id, date: oldDate }, data: { date: newDate } });
        await tx.receivable.updateMany({ where: { saleId: id }, data: { dueFrom: newDate } });
        await tx.clientHistory.updateMany({ where: { saleId: id }, data: { year: yearNew } });
        return u;
      });
      // Recalcula el snapshot de cierre del día que pierde la venta y del que la recibe,
      // más el turno al que sigue perteneciendo.
      await refreshDailyClosingIfExists(oldDate);
      await refreshAfterSaleChange(updated);
    } else {
      updated = await prisma.sale.update({ where: { id }, data });
      await refreshAfterSaleChange(updated);
    }
    res.json({ sale: updated });
  } catch (e) { next(e); }
});

// DELETE /api/sales/:id — elimina fisicamente una venta (solo admin).
router.delete("/:id", auth(["admin"]), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const sale = await prisma.sale.findUnique({ where: { id } });
    if (!sale) return res.status(404).json({ error: "No existe" });

    // Bloquear si tiene cartera abierta.
    const openReceivable = await prisma.receivable.findFirst({ where: { saleId: id, status: "abierta" } });
    if (openReceivable) return res.status(400).json({ error: "La venta tiene cartera abierta. Cierrala antes de eliminar." });

    // Bloquear si la RTM ya fue realizada (el PIN fue emitido).
    if (["done", "paid_done"].includes(sale.rtmStatus)) {
      return res.status(400).json({ error: "La RTM ya fue realizada. Solo se puede anular, no eliminar." });
    }

    await prisma.$transaction(async (tx) => {
      await tx.saleLine.deleteMany({ where: { saleId: id } });
      await tx.salePayment.deleteMany({ where: { saleId: id } });
      await tx.saleCost.deleteMany({ where: { saleId: id } });
      await tx.clientHistory.deleteMany({ where: { saleId: id } });
      await tx.reversal.deleteMany({ where: { saleId: id } });
      await tx.receivable.deleteMany({ where: { saleId: id } });
      await tx.invoice.deleteMany({ where: { saleId: id } });
      // Limpia los movimientos de caja de la venta y sus reversas para no dejar saldos huerfanos.
      await tx.cashMovement.deleteMany({ where: { refType: { in: ["sale", "sale_void"] }, refId: id } });
      await tx.sale.delete({ where: { id } });
    });

    await refreshAfterSaleChange(sale);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// POST /api/sales/:id/invoice — emitir factura local (marca facturada + IVA discriminado).
router.post("/:id/invoice", async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const sale = await prisma.sale.findUnique({ where: { id } });
    if (!sale) return res.status(404).json({ error: "No existe" });
    if (sale.dianStatus === "facturada") {
      const lines = await prisma.saleLine.findMany({ where: { saleId: id } });
      return res.json({ alreadyInvoiced: true, doc: buildInvoiceDoc(sale, lines, sale.invoiceNumber) });
    }
    const lines = await prisma.saleLine.findMany({ where: { saleId: id } });
    const invoiceNumber = await nextInvoiceNumber(prisma);

    // Recalcula costos incluyendo IVA de facturacion (mismas tarifas del tipo de vehiculo).
    const payments = await prisma.salePayment.findMany({ where: { saleId: id } });
    const tariffs = await tariffsFor(sale.vehicleType || "MOTO", sale.saleDate);
    const costs = computeSaleCosts({ tariffs, pinAdquirido: sale.pinAdquirido, modelYear: sale.modelYear, facturada: true, payments });

    const tax = discriminateTax(lines);
    const updated = await prisma.$transaction(async (tx) => {
      const s = await tx.sale.update({
        where: { id },
        data: { dianStatus: "facturada", invoiceNumber }
      });
      await tx.saleCost.update({ where: { saleId: id }, data: costs });
      await tx.invoice.create({
        data: { saleId: id, number: invoiceNumber, base: tax.base, iva: tax.iva, total: tax.total }
      });
      return s;
    });
    res.json({ sale: updated, doc: buildInvoiceDoc(updated, lines, invoiceNumber) });
  } catch (e) {
    next(e);
  }
});

export default router;
