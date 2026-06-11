// Plantilla de ingresos (espejo de la hoja "Ingresos" del Excel gerencial).
// Registro/clasificacion de ingresos por naturaleza y fuente (bancos|efectivo).
// Si afecta caja, genera un CashMovement ingreso en la caja indicada.
import { Router } from "express";
import { prisma } from "../db.js";
import { toWorkbook, sendXlsx } from "../services/excel.js";

const router = Router();
const iso = () => new Date().toISOString().slice(0, 10);
const toInt = (v) => Math.round(Number(v) || 0);

function buildWhere(req) {
  const where = { status: "activa" };
  if (req.query.from || req.query.to) where.date = { gte: String(req.query.from || "0000"), lte: String(req.query.to || "9999") };
  if (req.query.source) where.source = String(req.query.source);
  if (req.query.natureCode) where.natureCode = String(req.query.natureCode);
  return where;
}

// GET /api/income?from=&to=&source=&natureCode= -> lista + total + por naturaleza/fuente
router.get("/", async (req, res, next) => {
  try {
    const items = await prisma.income.findMany({ where: buildWhere(req), orderBy: [{ date: "desc" }, { id: "desc" }], take: 2000 });
    const total = items.reduce((a, i) => a + i.value, 0);
    const byNature = {}, bySource = {};
    for (const i of items) {
      byNature[i.natureCode || "SIN_NATURALEZA"] = (byNature[i.natureCode || "SIN_NATURALEZA"] || 0) + i.value;
      bySource[i.source] = (bySource[i.source] || 0) + i.value;
    }
    res.json({ items, total, count: items.length, byNature, bySource });
  } catch (e) {
    next(e);
  }
});

// GET /api/income/by-nature?from=&to= -> ingresos agrupados por naturaleza (reporte)
router.get("/by-nature", async (req, res, next) => {
  try {
    const where = { status: "activa" };
    if (req.query.from || req.query.to) where.date = { gte: String(req.query.from || "0000"), lte: String(req.query.to || "9999") };
    const [items, natures] = await Promise.all([
      prisma.income.findMany({ where }),
      prisma.expenseNature.findMany()
    ]);
    const nameByCode = Object.fromEntries(natures.map((n) => [n.code, n.name]));
    const agg = {};
    for (const i of items) {
      const code = i.natureCode || "SIN_NATURALEZA";
      (agg[code] ||= { code, name: nameByCode[code] || code, total: 0, count: 0 });
      agg[code].total += i.value;
      agg[code].count += 1;
    }
    const rows = Object.values(agg).sort((a, b) => b.total - a.total);
    res.json({ rows, total: rows.reduce((a, r) => a + r.total, 0) });
  } catch (e) {
    next(e);
  }
});

// GET /api/income/export
router.get("/export", async (req, res, next) => {
  try {
    const items = await prisma.income.findMany({ where: buildWhere(req), orderBy: [{ date: "desc" }, { id: "desc" }], take: 10000 });
    const natures = await prisma.expenseNature.findMany();
    const nameByCode = Object.fromEntries(natures.map((n) => [n.code, n.name]));
    const rows = items.map((i) => ({ date: i.date, value: i.value, observation: i.observation || "", naturaleza: nameByCode[i.natureCode] || i.natureCode || "", source: i.source }));
    const total = items.reduce((a, i) => a + i.value, 0);
    const buf = await toWorkbook({
      sheets: [{
        name: "Ingresos", title: "Plantilla de ingresos",
        columns: [
          { header: "Fecha", key: "date", width: 12 }, { header: "Valor", key: "value", width: 16, money: true },
          { header: "Observacion", key: "observation", width: 34 }, { header: "Naturaleza", key: "naturaleza", width: 22 },
          { header: "Fuente", key: "source", width: 12 }
        ],
        rows, totals: { value: total }
      }]
    });
    sendXlsx(res, buf, "ingresos.xlsx");
  } catch (e) {
    next(e);
  }
});

// POST /api/income { date, value, observation, natureCode, source, boxCode, afectaCaja }
router.post("/", async (req, res, next) => {
  try {
    const b = req.body || {};
    const value = toInt(b.value);
    if (value <= 0) return res.status(400).json({ error: "valor > 0 obligatorio" });
    const date = b.date || iso();
    // Los ingresos SIEMPRE quedan ligados a una caja (por defecto CAJA_MENOR): es el
    // dinero que luego se usa para pagar Supergiros/Jasper. Solo se desliga si se pide
    // explicitamente (afectaCaja === false).
    const boxCode = b.afectaCaja === false ? null : (b.boxCode || "CAJA_MENOR");
    const income = await prisma.$transaction(async (tx) => {
      const inc = await tx.income.create({
        data: { date, value, observation: b.observation || null, natureCode: b.natureCode || null, source: b.source || "efectivo", boxCode, note: b.note || null, createdBy: b.createdBy || null }
      });
      if (boxCode) await tx.cashMovement.create({ data: { boxCode, type: "ingreso", amount: value, refType: "income", refId: inc.id, date, note: `Ingreso: ${b.observation || b.natureCode || ""}`.trim() } });
      return inc;
    });
    res.status(201).json(income);
  } catch (e) {
    next(e);
  }
});

// DELETE /api/income/:id -> anula (y revierte caja si la afecto)
router.delete("/:id", async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const inc = await prisma.income.findUnique({ where: { id } });
    if (!inc) return res.status(404).json({ error: "No existe" });
    if (inc.status === "anulada") return res.json({ ok: true, alreadyVoided: true });
    await prisma.$transaction(async (tx) => {
      await tx.income.update({ where: { id }, data: { status: "anulada" } });
      if (inc.boxCode) await tx.cashMovement.create({ data: { boxCode: inc.boxCode, type: "egreso", amount: inc.value, refType: "income_void", refId: id, date: iso(), note: `Anulacion ingreso` } });
    });
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

export default router;
