// Cuentas por pagar / obligaciones (modulo gerencial).
// El cliente lleva a mano sus deudas (cesantias, retencion, arriendo, parafiscales,
// cuotas...). Aqui registra cada obligacion con su frecuencia y fecha estimada,
// abona y ve el pendiente. frequency: unico | mensual | bimestral | cuotas.
import { Router } from "express";
import { prisma } from "../db.js";
import { toWorkbook, sendXlsx } from "../services/excel.js";
import { boxBalance } from "../services/cash.js";

const router = Router();
const iso = () => new Date().toISOString().slice(0, 10);

function statusFor(total, paid) {
  if (paid <= 0) return "pendiente";
  if (paid >= total) return "pagado";
  return "parcial";
}

async function findPaymentCashOut(client, { payableId, paymentId, payment }) {
  const modern = await client.cashMovement.findFirst({
    where: { refType: "payable_payment", refId: paymentId, type: "egreso" }
  });
  if (modern) return modern;

  // Compatibilidad con pagos creados antes de ligar el movimiento al abono:
  // el egreso quedaba como refType="payable" y refId=<cuenta>.
  return client.cashMovement.findFirst({
    where: {
      refType: "payable",
      refId: payableId,
      type: "egreso",
      amount: payment?.amount,
      date: payment?.paidDate
    },
    orderBy: { id: "desc" }
  });
}

// Filtros compartidos por la lista y el export: status, category, creditor (proveedor)
// y rango de fechas sobre dueDate (from/to).
function payableWhere(query = {}) {
  const where = {};
  if (query.status) where.status = String(query.status);
  if (query.category) where.category = String(query.category);
  if (query.creditor) where.creditor = String(query.creditor);
  if (query.from || query.to) where.dueDate = { gte: String(query.from || "0000"), lte: String(query.to || "9999") };
  return where;
}

// GET /api/payables?status=&category=&creditor=&from=&to= -> lista + totales + proveedores
router.get("/", async (req, res, next) => {
  try {
    const items = await prisma.payable.findMany({ where: payableWhere(req.query), orderBy: [{ status: "asc" }, { dueDate: "asc" }, { id: "desc" }], take: 1000 });
    const withPending = items.map((p) => ({ ...p, pending: Math.max(0, p.totalAmount - p.paidAmount) }));
    const totals = withPending.reduce((a, p) => {
      a.total += p.totalAmount; a.paid += p.paidAmount; a.pending += p.pending; return a;
    }, { total: 0, paid: 0, pending: 0 });
    // Catalogo de proveedores (para el filtro), sin depender del filtro actual.
    const distinct = await prisma.payable.findMany({ where: { creditor: { not: null } }, distinct: ["creditor"], select: { creditor: true }, orderBy: { creditor: "asc" } });
    const creditors = distinct.map((d) => d.creditor).filter(Boolean);
    res.json({ items: withPending, totals, count: items.length, creditors });
  } catch (e) {
    next(e);
  }
});

