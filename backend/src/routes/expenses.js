// Gastos del negocio. Cada gasto sale de una caja (genera un CashMovement egreso)
// y alimenta el "gastos" del cierre diario. Anular un gasto revierte su egreso.
import { Router } from "express";
import { prisma } from "../db.js";
import { currentCompanyId } from "../tenant.js";
import { toWorkbook, sendXlsx } from "../services/excel.js";
import { auth } from "../auth.js";

const router = Router();
const iso = () => new Date().toISOString().slice(0, 10);
const toInt = (value) => Math.max(0, Math.round(Number(value) || 0));

function normalizeNatureCode(value = "") {
  return String(value || "")
    .trim()
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
}

async function natureRows(from, to) {
  const [natures, expenses, invoices] = await Promise.all([
    prisma.expenseNature.findMany({ orderBy: { name: "asc" } }),
    prisma.expense.findMany({
      where: { status: "activa", ...(from || to ? { date: { gte: from || "0000", lte: to || "9999" } } : {}) },
      take: 5000
    }),
    prisma.supplierInvoice.findMany({
      where: { status: { not: "anulada" }, ...(from || to ? { date: { gte: from || "0000", lte: to || "9999" } } : {}) },
      take: 5000
    })
  ]);
  const byCode = {};
  for (const n of natures) byCode[n.code] = { code: n.code, name: n.name, kind: n.kind, expenses: 0, invoiceBase: 0, invoiceIva: 0, invoiceIvaDeductible: 0, invoiceTotal: 0, count: 0 };
  const ensure = (code) => {
    const safeCode = code || "SIN_NATURALEZA";
    byCode[safeCode] ||= { code: safeCode, name: safeCode === "SIN_NATURALEZA" ? "Sin naturaleza" : safeCode, kind: "gasto", expenses: 0, invoiceBase: 0, invoiceIva: 0, invoiceIvaDeductible: 0, invoiceTotal: 0, count: 0 };
    return byCode[safeCode];
  };
  for (const e of expenses) {
    const row = ensure(normalizeNatureCode(e.category));
    row.expenses += toInt(e.amount);
    row.count += 1;
  }
  for (const i of invoices) {
    const row = ensure(normalizeNatureCode(i.natureCode));
    row.invoiceBase += toInt(i.base);
    row.invoiceIva += toInt(i.iva);
    row.invoiceIvaDeductible += i.deductible ? toInt(i.iva) : 0;
    row.invoiceTotal += toInt(i.total);
    row.count += 1;
  }
  return Object.values(byCode)
    .filter((r) => r.count || r.expenses || r.invoiceTotal)
    .sort((a, b) => (b.expenses + b.invoiceTotal) - (a.expenses + a.invoiceTotal));
}

// GET /api/expenses/natures -> catalogo de naturalezas (solo activas).
// GET /api/expenses/natures?all=1 -> incluye inactivas (para el CRUD de configuracion).
router.get("/natures", async (req, res, next) => {
  try {
    const where = req.query.all ? {} : { active: true };
    const items = await prisma.expenseNature.findMany({ where, orderBy: { name: "asc" } });
    res.json({ items });
  } catch (e) {
    next(e);
  }
});

// POST /api/expenses/natures -> crear/actualizar una naturaleza (solo admin).
router.post("/natures", auth(["admin"]), async (req, res, next) => {
  try {
    const b = req.body || {};
    const code = normalizeNatureCode(b.code || b.name);
    const name = String(b.name || "").trim();
    const kind = ["ingreso", "gasto", "ambos"].includes(b.kind) ? b.kind : "gasto";
    if (!code || !name) return res.status(400).json({ error: "Codigo/nombre de naturaleza obligatorio" });
    const item = await prisma.expenseNature.upsert({
      where: { companyId_code: { companyId: currentCompanyId(), code } },
      update: { name, kind, taxRelevant: b.taxRelevant === true, active: b.active !== false },
      create: { code, name, kind, taxRelevant: b.taxRelevant === true, active: b.active !== false }
    });
    res.status(201).json({ item });
  } catch (e) {
    next(e);
  }
});

