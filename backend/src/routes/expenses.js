// Gastos del negocio. Cada gasto sale de una caja (genera un CashMovement egreso)
// y alimenta el "gastos" del cierre diario. Anular un gasto revierte su egreso.
import { Router } from "express";
import { prisma } from "../db.js";
import { toWorkbook, sendXlsx } from "../services/excel.js";

const router = Router();
const iso = () => new Date().toISOString().slice(0, 10);

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
