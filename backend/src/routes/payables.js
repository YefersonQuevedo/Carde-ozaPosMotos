// Cuentas por pagar / obligaciones (modulo gerencial).
// El cliente lleva a mano sus deudas (cesantias, retencion, arriendo, parafiscales,
// cuotas...). Aqui registra cada obligacion con su frecuencia y fecha estimada,
// abona y ve el pendiente. frequency: unico | mensual | bimestral | cuotas.
import { Router } from "express";
import { prisma } from "../db.js";
import { toWorkbook, sendXlsx } from "../services/excel.js";

const router = Router();
const iso = () => new Date().toISOString().slice(0, 10);

function statusFor(total, paid) {
  if (paid <= 0) return "pendiente";
  if (paid >= total) return "pagado";
  return "parcial";
}

// GET /api/payables?status=&category= -> lista + totales
router.get("/", async (req, res, next) => {
  try {
    const where = {};
    if (req.query.status) where.status = String(req.query.status);
    if (req.query.category) where.category = String(req.query.category);
    const items = await prisma.payable.findMany({ where, orderBy: [{ status: "asc" }, { dueDate: "asc" }, { id: "desc" }], take: 1000 });
    const withPending = items.map((p) => ({ ...p, pending: Math.max(0, p.totalAmount - p.paidAmount) }));
    const totals = withPending.reduce((a, p) => {
      a.total += p.totalAmount; a.paid += p.paidAmount; a.pending += p.pending; return a;
    }, { total: 0, paid: 0, pending: 0 });
    res.json({ items: withPending, totals, count: items.length });
  } catch (e) {
    next(e);
  }
});

// GET /api/payables/export
router.get("/export", async (req, res, next) => {
  try {
    const where = {};
    if (req.query.status) where.status = String(req.query.status);
    const items = await prisma.payable.findMany({ where, orderBy: [{ dueDate: "asc" }, { id: "desc" }], take: 5000 });
    const rows = items.map((p) => ({ ...p, pending: Math.max(0, p.totalAmount - p.paidAmount) }));
    const totals = rows.reduce((a, p) => { a.totalAmount += p.totalAmount; a.paidAmount += p.paidAmount; a.pending += p.pending; return a; }, { totalAmount: 0, paidAmount: 0, pending: 0 });
    const buf = await toWorkbook({
      sheets: [{
        name: "Cuentas por pagar", title: "Cuentas por pagar / obligaciones",
        columns: [
          { header: "Concepto", key: "concept", width: 28 }, { header: "Acreedor", key: "creditor", width: 22 },
          { header: "Naturaleza", key: "category", width: 18 }, { header: "Frecuencia", key: "frequency", width: 12 },
          { header: "Vence", key: "dueDate", width: 12 }, { header: "Estado", key: "status", width: 12 },
          { header: "Total", key: "totalAmount", width: 14, money: true }, { header: "Pagado", key: "paidAmount", width: 14, money: true },
          { header: "Pendiente", key: "pending", width: 14, money: true }
        ],
        rows, totals: { totalAmount: totals.totalAmount, paidAmount: totals.paidAmount, pending: totals.pending }
      }]
    });
    sendXlsx(res, buf, "cuentas-por-pagar.xlsx");
  } catch (e) {
    next(e);
  }
});

// GET /api/payables/:id -> detalle + abonos
router.get("/:id", async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const p = await prisma.payable.findUnique({ where: { id } });
    if (!p) return res.status(404).json({ error: "No existe" });
    const payments = await prisma.payablePayment.findMany({ where: { payableId: id }, orderBy: { id: "desc" } });
    res.json({ ...p, pending: Math.max(0, p.totalAmount - p.paidAmount), payments });
  } catch (e) {
    next(e);
  }
});

// POST /api/payables -> crear
router.post("/", async (req, res, next) => {
  try {
    const b = req.body || {};
    if (!b.concept) return res.status(400).json({ error: "concepto obligatorio" });
    const totalAmount = Math.round(Number(b.totalAmount) || 0);
    const data = {
      concept: b.concept, creditor: b.creditor || null, category: b.category || null,
      totalAmount, paidAmount: 0, frequency: b.frequency || "unico",
      installments: Math.max(1, Number(b.installments) || 1), installmentAmount: Math.round(Number(b.installmentAmount) || 0),
      dueDate: b.dueDate || null, note: b.note || null, status: statusFor(totalAmount, 0)
    };
    res.status(201).json(await prisma.payable.create({ data }));
  } catch (e) {
    next(e);
  }
});

// PUT /api/payables/:id -> editar
router.put("/:id", async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const cur = await prisma.payable.findUnique({ where: { id } });
    if (!cur) return res.status(404).json({ error: "No existe" });
    const b = req.body || {};
    const totalAmount = b.totalAmount != null ? Math.round(Number(b.totalAmount) || 0) : cur.totalAmount;
    const data = {
      concept: b.concept ?? cur.concept, creditor: b.creditor ?? cur.creditor, category: b.category ?? cur.category,
      totalAmount, frequency: b.frequency ?? cur.frequency,
      installments: b.installments != null ? Math.max(1, Number(b.installments)) : cur.installments,
      installmentAmount: b.installmentAmount != null ? Math.round(Number(b.installmentAmount) || 0) : cur.installmentAmount,
      dueDate: b.dueDate ?? cur.dueDate, note: b.note ?? cur.note,
      status: statusFor(totalAmount, cur.paidAmount)
    };
    res.json(await prisma.payable.update({ where: { id }, data }));
  } catch (e) {
    next(e);
  }
});

// POST /api/payables/:id/pay -> registrar abono
router.post("/:id/pay", async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const p = await prisma.payable.findUnique({ where: { id } });
    if (!p) return res.status(404).json({ error: "No existe" });
    const amount = Math.round(Number(req.body?.amount) || 0);
    if (amount <= 0) return res.status(400).json({ error: "amount > 0 obligatorio" });
    const paidAmount = p.paidAmount + amount;
    const updated = await prisma.$transaction(async (tx) => {
      await tx.payablePayment.create({ data: { payableId: id, amount, paidDate: req.body?.paidDate || iso(), note: req.body?.note || null } });
      return tx.payable.update({ where: { id }, data: { paidAmount, status: statusFor(p.totalAmount, paidAmount) } });
    });
    res.json({ ...updated, pending: Math.max(0, updated.totalAmount - updated.paidAmount) });
  } catch (e) {
    next(e);
  }
});

router.delete("/:id", async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    await prisma.payablePayment.deleteMany({ where: { payableId: id } });
    await prisma.payable.delete({ where: { id } });
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

export default router;