// PUT /api/expenses/natures/:code -> editar nombre/tipo/estado (solo admin).
// El codigo no cambia: es la referencia guardada en ingresos/gastos/facturas.
router.put("/natures/:code", auth(["admin"]), async (req, res, next) => {
  try {
    const code = normalizeNatureCode(req.params.code);
    const prev = await prisma.expenseNature.findFirst({ where: { code } });
    if (!prev) return res.status(404).json({ error: "No existe la naturaleza" });
    const b = req.body || {};
    const item = await prisma.expenseNature.update({
      where: { id: prev.id },
      data: {
        name: b.name !== undefined ? String(b.name).trim() || prev.name : prev.name,
        kind: ["ingreso", "gasto", "ambos"].includes(b.kind) ? b.kind : prev.kind,
        taxRelevant: b.taxRelevant !== undefined ? b.taxRelevant === true : prev.taxRelevant,
        active: b.active !== undefined ? b.active !== false : prev.active
      }
    });
    res.json({ item });
  } catch (e) {
    next(e);
  }
});

// DELETE /api/expenses/natures/:code -> eliminar (solo admin).
// Si ya tiene movimientos (ingresos/gastos/facturas de proveedor) NO se borra:
// se desactiva, para no dejar registros apuntando a una naturaleza fantasma.
router.delete("/natures/:code", auth(["admin"]), async (req, res, next) => {
  try {
    const code = normalizeNatureCode(req.params.code);
    const prev = await prisma.expenseNature.findFirst({ where: { code } });
    if (!prev) return res.status(404).json({ error: "No existe la naturaleza" });
    const [nInc, nExp, nInv, nPay] = await Promise.all([
      prisma.income.count({ where: { natureCode: code } }),
      prisma.expense.count({ where: { category: code } }),
      prisma.supplierInvoice.count({ where: { natureCode: code } }),
      prisma.payable.count({ where: { category: code } })
    ]);
    const used = nInc + nExp + nInv + nPay;
    if (used > 0) {
      const item = await prisma.expenseNature.update({ where: { id: prev.id }, data: { active: false } });
      return res.json({ ok: true, deactivated: true, used, item, message: `Tiene ${used} registro(s) asociados: se desactivó (no se borra para conservar el historial).` });
    }
    await prisma.expenseNature.delete({ where: { id: prev.id } });
    res.json({ ok: true, deleted: true });
  } catch (e) {
    next(e);
  }
});

router.get("/natures/report", async (req, res, next) => {
  try {
    const from = req.query.from ? String(req.query.from) : "";
    const to = req.query.to ? String(req.query.to) : "";
    const rows = await natureRows(from, to);
    const totals = rows.reduce((acc, r) => {
      acc.expenses += r.expenses;
      acc.invoiceBase += r.invoiceBase;
      acc.invoiceIva += r.invoiceIva;
      acc.invoiceIvaDeductible += r.invoiceIvaDeductible;
      acc.invoiceTotal += r.invoiceTotal;
      return acc;
    }, { expenses: 0, invoiceBase: 0, invoiceIva: 0, invoiceIvaDeductible: 0, invoiceTotal: 0 });
    res.json({ from, to, rows, totals });
  } catch (e) {
    next(e);
  }
});

router.get("/natures/report/export", async (req, res, next) => {
  try {
    const from = req.query.from ? String(req.query.from) : "";
    const to = req.query.to ? String(req.query.to) : "";
    const rows = await natureRows(from, to);
    const totals = rows.reduce((acc, r) => {
      acc.expenses += r.expenses;
      acc.invoiceBase += r.invoiceBase;
      acc.invoiceIva += r.invoiceIva;
      acc.invoiceIvaDeductible += r.invoiceIvaDeductible;
      acc.invoiceTotal += r.invoiceTotal;
      return acc;
    }, { expenses: 0, invoiceBase: 0, invoiceIva: 0, invoiceIvaDeductible: 0, invoiceTotal: 0 });
    const buffer = await toWorkbook({
      sheets: [{
        name: "Naturalezas",
        title: `Reporte ejecutivo por naturaleza ${from || "0000"} a ${to || "9999"}`,
        columns: [
          { header: "Codigo", key: "code", width: 18 },
          { header: "Naturaleza", key: "name", width: 28 },
          { header: "Tipo", key: "kind", width: 12 },
          { header: "Gastos caja", key: "expenses", width: 14, money: true },
          { header: "Facturas base", key: "invoiceBase", width: 14, money: true },
          { header: "Facturas IVA", key: "invoiceIva", width: 14, money: true },
          { header: "IVA descontable", key: "invoiceIvaDeductible", width: 16, money: true },
          { header: "Facturas total", key: "invoiceTotal", width: 14, money: true },
          { header: "Registros", key: "count", width: 10, number: true }
        ],
        rows,
        totals
      }]
    });
    sendXlsx(res, buffer, `naturalezas-${from || "inicio"}_${to || "fin"}.xlsx`);
  } catch (e) {
    next(e);
  }
});

