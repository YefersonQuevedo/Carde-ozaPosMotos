// Provisiones y cajas.
//
// Provision = dinero apartado cuando alguien PAGA pero NO hace la RTM hoy
// (venta con rtmStatus = "pending"). Cuando esa persona vuelve y hace la RTM,
// se CONSUME la provision: NO se vuelve a calcular comision ni valor (ya se
// calcularon al pagar), solo se marca la RTM como realizada y se mueve el dinero
// (egreso de la caja de provision -> ingreso a caja menor), reflejando el
// "egreso de provision + ingreso al cierre" que pidio el cliente.
//
// Cajas: caja menor, provision RTM, provision convenios, IVA... (se pueden agregar mas).
import { Router } from "express";
import { prisma } from "../db.js";
import { currentCompanyId } from "../tenant.js";
import { buildTariffLookup, computeSaleCosts } from "../services/costs.js";
import { toWorkbook, sendXlsx } from "../services/excel.js";
import { auth } from "../auth.js";
import { refreshAfterSaleChange } from "../services/consistency.js";

const router = Router();
const normalizePlate = (v) => String(v || "").trim().toUpperCase().replace(/\s+/g, "");
const PIN_RE = /^\d{19,20}$/; // SICOV: 19 o 20 digitos

// Saldo de cada caja = ingresos - egresos.
async function boxesWithBalance() {
  const [boxes, movements] = await Promise.all([
    prisma.cashBox.findMany({ where: { active: true }, orderBy: { id: "asc" } }),
    prisma.cashMovement.groupBy({ by: ["boxCode", "type"], _sum: { amount: true } })
  ]);
  const bal = {};
  for (const m of movements) {
    bal[m.boxCode] ||= 0;
    bal[m.boxCode] += (m.type === "ingreso" ? 1 : -1) * (m._sum.amount || 0);
  }
  return boxes.map((b) => ({ ...b, balance: bal[b.code] || 0 }));
}

// GET /api/provisions               -> provisiones abiertas (RTM pendientes) + cajas
// GET /api/provisions?plate=ABC123  -> provisiones abiertas de esa placa (para la venta)
// GET /api/provisions?clientDoc=..  -> provisiones abiertas de ese cliente
router.get("/", async (req, res, next) => {
  try {
    const where = { status: "activa", rtmStatus: "pending" };
    if (req.query.plate) where.plate = normalizePlate(req.query.plate);
    if (req.query.clientDoc) where.clientDoc = String(req.query.clientDoc);
    const sales = await prisma.sale.findMany({ where, orderBy: { saleDate: "asc" } });
    const items = sales.map((s) => ({
      saleId: s.id, saleNumber: s.saleNumber, saleDate: s.saleDate,
      clientDoc: s.clientDoc, clientName: s.clientName, plate: s.plate,
      allyType: s.allyType, allyName: s.allyName, deduction: s.deduction,
      amount: s.provisionAmount || s.total, modelYear: s.modelYear, rangeName: s.rangeName,
      packageCode: s.packageCode
    }));
    const total = items.reduce((a, b) => a + b.amount, 0);
    // Las cajas solo se devuelven en la vista general (sin filtro), para no recargar la venta.
    const boxes = req.query.plate || req.query.clientDoc ? undefined : await boxesWithBalance();
    res.json({ items, total, count: items.length, boxes });
  } catch (e) {
    next(e);
  }
});

