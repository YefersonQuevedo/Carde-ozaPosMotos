// Plantilla de ingresos (espejo de la hoja "Ingresos" del Excel gerencial).
// Un ingreso siempre explica por que entra dinero y a que caja llega.
import { Router } from "express";
import { prisma } from "../db.js";
import { toWorkbook, sendXlsx } from "../services/excel.js";
import { actor } from "../auth.js";

const router = Router();
const iso = () => new Date().toISOString().slice(0, 10);
const toInt = (v) => Math.round(Number(v) || 0);

function buildWhere(req) {
  const where = { status: "activa" };
  if (req.query.from || req.query.to) where.date = { gte: String(req.query.from || "0000"), lte: String(req.query.to || "9999") };
  if (req.query.source) where.source = String(req.query.source);
  if (req.query.natureCode) where.natureCode = String(req.query.natureCode);
  if (req.query.boxCode) where.boxCode = String(req.query.boxCode);
  return where;
}

function manualIncomeWhere(req) {
  if (req.query.natureCode) return null;
  if (req.query.source && String(req.query.source) !== "efectivo") return null;
  const where = { refType: "manual", type: "ingreso" };
  if (req.query.from || req.query.to) where.date = { gte: String(req.query.from || "0000"), lte: String(req.query.to || "9999") };
  if (req.query.boxCode) where.boxCode = String(req.query.boxCode);
  return where;
}

// Una caja es "banco" (fuente Bancos) por su tipo o por el nombre; el resto es Efectivo.
export function isBankBox(box) {
  const kind = String(box?.kind || "").toLowerCase();
  const name = String(box?.name || "").toLowerCase();
  return kind === "banco" || kind === "bancos" || name.includes("banco");
}

async function validIncomeBox(boxCode) {
  const box = await prisma.cashBox.findFirst({ where: { code: boxCode, active: true } });
  if (!box) return null;
  const kind = String(box.kind || "");
  const name = String(box.name || "").toLowerCase();
  if (
    kind === "caja_menor" ||
    kind === "otra" ||
    kind.startsWith("provision_") ||
    isBankBox(box) ||
    name.includes("provision")
  ) return box;
  return null;
}

async function manualIncomeRows(req) {
  const where = manualIncomeWhere(req);
  if (!where) return [];
  const movements = await prisma.cashMovement.findMany({ where, orderBy: [{ date: "desc" }, { id: "desc" }], take: 2000 });
  const ids = movements.map((m) => m.id);
  const voids = ids.length
    ? await prisma.cashMovement.findMany({ where: { refType: "manual_void", refId: { in: ids } }, select: { refId: true } })
    : [];
  const voided = new Set(voids.map((v) => v.refId));
  return movements
    .filter((m) => !voided.has(m.id))
    .map((m) => ({
      id: `cash-${m.id}`,
      cashMovementId: m.id,
      sourceTable: "cashMovement",
      date: m.date,
      value: m.amount,
      observation: m.note || "Ingreso manual a caja",
      natureCode: "MOVIMIENTO_CAJA",
      source: "efectivo",
      boxCode: m.boxCode,
      status: "activa",
      createdBy: m.createdBy || null
    }));
}

function sortIncomeRows(rows) {
  return rows.sort((a, b) => {
    const byDate = String(b.date).localeCompare(String(a.date));
    if (byDate) return byDate;
    return String(b.id).localeCompare(String(a.id));
  });
}

