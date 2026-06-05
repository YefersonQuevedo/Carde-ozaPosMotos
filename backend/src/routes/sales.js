import { Router } from "express";
import { prisma } from "../db.js";
import { paymentCost, computeSaleCosts, buildTariffLookup } from "../services/costs.js";
import { nextInvoiceNumber, buildInvoiceDoc, discriminateTax } from "../services/invoice.js";
import { auth } from "../auth.js";

const router = Router();

const normalizePlate = (v) => String(v || "").trim().toUpperCase().replace(/\s+/g, "");

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

// POST /api/sales — registra la venta (siempre, se facture o no).
router.post("/", async (req, res, next) => {
  try {
    const b = req.body || {};
    const c = b.client || {};
    const v = b.vehicle || {};
    if (!c.docNumber || !c.name) return res.status(400).json({ error: "Cliente (docNumber, name) obligatorio" });

    // 1) Cliente y moto (upsert / find-or-create, sin FK).
    // En update solo se tocan los campos que vienen en la venta: no se pisan
    // telefono/email/direccion existentes con null si la venta no los reenvia.
    const clientDoc = String(c.docNumber).trim();
    await prisma.client.upsert({
      where: { docNumber: clientDoc },
      update: {
        name: c.name,
        ...(c.phone ? { phone: c.phone } : {}),
        ...(c.email ? { email: c.email } : {}),
        ...(c.address ? { address: c.address } : {}),
        ...(c.docType ? { docType: c.docType } : {})
      },
      create: { docType: c.docType || "CC", docNumber: clientDoc, name: c.name, phone: c.phone || null, email: c.email || null, address: c.address || null }
    });

    const plate = normalizePlate(v.plate);
    const modelYear = Number(v.modelYear) || null;
    const vehicleType = v.vehicleType || "MOTO";
    const rangeName = v.rangeName || (modelYear ? rangeFromModel(modelYear) : null);
    if (plate) {
      const existing = await prisma.vehicle.findFirst({ where: { plate, clientDoc: String(c.docNumber) } });
      if (!existing) {
        await prisma.vehicle.create({ data: { clientDoc: String(c.docNumber), plate, modelYear, rangeName, vehicleType } });
      }
    }

    // 2) Lineas + totales.
    const lines = b.packageCode ? await buildLines(b.packageCode) : [];
    const totalBase = lines.reduce((s, l) => s + l.base, 0);
    const totalIva = lines.reduce((s, l) => s + l.tax, 0);
    const total = lines.reduce((s, l) => s + l.total, 0);

    // 3) Estado RTM y dinero.
    const rtmAlreadyPaid = !!b.rtmAlreadyPaid;
    const rtmToday = b.rtmToday !== false; // por defecto se realiza hoy
    const rtmStatus = rtmAlreadyPaid
      ? (rtmToday ? "paid_done" : "paid_not_done")
      : (rtmToday ? "done" : "pending");
    const pinAdquirido = rtmToday ? 1 : 0;

    // 4) Convenio / comision (DEDUCCIONES CONVENIOS).
    const allyName = b.ally?.name || "USUARIO";
    const allyType = b.ally?.type || (allyName.toUpperCase() === "USUARIO" ? "usuario" : "referido");
    const discountApplied = b.ally?.discountApplied !== false;
    const ally = await prisma.ally.findFirst({ where: { name: allyName } });
    const baseCommission = ally?.commission ?? (allyType === "usuario" ? 20000 : 40000);
    const deduction = discountApplied ? baseCommission : 0;

    // 5) Pagos (mixtos) + costo de transaccion congelado por pago.
    const methods = await prisma.paymentMethod.findMany();
    const methodByCode = Object.fromEntries(methods.map((m) => [m.code, m]));
    const payments = (b.payments || [])
      .filter((p) => p && p.methodCode && Number(p.amount) > 0)
      .map((p) => {
        const m = methodByCode[p.methodCode];
        if (!m) throw Object.assign(new Error(`Metodo de pago desconocido: ${p.methodCode}`), { status: 400 });
        const cost = paymentCost(m, p.amount);
        return {
          methodCode: m.code,
          methodName: m.name,
          groupCode: m.groupCode,
          amount: Math.round(Number(p.amount)),
          costType: cost.costType,
          costAmount: cost.costAmount,
          costTax: cost.costTax,
          _method: m
        };
      });

    const paidAmount = payments.reduce((s, p) => s + p.amount, 0);
    // Solo el efectivo puede exceder el total (vueltas); los demas metodos no.
    const cashPaid = payments.filter((p) => p.methodCode === "EFECTIVO").reduce((s, p) => s + p.amount, 0);
    if (!rtmAlreadyPaid && paidAmount < total) {
      throw Object.assign(new Error("El pago no cubre el total de la venta"), { status: 400 });
    }
    if (paidAmount - cashPaid > total) {
      throw Object.assign(new Error("Los pagos distintos a efectivo no pueden superar el total"), { status: 400 });
    }
    const changeAmount = Math.max(0, paidAmount - total);

    // 6) Facturacion: ADDI/GORA siempre facturan; o el usuario pidio facturar.
    const forcedDian = payments.some((p) => p._method.facturaDian);
    const facturada = !!b.facturar || forcedDian;

    // 7) Costos congelados (tarifas por tipo de vehiculo y vigencia).
    const saleDate0 = b.date || new Date().toISOString().slice(0, 10);
    const tariffs = await tariffsFor(vehicleType, saleDate0);
    const costs = computeSaleCosts({ tariffs, pinAdquirido, modelYear, facturada, payments });

    // 8) Provision (RTM pendiente) y cartera (ADDI/GORA/credito).
    const provisionAmount = rtmStatus === "pending" ? total : 0;
    const receivablePayments = payments.filter((p) => p._method.generatesReceivable);
    const receivableAmount = receivablePayments.reduce((s, p) => s + p.amount, 0);

    const saleNumber = await nextSaleNumber();
    const invoiceNumber = facturada ? await nextInvoiceNumber(prisma) : null;
    const saleDate = b.date || new Date().toISOString().slice(0, 10);

    // 9) Persistir todo en una transaccion (sin FK; referencias por saleId).
    const sale = await prisma.$transaction(async (tx) => {
      const created = await tx.sale.create({
        data: {
          saleNumber,
          saleDate,
          saleTime: b.time || new Date().toTimeString().slice(0, 8),
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
          provisionAmount,
          receivableAmount,
          dianStatus: facturada ? "facturada" : "no_emitida",
          invoiceNumber,
          responsable: b.responsable || null,
          observaciones: b.observaciones || null
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

    res.status(201).json({ sale, lines, payments: payments.map(({ _method, ...p }) => p), costs });
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
      const s = await tx.sale.update({ where: { id }, data: { status: "anulada" } });
      await tx.reversal.create({
        data: { saleId: id, saleNumber: sale.saleNumber, reason: req.body?.reason || null, authorizedBy: req.body?.authorizedBy || null }
      });
      await tx.receivable.updateMany({ where: { saleId: id, status: "abierta" }, data: { status: "anulada", pending: 0 } });
      return s;
    });
    res.json({ sale: updated });
  } catch (e) {
    next(e);
  }
});

// GET /api/sales?date=&clientDoc=&plate=&range=&status=
router.get("/", async (req, res, next) => {
  try {
    const { date, clientDoc, plate, range } = req.query;
    const where = {};
    if (date) where.saleDate = String(date);
    if (clientDoc) where.clientDoc = String(clientDoc);
    if (plate) where.plate = normalizePlate(plate);
    if (range) where.rangeName = String(range);
    const items = await prisma.sale.findMany({ where, orderBy: { id: "desc" }, take: 500 });
    res.json(items);
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