// GET /api/provisions/export?from=&to= -> RTM Pendientes EN EL FORMATO DEL CLIENTE
// (hoja "RTM_Pendientes" de su Excel): incluye las que siguen pendientes y las que
// ya realizaron la RTM (consumieron la provision).
// Columnas: FECHA INGRESO DINERO | INGRESO | PLACA | REALIZÓ RTM |
//           FECHA EN QUE REALIZÓ | PROVISIONADO | Naturaleza | Medio de pago
router.get("/export", async (req, res, next) => {
  try {
    const from = req.query.from ? String(req.query.from) : null;
    const to = req.query.to ? String(req.query.to) : null;
    const where = { status: "activa", OR: [{ rtmStatus: "pending" }, { provisionConsumed: true }] };
    if (from || to) where.saleDate = { gte: from || "0000", lte: to || "9999" };
    const sales = await prisma.sale.findMany({ where, orderBy: [{ saleDate: "asc" }, { id: "asc" }], take: 10000 });
    const ids = sales.map((s) => s.id);
    // Fecha en que se realizó la RTM = egreso de PROV_RTM al consumir la provision.
    const realizeMovs = ids.length
      ? await prisma.cashMovement.findMany({ where: { boxCode: "PROV_RTM", type: "egreso", refType: "sale", refId: { in: ids } }, select: { refId: true, date: true } })
      : [];
    const realizeDate = {};
    for (const m of realizeMovs) realizeDate[m.refId] = m.date;
    // Medio(s) de pago por venta.
    const pays = ids.length ? await prisma.salePayment.findMany({ where: { saleId: { in: ids } }, select: { saleId: true, methodName: true } }) : [];
    const medioBySale = {};
    for (const p of pays) (medioBySale[p.saleId] ||= []).push(p.methodName);

    const rows = sales.map((s) => {
      const realizada = s.provisionConsumed || s.rtmStatus === "done";
      const monto = s.provisionAmount || s.total;
      return {
        fecha: s.saleDate,
        ingreso: monto,
        placa: s.plate || "",
        realizo: realizada ? "SÍ" : "NO",
        fechaRealizo: realizada ? (realizeDate[s.id] || "") : "",
        provisionado: realizada ? 0 : monto,
        naturaleza: "RTM Pendientes",
        medio: (medioBySale[s.id] || []).join(" / ")
      };
    });
    const totIngreso = rows.reduce((a, r) => a + r.ingreso, 0);
    const totProv = rows.reduce((a, r) => a + r.provisionado, 0);
    const buf = await toWorkbook({
      sheets: [{
        name: "RTM_Pendientes", title: "RTM PENDIENTES — Provisión por RTM pagada no realizada",
        columns: [
          { header: "FECHA INGRESO DINERO", key: "fecha", width: 18 },
          { header: "INGRESO", key: "ingreso", width: 14, money: true },
          { header: "PLACA", key: "placa", width: 10 },
          { header: "REALIZÓ RTM", key: "realizo", width: 12 },
          { header: "FECHA EN QUE REALIZÓ", key: "fechaRealizo", width: 20 },
          { header: "PROVISIONADO", key: "provisionado", width: 14, money: true },
          { header: "Naturaleza", key: "naturaleza", width: 16 },
          { header: "Medio de pago", key: "medio", width: 20 }
        ],
        rows, totals: { ingreso: totIngreso, provisionado: totProv }
      }]
    });
    sendXlsx(res, buf, "rtm-pendientes.xlsx");
  } catch (e) {
    next(e);
  }
});

// GET /api/provisions/boxes -> cajas con saldo
router.get("/boxes", async (_req, res, next) => {
  try {
    res.json({ boxes: await boxesWithBalance() });
  } catch (e) {
    next(e);
  }
});

// Calcula el libro (saldo corrido) de UNA caja en un rango. `balance` de cada fila
// es el saldo DESPUES del movimiento; `opening` es el saldo antes del rango.
async function buildLedger(boxCode, from, to) {
  let opening = 0;
  if (from) {
    const prev = await prisma.cashMovement.groupBy({ by: ["type"], where: { boxCode, date: { lt: from } }, _sum: { amount: true } });
    opening = prev.reduce((b, r) => b + (r.type === "ingreso" ? 1 : -1) * (r._sum.amount || 0), 0);
  }
  const where = { boxCode };
  if (from || to) where.date = { gte: from || "0000", lte: to || "9999" };
  const movs = await prisma.cashMovement.findMany({ where, orderBy: [{ date: "asc" }, { id: "asc" }], take: 10000 });

  // Marca los movimientos manuales que ya tienen reversa (para no anular dos veces).
  const manualIds = movs.filter((m) => m.refType === "manual").map((m) => m.id);
  const voids = manualIds.length
    ? await prisma.cashMovement.findMany({ where: { refType: "manual_void", refId: { in: manualIds } }, select: { refId: true } })
    : [];
  const voidedIds = new Set(voids.map((v) => v.refId));

  let running = opening;
  let ingresos = 0, egresos = 0;
  const rows = movs.map((m) => {
    const before = running;
    running += (m.type === "ingreso" ? 1 : -1) * m.amount;
    if (m.type === "ingreso") ingresos += m.amount; else egresos += m.amount;
    return { id: m.id, date: m.date, type: m.type, amount: m.amount, refType: m.refType, refId: m.refId, note: m.note, createdBy: m.createdBy, voided: voidedIds.has(m.id), before, balance: running };
  });
  return { boxCode, opening, ingresos, egresos, closing: running, rows };
}

