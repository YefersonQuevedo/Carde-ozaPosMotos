import { Router } from "express";
import { prisma } from "../db.js";

const router = Router();

// Clave estable: allyId si existe, si no el nombre (compatibilidad con datos viejos).
const allyKey = (allyId, allyName) => (allyId != null ? `id:${allyId}` : `nm:${allyName}`);

// Devengado por convenio = suma de comisiones (deduction) en ventas de referidos.
async function accruedByAlly() {
  const sales = await prisma.sale.findMany({
    where: { allyType: "referido", deduction: { gt: 0 }, status: "activa" },
    select: { allyId: true, allyName: true, deduction: true, pinAdquirido: true }
  });
  const map = {};
  for (const s of sales) {
    const k = allyKey(s.allyId, s.allyName);
    const m = (map[k] ||= { allyId: s.allyId ?? null, allyName: s.allyName, accrued: 0, rtm: 0 });
    m.accrued += s.deduction;
    if (s.pinAdquirido > 0) m.rtm += 1;
  }
  return map;
}

async function paidByAlly() {
  const pays = await prisma.allyPayment.findMany({ select: { allyId: true, allyName: true, amount: true } });
  const map = {};
  for (const p of pays) {
    const k = allyKey(p.allyId, p.allyName);
    const m = (map[k] ||= { allyId: p.allyId ?? null, allyName: p.allyName, paid: 0 });
    m.paid += p.amount;
  }
  return map;
}

// GET /api/ally-payments  -> reporte: devengado / pagado / pendiente por convenio.
router.get("/", async (_req, res, next) => {
  try {
    const accrued = await accruedByAlly();
    const paid = await paidByAlly();
    const keys = new Set([...Object.keys(accrued), ...Object.keys(paid)]);
    const items = [...keys]
      .map((k) => {
        const a = accrued[k];
        const p = paid[k];
        const acc = a?.accrued || 0;
        const paidV = p?.paid || 0;
        return {
          allyId: a?.allyId ?? p?.allyId ?? null,
          allyName: a?.allyName ?? p?.allyName ?? "",
          accrued: acc,
          rtm: a?.rtm || 0,
          paid: paidV,
          pending: acc - paidV
        };
      })
      .sort((x, y) => y.pending - x.pending);
    const totals = items.reduce(
      (t, i) => ({ accrued: t.accrued + i.accrued, paid: t.paid + i.paid, pending: t.pending + i.pending }),
      { accrued: 0, paid: 0, pending: 0 }
    );
    res.json({ items, totals });
  } catch (e) {
    next(e);
  }
});

// GET /api/ally-payments/:name  -> detalle de un convenio (ventas + pagos).
router.get("/:name", async (req, res, next) => {
  try {
    const name = req.params.name;
    const [sales, payments] = await Promise.all([
      prisma.sale.findMany({
        where: { allyName: name, allyType: "referido", deduction: { gt: 0 }, status: "activa" },
        select: { saleNumber: true, saleDate: true, plate: true, clientName: true, deduction: true, pinAdquirido: true },
        orderBy: { saleDate: "desc" }
      }),
      prisma.allyPayment.findMany({ where: { allyName: name }, orderBy: { paidDate: "desc" } })
    ]);
    const accrued = sales.reduce((s, v) => s + v.deduction, 0);
    const paid = payments.reduce((s, v) => s + v.amount, 0);
    res.json({ allyName: name, accrued, paid, pending: accrued - paid, sales, payments });
  } catch (e) {
    next(e);
  }
});

// POST /api/ally-payments  -> registrar un pago a un convenio.
router.post("/", async (req, res, next) => {
  try {
    const b = req.body || {};
    if (!b.allyName || !(Number(b.amount) > 0)) return res.status(400).json({ error: "allyName y amount son obligatorios" });
    const payment = await prisma.allyPayment.create({
      data: {
        allyId: b.allyId ? Number(b.allyId) : null,
        allyName: b.allyName,
        amount: Math.round(Number(b.amount)),
        paidDate: b.paidDate || new Date().toISOString().slice(0, 10),
        note: b.note || null
      }
    });
    res.status(201).json(payment);
  } catch (e) {
    next(e);
  }
});

// DELETE /api/ally-payments/:id  -> corregir/eliminar un pago.
router.delete("/:id", async (req, res, next) => {
  try {
    await prisma.allyPayment.delete({ where: { id: Number(req.params.id) } });
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

export default router;