// GET /api/payables/export?status=&category=&creditor=&from=&to= -> descarga lo filtrado
router.get("/export", async (req, res, next) => {
  try {
    const items = await prisma.payable.findMany({ where: payableWhere(req.query), orderBy: [{ dueDate: "asc" }, { id: "desc" }], take: 5000 });
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

// POST /api/payables/:id/pay -> registrar abono.
// Si viene boxCode, el abono genera un egreso de esa caja (descuenta el saldo) y
// valida fondos: si no alcanza devuelve 409 con el faltante (salvo force:true).
router.post("/:id/pay", async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const p = await prisma.payable.findUnique({ where: { id } });
    if (!p) return res.status(404).json({ error: "No existe" });
    const amount = Math.round(Number(req.body?.amount) || 0);
    if (amount <= 0) return res.status(400).json({ error: "amount > 0 obligatorio" });
    const boxCode = req.body?.boxCode ? String(req.body.boxCode) : null;
    const force = req.body?.force === true;
    const paidDate = req.body?.paidDate || iso();

    if (boxCode && !force) {
      const saldo = await boxBalance(boxCode);
      if (saldo < amount) {
        return res.status(409).json({ error: `Fondos insuficientes en ${boxCode}: saldo ${saldo}, faltan ${amount - saldo}`, saldo, faltan: amount - saldo });
      }
    }

    const paidAmount = p.paidAmount + amount;
    const updated = await prisma.$transaction(async (tx) => {
      const payment = await tx.payablePayment.create({
        data: {
          payableId: id, amount, paidDate,
          note: req.body?.note || null,
          voucherPath: req.body?.voucherPath || null,
          paidBy: req.body?.paidBy || null
        }
      });
      if (boxCode) {
        // El egreso queda ligado al ABONO (no a la cuenta) para poder anularlo exacto.
        await tx.cashMovement.create({ data: { boxCode, type: "egreso", amount, refType: "payable_payment", refId: payment.id, date: paidDate, note: `Pago: ${p.concept}` } });
      }
      return tx.payable.update({ where: { id }, data: { paidAmount, status: statusFor(p.totalAmount, paidAmount) } });
    });
    res.json({ ...updated, pending: Math.max(0, updated.totalAmount - updated.paidAmount) });
  } catch (e) {
    next(e);
  }
});

// DELETE /api/payables/:id/payments/:paymentId -> anula UN abono (corrige errores).
// Devuelve el dinero a la caja si el pago habia generado egreso y recalcula el estado.
router.put("/:id/payments/:paymentId", async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const paymentId = Number(req.params.paymentId);
    const p = await prisma.payable.findUnique({ where: { id } });
    if (!p) return res.status(404).json({ error: "No existe" });
    const pay = await prisma.payablePayment.findUnique({ where: { id: paymentId } });
    if (!pay || pay.payableId !== id) return res.status(404).json({ error: "No existe el abono" });

    const b = req.body || {};
    const amount = b.amount != null ? Math.round(Number(b.amount) || 0) : pay.amount;
    if (amount <= 0) return res.status(400).json({ error: "amount > 0 obligatorio" });
    const paidDate = b.paidDate != null ? String(b.paidDate || iso()) : pay.paidDate;
    const paidBy = b.paidBy !== undefined ? (b.paidBy || null) : pay.paidBy;
    const note = b.note !== undefined ? (b.note || null) : pay.note;
    const voucherPath = b.voucherPath !== undefined ? (b.voucherPath || null) : pay.voucherPath;
    const force = b.force === true;

    const currentEgreso = await findPaymentCashOut(prisma, { payableId: id, paymentId, payment: pay });
    if (currentEgreso && !force && amount > pay.amount) {
      const saldoDisponible = await boxBalance(currentEgreso.boxCode) + pay.amount;
      if (saldoDisponible < amount) {
        return res.status(409).json({
          error: `Fondos insuficientes en ${currentEgreso.boxCode}: saldo disponible ${saldoDisponible}, faltan ${amount - saldoDisponible}`,
          saldo: saldoDisponible,
          faltan: amount - saldoDisponible
        });
      }
    } else if (!currentEgreso && b.boxCode && !force) {
      const saldoDisponible = await boxBalance(String(b.boxCode));
      if (saldoDisponible < amount) {
        return res.status(409).json({
          error: `Fondos insuficientes en ${String(b.boxCode)}: saldo ${saldoDisponible}, faltan ${amount - saldoDisponible}`,
          saldo: saldoDisponible,
          faltan: amount - saldoDisponible
        });
      }
    }

    const updated = await prisma.$transaction(async (tx) => {
      const payment = await tx.payablePayment.update({
        where: { id: paymentId },
        data: { amount, paidDate, paidBy, note, voucherPath }
      });
      const egreso = await findPaymentCashOut(tx, { payableId: id, paymentId, payment: pay });
      if (egreso) {
        await tx.cashMovement.update({
          where: { id: egreso.id },
          data: { amount, date: paidDate, note: `Pago: ${p.concept}` }
        });
      } else if (b.boxCode) {
        await tx.cashMovement.create({ data: { boxCode: String(b.boxCode), type: "egreso", amount, refType: "payable_payment", refId: paymentId, date: paidDate, note: `Pago: ${p.concept}` } });
      }
      const paidAmount = Math.max(0, p.paidAmount - pay.amount + amount);
      const payable = await tx.payable.update({ where: { id }, data: { paidAmount, status: statusFor(p.totalAmount, paidAmount) } });
      return { payment, payable };
    });
    res.json({ ...updated.payable, pending: Math.max(0, updated.payable.totalAmount - updated.payable.paidAmount), payment: updated.payment });
  } catch (e) {
    next(e);
  }
});

router.delete("/:id/payments/:paymentId", async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const paymentId = Number(req.params.paymentId);
    const p = await prisma.payable.findUnique({ where: { id } });
    if (!p) return res.status(404).json({ error: "No existe" });
    const pay = await prisma.payablePayment.findUnique({ where: { id: paymentId } });
    if (!pay || pay.payableId !== id) return res.status(404).json({ error: "No existe el abono" });

    const updated = await prisma.$transaction(async (tx) => {
      // Devuelve a la caja exactamente el egreso de ESTE abono (si lo genero).
      const egreso = await findPaymentCashOut(tx, { payableId: id, paymentId, payment: pay });
      if (egreso) {
        await tx.cashMovement.create({ data: { boxCode: egreso.boxCode, type: "ingreso", amount: egreso.amount, refType: "payable_void", refId: id, date: iso(), note: `Anula abono #${paymentId} de: ${p.concept}` } });
      }
      await tx.payablePayment.delete({ where: { id: paymentId } });
      const paidAmount = Math.max(0, p.paidAmount - pay.amount);
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
    await prisma.$transaction(async (tx) => {
      // Revierte los egresos de caja generados por los pagos de esta cuenta:
      // los ligados a cada abono (payable_payment) y los antiguos ligados a la cuenta (payable).
      const pagos = await tx.payablePayment.findMany({ where: { payableId: id }, select: { id: true } });
      const egresos = await tx.cashMovement.findMany({
        where: {
          type: "egreso",
          OR: [
            { refType: "payable", refId: id },
            { refType: "payable_payment", refId: { in: pagos.map((x) => x.id) } }
          ]
        }
      });
      for (const m of egresos) {
        await tx.cashMovement.create({ data: { boxCode: m.boxCode, type: "ingreso", amount: m.amount, refType: "payable_void", refId: id, date: iso(), note: `Reversa pago cuenta #${id}` } });
      }
      await tx.payablePayment.deleteMany({ where: { payableId: id } });
      await tx.payable.delete({ where: { id } });
    });
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

export default router;