// GET /api/provisions/ledger?boxCode=&from=&to= -> detalle de movimientos de UNA caja
// con saldo corrido (incluye el saldo inicial = movimientos previos al rango).
router.get("/ledger", async (req, res, next) => {
  try {
    const boxCode = String(req.query.boxCode || "CAJA_MENOR");
    const from = req.query.from ? String(req.query.from) : null;
    const to = req.query.to ? String(req.query.to) : null;
    const { opening, ingresos, egresos, closing, rows } = await buildLedger(boxCode, from, to);
    res.json({ boxCode, opening, ingresos, egresos, closing, rows, count: rows.length });
  } catch (e) {
    next(e);
  }
});

// Naturaleza por movimiento (mejor esfuerzo) para la planilla del cliente: usa la
// naturaleza del ingreso/gasto enlazado y, si no, una etiqueta segun el origen.
const LEDGER_LABEL = {
  sale: "Ventas RTM", ally_payment: "Comisiones", manual: "Movimiento de caja",
  manual_void: "Reversa", income_void: "Reversa", expense_void: "Reversa", sale_void: "Reversa",
  closing: "Cierre del día", shift: "Cierre turno", payable: "SuperGiros"
};
async function ledgerNaturalezas(rows) {
  const natures = await prisma.expenseNature.findMany();
  const nameByCode = Object.fromEntries(natures.map((n) => [n.code, n.name]));
  const incIds = rows.filter((r) => r.refType === "income").map((r) => r.refId).filter(Boolean);
  const expIds = rows.filter((r) => r.refType === "expense").map((r) => r.refId).filter(Boolean);
  const [incomes, expenses] = await Promise.all([
    incIds.length ? prisma.income.findMany({ where: { id: { in: incIds } }, select: { id: true, natureCode: true } }) : [],
    expIds.length ? prisma.expense.findMany({ where: { id: { in: expIds } }, select: { id: true, category: true } }) : []
  ]);
  const incNat = Object.fromEntries(incomes.map((i) => [i.id, nameByCode[i.natureCode] || i.natureCode || ""]));
  const expNat = Object.fromEntries(expenses.map((e) => [e.id, nameByCode[e.category] || e.category || ""]));
  return (r) => {
    if (r.refType === "income") return incNat[r.refId] || "Ingresos Planilla";
    if (r.refType === "expense") return expNat[r.refId] || "Gastos";
    if (r.refType === "sale" && /provis/i.test(r.note || "")) return "RTM Pendientes";
    return LEDGER_LABEL[r.refType] || r.refType || "";
  };
}