// GET /api/income?from=&to=&source=&natureCode=&boxCode= -> lista + total + por naturaleza/fuente
router.get("/", async (req, res, next) => {
  try {
    const [incomeItems, manualItems] = await Promise.all([
      prisma.income.findMany({ where: buildWhere(req), orderBy: [{ date: "desc" }, { id: "desc" }], take: 2000 }),
      manualIncomeRows(req)
    ]);
    const items = sortIncomeRows([
      ...incomeItems.map((i) => ({ ...i, sourceTable: "income" })),
      ...manualItems
    ]);
    const total = items.reduce((a, i) => a + i.value, 0);
    const byNature = {}, bySource = {}, byBox = {};
    for (const i of items) {
      byNature[i.natureCode || "SIN_NATURALEZA"] = (byNature[i.natureCode || "SIN_NATURALEZA"] || 0) + i.value;
      bySource[i.source] = (bySource[i.source] || 0) + i.value;
      byBox[i.boxCode || "SIN_CAJA"] = (byBox[i.boxCode || "SIN_CAJA"] || 0) + i.value;
    }
    res.json({ items, total, count: items.length, byNature, bySource, byBox });
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

// Etiqueta del periodo para los titulos del Excel: "MAYO 2026" si cae en un solo mes.
export function periodLabel(from, to) {
  const f = String(from || ""), t = String(to || "");
  const meses = ["ENERO", "FEBRERO", "MARZO", "ABRIL", "MAYO", "JUNIO", "JULIO", "AGOSTO", "SEPTIEMBRE", "OCTUBRE", "NOVIEMBRE", "DICIEMBRE"];
  if (/^\d{4}-\d{2}/.test(f) && f.slice(0, 7) === t.slice(0, 7)) return `${meses[Number(f.slice(5, 7)) - 1]} ${f.slice(0, 4)}`;
  return `${f || "inicio"} a ${t || "hoy"}`;
}

// Consolidado de ingresos por naturaleza, separado Bancos/Efectivo. Lista TODAS las
// naturalezas de tipo ingreso/ambos aunque esten en 0 (como la hoja del Excel del cliente).
async function buildIncomeConsolidado(from, to) {
  const where = { status: "activa" };
  if (from || to) where.date = { gte: String(from || "0000"), lte: String(to || "9999") };
  const [items, natures, boxes] = await Promise.all([
    prisma.income.findMany({ where }),
    prisma.expenseNature.findMany(),
    prisma.cashBox.findMany()
  ]);
  const bankCodes = new Set(boxes.filter(isBankBox).map((b) => b.code));
  const nameByCode = Object.fromEntries(natures.map((n) => [n.code, n.name]));
  const rows = {};
  const ensure = (code, name) => (rows[code] ||= { code, name: name || nameByCode[code] || code, bancos: 0, efectivo: 0, total: 0, count: 0 });
  for (const n of natures) if (["ingreso", "ambos"].includes(String(n.kind || "").toLowerCase())) ensure(n.code, n.name);
  for (const i of items) {
    const code = i.natureCode || "SIN_NATURALEZA";
    const row = ensure(code, code === "SIN_NATURALEZA" ? "Sin naturaleza" : null);
    if (i.source === "bancos" || bankCodes.has(i.boxCode)) row.bancos += i.value; else row.efectivo += i.value;
    row.total += i.value; row.count += 1;
  }
  const list = Object.values(rows).sort((a, b) => b.total - a.total);
  const totals = list.reduce((t, r) => ({ bancos: t.bancos + r.bancos, efectivo: t.efectivo + r.efectivo, total: t.total + r.total, count: t.count + r.count }), { bancos: 0, efectivo: 0, total: 0, count: 0 });
  for (const r of list) r.pct = totals.total ? Math.round((r.total / totals.total) * 1000) / 10 : 0;
  return { rows: list, totals, bankCodes, nameByCode };
}

// GET /api/income/consolidado?from=&to=
router.get("/consolidado", async (req, res, next) => {
  try {
    const { rows, totals } = await buildIncomeConsolidado(req.query.from, req.query.to);
    res.json({ rows, totals });
  } catch (e) {
    next(e);
  }
});

// GET /api/income/export -> workbook EN EL FORMATO DE MAYO del cliente:
// Hoja 1 "Consolidado Ingresos" (por naturaleza, Bancos/Efectivo/Total/%/#),
// Hoja 2 "Ingresos" (planilla: FECHA, VALOR, OBSERVACIÓN, NATURALEZA, FUENTE).
router.get("/export", async (req, res, next) => {
  try {
    const from = req.query.from, to = req.query.to;
    const label = periodLabel(from, to);
    const { rows: consol, totals, bankCodes, nameByCode } = await buildIncomeConsolidado(from, to);
    const [incomeItems, manualItems] = await Promise.all([
      prisma.income.findMany({ where: buildWhere(req), orderBy: [{ date: "asc" }, { id: "asc" }], take: 10000 }),
      manualIncomeRows(req)
    ]);
    const items = [...incomeItems.map((i) => ({ ...i, sourceTable: "income" })), ...manualItems]
      .sort((a, b) => String(a.date).localeCompare(String(b.date)) || String(a.id).localeCompare(String(b.id)));
    const planilla = items.map((i) => ({
      date: i.date, value: i.value, observation: i.observation || "",
      naturaleza: i.natureCode === "MOVIMIENTO_CAJA" ? "Movimiento de caja" : (nameByCode[i.natureCode] || i.natureCode || ""),
      fuente: (i.source === "bancos" || bankCodes.has(i.boxCode)) ? "Bancos" : "Efectivo",
      registro: i.createdBy || ""
    }));
    const consolRows = consol.map((r) => ({ ...r, pctTxt: (r.pct || 0).toString().replace(".", ",") + "%" }));
    const buf = await toWorkbook({
      sheets: [
        {
          name: "Consolidado Ingresos", title: `CONSOLIDADO DE INGRESOS — ${label}`,
          columns: [
            { header: "NATURALEZA (TIPO DE INGRESO)", key: "name", width: 34 },
            { header: "BANCOS", key: "bancos", width: 16, money: true },
            { header: "EFECTIVO", key: "efectivo", width: 16, money: true },
            { header: "TOTAL", key: "total", width: 16, money: true },
            { header: "% DEL TOTAL", key: "pctTxt", width: 12 },
            { header: "# MOVIMIENTOS", key: "count", width: 14, number: true }
          ],
          rows: consolRows,
          totals: { bancos: totals.bancos, efectivo: totals.efectivo, total: totals.total, count: totals.count }
        },
        {
          name: "Ingresos", title: `INGRESOS — Planillas Bancos y Efectivo (${label})`,
          columns: [
            { header: "FECHA", key: "date", width: 12 },
            { header: "VALOR", key: "value", width: 16, money: true },
            { header: "OBSERVACIÓN", key: "observation", width: 38 },
            { header: "NATURALEZA", key: "naturaleza", width: 26 },
            { header: "FUENTE", key: "fuente", width: 12 },
            { header: "Registró", key: "registro", width: 18 }
          ],
          rows: planilla, totals: { value: totals.total }
        }
      ]
    });
    sendXlsx(res, buf, `ingresos-${label.replace(/\s+/g, "_")}.xlsx`);
  } catch (e) {
    next(e);
  }
});

// POST /api/income { date, value, observation, natureCode, boxCode }
router.post("/", async (req, res, next) => {
  try {
    const b = req.body || {};
    const value = toInt(b.value);
    if (value <= 0) return res.status(400).json({ error: "valor > 0 obligatorio" });
    const observation = String(b.observation || "").trim();
    if (!observation) return res.status(400).json({ error: "concepto o motivo obligatorio" });
    const date = b.date || iso();
    const boxCode = String(b.boxCode || "CAJA_MENOR");
    const box = await validIncomeBox(boxCode);
    if (!box) return res.status(400).json({ error: "Selecciona caja menor, bancos, una caja de provisiones o una tercera caja activa" });
    const source = isBankBox(box) ? "bancos" : "efectivo";
    const income = await prisma.$transaction(async (tx) => {
      const inc = await tx.income.create({
        data: { date, value, observation, natureCode: b.natureCode || null, source, boxCode, note: b.note || null, createdBy: actor(req) }
      });
      await tx.cashMovement.create({ data: { boxCode, type: "ingreso", amount: value, refType: "income", refId: inc.id, date, note: `Ingreso: ${observation}` } });
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
      await tx.income.update({ where: { id }, data: { status: "anulada", updatedBy: actor(req) } });
      if (inc.boxCode) await tx.cashMovement.create({ data: { boxCode: inc.boxCode, type: "egreso", amount: inc.value, refType: "income_void", refId: id, date: iso(), note: `Anulacion ingreso` } });
    });
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

export default router;
