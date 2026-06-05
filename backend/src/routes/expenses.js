// Gastos del negocio. Cada gasto sale de una caja (genera un CashMovement egreso)
// y alimenta el "gastos" del cierre diario. Anular un gasto revierte su egreso.
import { Router } from "express";
import { prisma } from "../db.js";
import { toWorkbook, sendXlsx } from "../services/excel.js";

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

// GET /api/expenses/natures -> catalogo de naturalezas.
router.get("/natures", async (_req, res, next) => {
  try {
    const items = await prisma.expenseNature.findMany({ where: { active: true }, orderBy: { name: "asc" } });
    res.json({ items });
  } catch (e) {
    next(e);
  }
});

router.post("/natures", async (req, res, next) => {
  try {
    const b = req.body || {};
    const code = normalizeNatureCode(b.code || b.name);
    const name = String(b.name || "").trim();
    if (!code || !name) return res.status(400).json({ error: "Codigo/nombre de naturaleza obligatorio" });
    const item = await prisma.expenseNature.upsert({
      where: { code },
      update: { name, kind: b.kind || "gasto", taxRelevant: b.taxRelevant === true, active: b.active !== false },
      create: { code, name, kind: b.kind || "gasto", taxRelevant: b.taxRelevant === true, active: b.active !== false }
    });
    res.status(201).json({ item });
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

// GET /api/expenses/export?from=&to=  -> Excel
router.get("/export", async (req, res, next) => {
  try {
    const where = { status: "activa" };
    if (req.query.from || req.query.to) where.date = { gte: String(req.query.from || "0000"), lte: String(req.query.to || "9999") };
    const items = await prisma.expense.findMany({ where, orderBy: [{ date: "desc" }, { id: "desc" }], take: 5000 });
    const total = items.reduce((a, e) => a + e.amount, 0);
    const buf = await toWorkbook({
      sheets: [{
        name: "Gastos", title: "Gastos",
        columns: [
          { header: "Fecha", key: "date", width: 12 }, { header: "Concepto", key: "concept", width: 30 },
          { header: "Categoria", key: "category", width: 18 }, { header: "Caja", key: "boxCode", width: 16 },
          { header: "Nota", key: "note", width: 24 }, { header: "Monto", key: "amount", width: 14, money: true }
        ],
        rows: items, totals: { amount: total }
      }]
    });
    sendXlsx(res, buf, "gastos.xlsx");
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