// GET /api/provisions/ledger/export?boxCode=&from=&to= -> Planilla de la caja en el
// FORMATO DEL CLIENTE (hojas "Planilla Bancos" / "Planilla Efectivo"):
// FECHA | SALDO | INGRESOS | EGRESOS | SUBTOTAL | OBSERVACIÓN | NATURALEZA
router.get("/ledger/export", async (req, res, next) => {
  try {
    const boxCode = String(req.query.boxCode || "CAJA_MENOR");
    const from = req.query.from ? String(req.query.from) : null;
    const to = req.query.to ? String(req.query.to) : null;
    const box = await prisma.cashBox.findFirst({ where: { code: boxCode } });
    const boxName = box?.name || boxCode;
    const { opening, ingresos, egresos, closing, rows } = await buildLedger(boxCode, from, to);
    const naturalezaOf = await ledgerNaturalezas(rows);
    const planilla = rows.map((m) => ({
      fecha: m.date,
      saldo: m.before,
      ingresos: m.type === "ingreso" ? m.amount : "",
      egresos: m.type === "egreso" ? m.amount : "",
      subtotal: m.balance,
      observacion: m.note || "",
      naturaleza: naturalezaOf(m)
    }));
    const sheetName = `Planilla ${boxName}`.slice(0, 31);
    const buf = await toWorkbook({
      sheets: [{
        name: sheetName, title: `${boxName.toUpperCase()} — Saldo inicial ${opening} · Ingresos ${ingresos} · Egresos ${egresos} · Saldo final ${closing}`,
        columns: [
          { header: "FECHA", key: "fecha", width: 12 },
          { header: "SALDO", key: "saldo", width: 16, money: true },
          { header: "INGRESOS", key: "ingresos", width: 14, money: true },
          { header: "EGRESOS", key: "egresos", width: 14, money: true },
          { header: "SUBTOTAL", key: "subtotal", width: 16, money: true },
          { header: "OBSERVACIÓN", key: "observacion", width: 36 },
          { header: "NATURALEZA", key: "naturaleza", width: 22 }
        ],
        rows: planilla
      }]
    });
    sendXlsx(res, buf, `planilla-${boxCode}.xlsx`);
  } catch (e) {
    next(e);
  }
});

// POST /api/provisions/boxes { code, name, kind } -> agregar una caja
router.post("/boxes", async (req, res, next) => {
  try {
    const b = req.body || {};
    const code = String(b.code || "").trim().toUpperCase().replace(/\s+/g, "_");
    if (!code || !b.name) return res.status(400).json({ error: "code y name son obligatorios" });
    const box = await prisma.cashBox.upsert({
      where: { companyId_code: { companyId: currentCompanyId(), code } },
      update: { name: b.name, kind: b.kind || "otra", active: b.active !== false },
      create: { code, name: b.name, kind: b.kind || "otra", active: true }
    });
    res.json(box);
  } catch (e) {
    next(e);
  }
});

// POST /api/provisions/movements { boxCode, type, amount, note, date } -> movimiento manual.
// Solo admin. Queda registrado QUIEN lo hizo (trazabilidad).
router.post("/movements", auth(["admin"]), async (req, res, next) => {
  try {
    const b = req.body || {};
    if (!b.boxCode || !["ingreso", "egreso"].includes(b.type) || !(Number(b.amount) > 0)) {
      return res.status(400).json({ error: "boxCode, type (ingreso|egreso) y amount > 0 obligatorios" });
    }
    const mv = await prisma.cashMovement.create({
      data: {
        boxCode: String(b.boxCode), type: b.type, amount: Math.round(Number(b.amount)),
        refType: b.refType || "manual", refId: b.refId ?? null,
        date: b.date || new Date().toISOString().slice(0, 10), note: b.note || null,
        createdBy: req.user?.name || req.user?.username || null
      }
    });
    res.json(mv);
  } catch (e) {
    next(e);
  }
});

// POST /api/provisions/movements/:id/void -> anula un movimiento MANUAL con un
// contra-movimiento (nunca se borra: queda el original + la reversa = trazabilidad).
// Solo admin. Los movimientos del sistema (ventas, cierres, pagos) no se anulan
// por aqui: se corrigen desde su modulo (editar venta, re-cerrar dia, anular abono).
router.post("/movements/:id/void", auth(["admin"]), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const mv = await prisma.cashMovement.findUnique({ where: { id } });
    if (!mv) return res.status(404).json({ error: "No existe el movimiento" });
    if (mv.refType !== "manual") {
      return res.status(400).json({ error: "Solo se anulan movimientos manuales. Este viene del sistema: corrígelo desde su módulo (venta, cierre, pago)." });
    }
    const already = await prisma.cashMovement.findFirst({ where: { refType: "manual_void", refId: id } });
    if (already) return res.status(400).json({ error: `Ese movimiento ya fue anulado (reversa #${already.id})` });
    const reversal = await prisma.cashMovement.create({
      data: {
        boxCode: mv.boxCode,
        type: mv.type === "ingreso" ? "egreso" : "ingreso",
        amount: mv.amount,
        refType: "manual_void", refId: id,
        date: new Date().toISOString().slice(0, 10),
        note: `Anula mov. #${id}${mv.note ? `: ${mv.note}` : ""}`,
        createdBy: req.user?.name || req.user?.username || null
      }
    });
    res.json({ ok: true, reversal });
  } catch (e) {
    next(e);
  }
});

