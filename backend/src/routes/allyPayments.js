import { Router } from "express";
import { prisma } from "../db.js";

const router = Router();

// Clave estable: allyId si existe, si no el nombre (compatibilidad con datos viejos).
const allyKey = (allyId, allyName) => (allyId != null ? `id:${allyId}` : `nm:${allyName}`);
const today = () => new Date().toISOString().slice(0, 10);
const toInt = (value) => Math.max(0, Math.round(Number(value) || 0));
const asList = (value) => Array.isArray(value) ? value.filter(Boolean) : [];

async function nextManualInvoiceNumber(tx) {
  const count = await tx.manualInvoice.count();
  return `MAN-${String(count + 1).padStart(4, "0")}`;
}

// Devengado por convenio = suma de comisiones (deduction) en ventas de referidos.
async function accruedByAlly() {
  const sales = await prisma.sale.findMany({
    where: { allyType: "referido", deduction: { gt: 0 }, status: "activa" },
    select: { allyId: true, allyName: true, deduction: true, pinAdquirido: true, plate: true }
  });
  const map = {};
  for (const s of sales) {
    const k = allyKey(s.allyId, s.allyName);
    const m = (map[k] ||= { allyId: s.allyId ?? null, allyName: s.allyName, accrued: 0, rtm: 0, plates: new Set() });
    m.accrued += s.deduction;
    if (s.pinAdquirido > 0) m.rtm += 1;
    if (s.plate) m.plates.add(s.plate);
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
          convenioCount: a?.rtm || 0,
          plateCount: a?.plates?.size || 0,
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
    const [ally, sales, payments] = await Promise.all([
      prisma.ally.findFirst({ where: { name } }),
      prisma.sale.findMany({
        where: { allyName: name, allyType: "referido", deduction: { gt: 0 }, status: "activa" },
        select: { saleNumber: true, saleDate: true, plate: true, clientDoc: true, clientName: true, invoiceNumber: true, deduction: true, pinAdquirido: true },
        orderBy: { saleDate: "desc" }
      }),
      prisma.allyPayment.findMany({ where: { allyName: name }, orderBy: { paidDate: "desc" } })
    ]);
    const accrued = sales.reduce((s, v) => s + v.deduction, 0);
    const paid = payments.reduce((s, v) => s + v.amount, 0);
    const plates = [...new Set(sales.map((s) => s.plate).filter(Boolean))];
    res.json({
      ally,
      allyName: name,
      accrued,
      paid,
      pending: accrued - paid,
      convenioCount: sales.length,
      plates,
      sales,
      payments
    });
  } catch (e) {
    next(e);
  }
});

// POST /api/ally-payments  -> registrar un pago a un convenio.
router.post("/", async (req, res, next) => {
  try {
    const b = req.body || {};
    const amount = toInt(b.amount);
    if (!b.allyName || amount <= 0) return res.status(400).json({ error: "allyName y amount son obligatorios" });

    const ally = b.allyId
      ? await prisma.ally.findUnique({ where: { id: Number(b.allyId) } })
      : await prisma.ally.findFirst({ where: { name: String(b.allyName) } });
    const plates = asList(b.plates);
    const convenioCount = toInt(b.convenioCount) || plates.length;
    const shouldInvoice = !!b.manualInvoice;
    const invoiceDoc = String(b.invoiceDoc || ally?.docNumber || ally?.holderDoc || "").trim();
    const invoiceName = String(b.invoiceName || ally?.name || b.allyName).trim();
    const paidDate = b.paidDate || today();

    if (shouldInvoice && !invoiceDoc) {
      return res.status(400).json({ error: "Para facturar a cedula/NIT falta el documento del convenio" });
    }

    const result = await prisma.$transaction(async (tx) => {
      let invoiceNumber = String(b.invoiceNumber || "").trim() || null;
      let manualInvoice = null;
      if (shouldInvoice) {
        invoiceNumber = await nextManualInvoiceNumber(tx);
        manualInvoice = await tx.manualInvoice.create({
          data: {
            number: invoiceNumber,
            clientDoc: invoiceDoc,
            clientName: invoiceName,
            date: paidDate,
            concept: `Comisiones convenio ${b.allyName}`,
            base: amount,
            iva: 0,
            total: amount,
            source: "convenio"
          }
        });
        await tx.manualInvoiceLine.create({
          data: {
            invoiceId: manualInvoice.id,
            description: `Comisiones convenio ${b.allyName}`,
            quantity: convenioCount || 1,
            unitPrice: convenioCount > 0 ? Math.round(amount / convenioCount) : amount,
            taxRate: 0,
            base: amount,
            tax: 0,
            total: amount
          }
        });
      }

      const payment = await tx.allyPayment.create({
        data: {
          allyId: b.allyId ? Number(b.allyId) : ally?.id ?? null,
          allyName: b.allyName,
          amount,
          paidDate,
          note: b.note || null,
          voucherPath: b.voucherPath || null,
          invoiceNumber,
          plates,
          convenioCount
        }
      });

      if (b.sendToProvision !== false) {
        await tx.cashMovement.create({
          data: {
            boxCode: "PROV_CONV",
            type: "ingreso",
            amount,
            refType: "ally_payment",
            refId: payment.id,
            date: paidDate,
            note: `Convenio ${b.allyName}`
          }
        });
      }

      return { payment, manualInvoice };
    });
    res.status(201).json(result);
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
