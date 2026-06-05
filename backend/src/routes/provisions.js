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
import { buildTariffLookup, computeSaleCosts } from "../services/costs.js";
import { toWorkbook, sendXlsx } from "../services/excel.js";

const router = Router();
const normalizePlate = (v) => String(v || "").trim().toUpperCase().replace(/\s+/g, "");
const PIN_RE = /^\d{19}$/;

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

// GET /api/provisions/export -> provisiones pendientes en Excel
router.get("/export", async (_req, res, next) => {
  try {
    const sales = await prisma.sale.findMany({ where: { status: "activa", rtmStatus: "pending" }, orderBy: { saleDate: "asc" } });
    const rows = sales.map((s) => ({
      fecha: s.saleDate, venta: s.saleNumber, cliente: s.clientName, doc: s.clientDoc,
      placa: s.plate || "", tipo: s.allyType, convenio: s.allyName || "",
      monto: s.provisionAmount || s.total
    }));
    const total = rows.reduce((a, r) => a + r.monto, 0);
    const buf = await toWorkbook({
      sheets: [{
        name: "Provisiones", title: "Provisiones pendientes (RTM pagadas no realizadas)",
        columns: [
          { header: "Fecha", key: "fecha", width: 12 }, { header: "Venta", key: "venta", width: 14 },
          { header: "Cliente", key: "cliente", width: 28 }, { header: "Documento", key: "doc", width: 16 },
          { header: "Placa", key: "placa", width: 10 }, { header: "Tipo", key: "tipo", width: 10 },
          { header: "Convenio", key: "convenio", width: 22 }, { header: "Monto", key: "monto", width: 14, money: true }
        ],
        rows, totals: { monto: total }
      }]
    });
    sendXlsx(res, buf, "provisiones.xlsx");
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

// POST /api/provisions/boxes { code, name, kind } -> agregar una caja
router.post("/boxes", async (req, res, next) => {
  try {
    const b = req.body || {};
    const code = String(b.code || "").trim().toUpperCase().replace(/\s+/g, "_");
    if (!code || !b.name) return res.status(400).json({ error: "code y name son obligatorios" });
    const box = await prisma.cashBox.upsert({
      where: { code },
      update: { name: b.name, kind: b.kind || "otra", active: b.active !== false },
      create: { code, name: b.name, kind: b.kind || "otra", active: true }
    });
    res.json(box);
  } catch (e) {
    next(e);
  }
});

// POST /api/provisions/movements { boxCode, type, amount, note, date } -> movimiento manual
router.post("/movements", async (req, res, next) => {
  try {
    const b = req.body || {};
    if (!b.boxCode || !["ingreso", "egreso"].includes(b.type) || !(Number(b.amount) > 0)) {
      return res.status(400).json({ error: "boxCode, type (ingreso|egreso) y amount > 0 obligatorios" });
    }
    const mv = await prisma.cashMovement.create({
      data: {
        boxCode: String(b.boxCode), type: b.type, amount: Math.round(Number(b.amount)),
        refType: b.refType || "manual", refId: b.refId ?? null,
        date: b.date || new Date().toISOString().slice(0, 10), note: b.note || null
      }
    });
    res.json(mv);
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
    if (!PIN_RE.test(pinNumber)) return res.status(400).json({ error: "El PIN es obligatorio para realizar la RTM y debe tener 19 digitos numericos" });

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
    res.json({ sale: updated, consumed: amount, costs });
  } catch (e) {
    next(e);
  }
});

export default router;