// POST /api/provisions/:saleId/realize { date } -> consumir la provision (RTM realizada hoy).
// NO recalcula comision ni valor: usa los de la venta original. Mueve el dinero
// PROV_RTM -> CAJA_MENOR (egreso de provision + ingreso al cierre).
router.post("/:saleId/realize", async (req, res, next) => {
  try {
    const saleId = Number(req.params.saleId);
    const date = String(req.body?.date || new Date().toISOString().slice(0, 10));
    const sale = await prisma.sale.findUnique({ where: { id: saleId } });
    if (!sale) return res.status(404).json({ error: "No existe la venta" });
    if (sale.status !== "activa") return res.status(400).json({ error: "La venta no esta activa" });
    if (sale.rtmStatus !== "pending") return res.status(400).json({ error: "Esa venta no tiene provision pendiente" });
    const pinNumber = String(req.body?.pinNumber || "").trim();
    if (!PIN_RE.test(pinNumber)) return res.status(400).json({ error: "El PIN es obligatorio para realizar la RTM y debe tener 19 o 20 digitos numericos" });
    // El PIN es UNICO: no puede existir en otra venta.
    const dupPin = await prisma.sale.findFirst({ where: { pinNumber, status: "activa", id: { not: saleId } }, select: { saleNumber: true, plate: true, saleDate: true } });
    if (dupPin) return res.status(409).json({ error: `Ese PIN ya está registrado en la venta ${dupPin.saleNumber} (placa ${dupPin.plate || "-"}, ${dupPin.saleDate}). El PIN no se puede repetir.` });

    const amount = sale.provisionAmount || sale.total;

    // Recalcula costos ahora que la RTM se realiza (aplican SICOV, FUPA, sustratos, etc.).
    const tariffRows = await prisma.tariff.findMany({ where: { vehicleType: sale.vehicleType || "MOTO", active: true } });
    const tariffs = buildTariffLookup(tariffRows, date);
    const payments = await prisma.salePayment.findMany({ where: { saleId } });
    const costs = computeSaleCosts({
      tariffs, pinAdquirido: 1, modelYear: sale.modelYear,
      facturada: sale.dianStatus === "facturada", payments
    });

    const updated = await prisma.$transaction(async (tx) => {
      const s = await tx.sale.update({
        where: { id: saleId },
        data: { rtmStatus: "done", pinAdquirido: Math.max(1, sale.pinAdquirido), pinNumber, provisionConsumed: true, provisionSourcePlate: sale.plate }
      });
      await tx.saleCost.upsert({ where: { saleId }, update: costs, create: { saleId, ...costs } });
      // Egreso de la provision RTM e ingreso a caja menor (regreso del dinero apartado).
      await tx.cashMovement.create({ data: { boxCode: "PROV_RTM", type: "egreso", amount, refType: "sale", refId: saleId, date, note: `RTM realizada ${sale.plate || ""}`.trim() } });
      await tx.cashMovement.create({ data: { boxCode: "CAJA_MENOR", type: "ingreso", amount, refType: "sale", refId: saleId, date, note: `Provision consumida ${sale.plate || ""}`.trim() } });
      // Bitacora del cliente.
      await tx.clientHistory.create({
        data: { clientDoc: sale.clientDoc, saleId, plate: sale.plate, year: Number(date.slice(0, 4)), eventType: "rtm", allyId: sale.allyId, allyName: sale.allyName, note: "RTM realizada (provision consumida)" }
      });
      return s;
    });
    await refreshAfterSaleChange(updated);
    res.json({ sale: updated, consumed: amount, costs });
  } catch (e) {
    next(e);
  }
});

export default router;