// GET /api/expenses?from=&to=&boxCode=  -> lista + total
router.get("/", async (req, res, next) => {
  try {
    const where = { status: "activa" };
    if (req.query.from || req.query.to) where.date = { gte: String(req.query.from || "0000"), lte: String(req.query.to || "9999") };
    if (req.query.boxCode) where.boxCode = String(req.query.boxCode);
    const items = await prisma.expense.findMany({ where, orderBy: [{ date: "desc" }, { id: "desc" }], take: 1000 });
    const total = items.reduce((a, e) => a + e.amount, 0);
    res.json({ items, total, count: items.length });
  } catch (e) {
    next(e);
  }
});

// GET /api/expenses/export?from=&to=  -> workbook EN EL FORMATO DE MAYO del cliente:
// Hoja 1 "Consolidado Egresos" (por naturaleza, Bancos/Efectivo/Total/%/#),
// Hoja 2 "Egresos" (planilla: FECHA, VALOR, OBSERVACIÓN, NATURALEZA, FUENTE).
router.get("/export", async (req, res, next) => {
  try {
    const from = req.query.from, to = req.query.to;
    const label = periodLabel(from, to);
    const { rows: consol, totals, bankCodes, nameByCode } = await buildExpenseConsolidado(from, to);
    const where = { status: "activa" };
    if (from || to) where.date = { gte: String(from || "0000"), lte: String(to || "9999") };
    const items = await prisma.expense.findMany({ where, orderBy: [{ date: "asc" }, { id: "asc" }], take: 10000 });
    const planilla = items.map((e) => ({
      date: e.date, value: e.amount, observation: e.concept + (e.note ? " · " + e.note : ""),
      naturaleza: nameByCode[normalizeNatureCode(e.category)] || e.category || "",
      fuente: bankCodes.has(e.boxCode) ? "Bancos" : "Efectivo"
    }));
    const consolRows = consol.map((r) => ({ ...r, pctTxt: (r.pct || 0).toString().replace(".", ",") + "%" }));
    const buf = await toWorkbook({
      sheets: [
        {
          name: "Consolidado Egresos", title: `CONSOLIDADO DE EGRESOS — ${label}`,
          columns: [
            { header: "NATURALEZA (TIPO DE GASTO)", key: "name", width: 34 },
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
          name: "Egresos", title: `EGRESOS — Planillas Bancos y Efectivo (${label})`,
          columns: [
            { header: "FECHA", key: "date", width: 12 },
            { header: "VALOR", key: "value", width: 16, money: true },
            { header: "OBSERVACIÓN", key: "observation", width: 38 },
            { header: "NATURALEZA", key: "naturaleza", width: 26 },
            { header: "FUENTE", key: "fuente", width: 12 }
          ],
          rows: planilla, totals: { value: totals.total }
        }
      ]
    });
    sendXlsx(res, buf, `egresos-${label.replace(/\s+/g, "_")}.xlsx`);
  } catch (e) {
    next(e);
  }
});

// Una caja es "banco" (fuente Bancos) por tipo o nombre; el resto es Efectivo.
const isBankBox = (box) => {
  const kind = String(box?.kind || "").toLowerCase();
  return kind === "banco" || kind === "bancos" || String(box?.name || "").toLowerCase().includes("banco");
};

// Etiqueta del periodo para titulos del Excel ("MAYO 2026" si cae en un mes).
function periodLabel(from, to) {
  const f = String(from || ""), t = String(to || "");
  const meses = ["ENERO", "FEBRERO", "MARZO", "ABRIL", "MAYO", "JUNIO", "JULIO", "AGOSTO", "SEPTIEMBRE", "OCTUBRE", "NOVIEMBRE", "DICIEMBRE"];
  if (/^\d{4}-\d{2}/.test(f) && f.slice(0, 7) === t.slice(0, 7)) return `${meses[Number(f.slice(5, 7)) - 1]} ${f.slice(0, 4)}`;
  return `${f || "inicio"} a ${t || "hoy"}`;
}

// Consolidado de egresos por naturaleza, separado Bancos/Efectivo (formato del cliente).
async function buildExpenseConsolidado(from, to) {
  const where = { status: "activa" };
  if (from || to) where.date = { gte: String(from || "0000"), lte: String(to || "9999") };
  const [items, natures, boxes] = await Promise.all([
    prisma.expense.findMany({ where }),
    prisma.expenseNature.findMany(),
    prisma.cashBox.findMany()
  ]);
  const bankCodes = new Set(boxes.filter(isBankBox).map((b) => b.code));
  const nameByCode = Object.fromEntries(natures.map((n) => [n.code, n.name]));
  const rows = {};
  const ensure = (code, name) => (rows[code] ||= { code, name: name || nameByCode[code] || code, bancos: 0, efectivo: 0, total: 0, count: 0 });
  for (const n of natures) if (["gasto", "ambos"].includes(String(n.kind || "").toLowerCase())) ensure(n.code, n.name);
  for (const e of items) {
    const code = normalizeNatureCode(e.category) || "SIN_NATURALEZA";
    const row = ensure(code, code === "SIN_NATURALEZA" ? "Sin naturaleza" : null);
    if (bankCodes.has(e.boxCode)) row.bancos += e.amount; else row.efectivo += e.amount;
    row.total += e.amount; row.count += 1;
  }
  const list = Object.values(rows).sort((a, b) => b.total - a.total);
  const totals = list.reduce((t, r) => ({ bancos: t.bancos + r.bancos, efectivo: t.efectivo + r.efectivo, total: t.total + r.total, count: t.count + r.count }), { bancos: 0, efectivo: 0, total: 0, count: 0 });
  for (const r of list) r.pct = totals.total ? Math.round((r.total / totals.total) * 1000) / 10 : 0;
  return { rows: list, totals, bankCodes, nameByCode };
}

// GET /api/expenses/consolidado?from=&to=
router.get("/consolidado", async (req, res, next) => {
  try {
    const { rows, totals } = await buildExpenseConsolidado(req.query.from, req.query.to);
    res.json({ rows, totals });
  } catch (e) {
    next(e);
  }
});

// POST /api/expenses { date, concept, amount, boxCode, category, note }
router.post("/", async (req, res, next) => {
  try {
    const b = req.body || {};
    const amount = Math.round(Number(b.amount) || 0);
    if (!b.concept || amount <= 0) return res.status(400).json({ error: "concepto y monto > 0 obligatorios" });
    const date = b.date || iso();
    const boxCode = b.boxCode || "CAJA_MENOR";
    const expense = await prisma.$transaction(async (tx) => {
      const e = await tx.expense.create({
        data: { date, concept: b.concept, category: b.category || null, amount, boxCode, note: b.note || null, createdBy: b.createdBy || null }
      });
      await tx.cashMovement.create({ data: { boxCode, type: "egreso", amount, refType: "expense", refId: e.id, date, note: `Gasto: ${b.concept}` } });
      return e;
    });
    res.status(201).json(expense);
  } catch (e) {
    next(e);
  }
});

// DELETE /api/expenses/:id  -> anula el gasto y revierte su egreso de caja.
router.delete("/:id", async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const exp = await prisma.expense.findUnique({ where: { id } });
    if (!exp) return res.status(404).json({ error: "No existe" });
    if (exp.status === "anulada") return res.json({ ok: true, alreadyVoided: true });
    await prisma.$transaction(async (tx) => {
      await tx.expense.update({ where: { id }, data: { status: "anulada" } });
      // Reversa: devuelve el dinero a la caja.
      await tx.cashMovement.create({ data: { boxCode: exp.boxCode, type: "ingreso", amount: exp.amount, refType: "expense_void", refId: id, date: iso(), note: `Anulacion gasto: ${exp.concept}` } });
    });
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

export default router;
