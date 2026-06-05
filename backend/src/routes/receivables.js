import { Router } from "express";
import { prisma } from "../db.js";
import { sendXlsx, toWorkbook } from "../services/excel.js";

const router = Router();

const toInt = (value) => Math.max(0, Math.round(Number(value) || 0));
const isoDate = (value) => /^\d{4}-\d{2}-\d{2}$/.test(String(value || "")) ? String(value) : null;

function buildWhere(query = {}) {
  const where = {};
  const status = String(query.status || "").trim();
  const provider = String(query.provider || "").trim();
  const from = isoDate(query.from);
  const to = isoDate(query.to);
  const clientDoc = String(query.clientDoc || "").trim();
  const invoiceNumber = String(query.invoiceNumber || "").trim();

  if (status && status !== "todas") where.status = status;
  if (provider && provider !== "TODOS") where.provider = provider;
  if (from || to) where.dueFrom = { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) };
  if (clientDoc) where.clientDoc = { contains: clientDoc };
  if (invoiceNumber) where.invoiceNumber = { contains: invoiceNumber };
  return where;
}

function groupByProvider(items) {
  const map = {};
  for (const item of items) {
    const row = (map[item.provider] ||= {
      provider: item.provider,
      count: 0,
      amount: 0,
      pending: 0,
      paidNet: 0,
      ica: 0,
      retefuente: 0,
      transactionCost: 0,
      realCost: 0,
      netAfterCosts: 0
    });
    row.count += 1;
    row.amount += item.amount;
    row.pending += item.pending;
    row.paidNet += item.paidNet;
    row.ica += item.ica;
    row.retefuente += item.retefuente;
    row.transactionCost += item.transactionCost;
    row.realCost += item.realCost;
    row.netAfterCosts += item.netAfterCosts;
  }
  return Object.values(map).sort((a, b) => b.pending - a.pending);
}

async function receivableReport(query = {}) {
  const where = buildWhere(query);
  const items = await prisma.receivable.findMany({ where, orderBy: [{ dueFrom: "desc" }, { id: "desc" }], take: 1000 });
  const saleIds = [...new Set(items.map((r) => r.saleId).filter(Boolean))];
  const receivableIds = items.map((r) => r.id);

  const [sales, salePayments, payments] = await Promise.all([
    saleIds.length
      ? prisma.sale.findMany({
          where: { id: { in: saleIds } },
          select: { id: true, saleNumber: true, saleDate: true, clientName: true, total: true, invoiceNumber: true, status: true }
        })
      : [],
    saleIds.length
      ? prisma.salePayment.findMany({
          where: { saleId: { in: saleIds } },
          select: { saleId: true, methodName: true, methodCode: true, costAmount: true, costTax: true }
        })
      : [],
    receivableIds.length ? prisma.receivablePayment.findMany({ where: { receivableId: { in: receivableIds } }, orderBy: { paidDate: "desc" } }) : []
  ]);

  const saleById = Object.fromEntries(sales.map((s) => [s.id, s]));
  const paymentsByReceivable = payments.reduce((acc, p) => {
    (acc[p.receivableId] ||= []).push(p);
    return acc;
  }, {});
  const transactionCostBySaleProvider = {};
  for (const p of salePayments) {
    const provider = p.methodName || p.methodCode;
    const key = `${p.saleId}:${provider}`;
    transactionCostBySaleProvider[key] = (transactionCostBySaleProvider[key] || 0) + toInt(p.costAmount) + toInt(p.costTax);
  }

  const decorated = items.map((r) => {
    const sale = saleById[r.saleId] || {};
    const rowPayments = paymentsByReceivable[r.id] || [];
    const paidNet = rowPayments.reduce((s, p) => s + toInt(p.amount), 0);
    const ica = rowPayments.reduce((s, p) => s + toInt(p.ica), 0) || toInt(r.ica);
    const retefuente = rowPayments.reduce((s, p) => s + toInt(p.retefuente), 0) || toInt(r.retefuente);
    const transactionCost = transactionCostBySaleProvider[`${r.saleId}:${r.provider}`] || 0;
    const realCost = ica + retefuente + transactionCost;
    return {
      ...r,
      clientName: sale.clientName || "",
      saleNumber: sale.saleNumber || "",
      saleDate: sale.saleDate || r.dueFrom,
      saleStatus: sale.status || "",
      invoiceNumber: r.invoiceNumber || sale.invoiceNumber || "",
      transactionCost,
      paidNet,
      realCost,
      netAfterCosts: Math.max(0, toInt(r.amount) - realCost),
      payments: rowPayments
    };
  });

  const totals = decorated.reduce(
    (t, r) => ({
      count: t.count + 1,
      amount: t.amount + toInt(r.amount),
      pending: t.pending + toInt(r.pending),
      paidNet: t.paidNet + toInt(r.paidNet),
      ica: t.ica + toInt(r.ica),
      retefuente: t.retefuente + toInt(r.retefuente),
      transactionCost: t.transactionCost + toInt(r.transactionCost),
      realCost: t.realCost + toInt(r.realCost),
      netAfterCosts: t.netAfterCosts + toInt(r.netAfterCosts)
    }),
    { count: 0, amount: 0, pending: 0, paidNet: 0, ica: 0, retefuente: 0, transactionCost: 0, realCost: 0, netAfterCosts: 0 }
  );

  return { items: decorated, grouped: groupByProvider(decorated), totals, open: totals.pending };
}

// GET /api/receivables?status=abierta&provider=GORA&from=&to=&clientDoc=&invoiceNumber=
router.get("/", async (req, res, next) => {
  try {
    res.json({ ok: true, ...(await receivableReport(req.query)) });
  } catch (e) {
    next(e);
  }
});

// GET /api/receivables/export -> archivo Excel con cartera y resumen por proveedor.
router.get("/export", async (req, res, next) => {
  try {
    const report = await receivableReport(req.query);
    const buffer = await toWorkbook({
      sheets: [
        {
          name: "Cartera",
          title: "Cartera Gora / ADDI",
          columns: [
            { header: "Proveedor", key: "provider", width: 16 },
            { header: "# factura", key: "invoiceNumber", width: 18 },
            { header: "Documento", key: "clientDoc", width: 18 },
            { header: "Cliente", key: "clientName", width: 34 },
            { header: "Placa", key: "plate", width: 12 },
            { header: "Fecha", key: "dueFrom", width: 13 },
            { header: "Monto facturado", key: "amount", width: 16, money: true },
            { header: "Abono neto", key: "paidNet", width: 15, money: true },
            { header: "ICA", key: "ica", width: 12, money: true },
            { header: "Retencion", key: "retefuente", width: 14, money: true },
            { header: "Costo transaccion", key: "transactionCost", width: 18, money: true },
            { header: "Costo real", key: "realCost", width: 14, money: true },
            { header: "Pendiente", key: "pending", width: 14, money: true },
            { header: "Neto despues costos", key: "netAfterCosts", width: 20, money: true }
          ],
          rows: report.items,
          totals: report.totals
        },
        {
          name: "Resumen",
          title: "Resumen por proveedor",
          columns: [
            { header: "Proveedor", key: "provider", width: 16 },
            { header: "Facturas", key: "count", width: 12, number: true },
            { header: "Monto facturado", key: "amount", width: 16, money: true },
            { header: "Abono neto", key: "paidNet", width: 15, money: true },
            { header: "ICA", key: "ica", width: 12, money: true },
            { header: "Retencion", key: "retefuente", width: 14, money: true },
            { header: "Costo transaccion", key: "transactionCost", width: 18, money: true },
            { header: "Pendiente", key: "pending", width: 14, money: true },
            { header: "Neto despues costos", key: "netAfterCosts", width: 20, money: true }
          ],
          rows: report.grouped
        }
      ]
    });
    sendXlsx(res, buffer, `cartera-${new Date().toISOString().slice(0, 10)}.xlsx`);
  } catch (e) {
    next(e);
  }
});

// POST /api/receivables/:id/payments  -> registra abono neto + ICA/retefuente.
router.post("/:id/payments", async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const receivable = await prisma.receivable.findUnique({ where: { id } });
    if (!receivable) return res.status(404).json({ error: "Cartera no existe" });
    if (receivable.status === "anulada") return res.status(400).json({ error: "No se puede abonar una cartera anulada" });

    const amount = toInt(req.body?.amount);
    const ica = toInt(req.body?.ica);
    const retefuente = toInt(req.body?.retefuente);
    const covered = amount + ica + retefuente;
    const paidDate = isoDate(req.body?.paidDate) || new Date().toISOString().slice(0, 10);
    const invoiceNumber = String(req.body?.invoiceNumber || receivable.invoiceNumber || "").trim() || null;
    const paymentRef = String(req.body?.paymentRef || receivable.paymentRef || "").trim() || null;
    const note = String(req.body?.note || "").trim() || null;

    if (covered <= 0) return res.status(400).json({ error: "El abono debe tener monto, ICA o retencion" });
    if (receivable.provider.toUpperCase() === "GORA" && !invoiceNumber) {
      return res.status(400).json({ error: "Gora requiere numero de factura" });
    }

    const result = await prisma.$transaction(async (tx) => {
      const payment = await tx.receivablePayment.create({
        data: { receivableId: id, provider: receivable.provider, invoiceNumber, amount, ica, retefuente, paidDate, note }
      });
      const pending = Math.max(0, toInt(receivable.pending) - covered);
      const updated = await tx.receivable.update({
        where: { id },
        data: {
          pending,
          status: pending === 0 ? "pagada" : "abierta",
          paidAt: pending === 0 ? new Date() : receivable.paidAt,
          invoiceNumber,
          paymentRef,
          ica: toInt(receivable.ica) + ica,
          retefuente: toInt(receivable.retefuente) + retefuente
        }
      });
      return { payment, receivable: updated };
    });
    res.status(201).json({ ok: true, ...result });
  } catch (e) {
    next(e);
  }
});

// POST /api/receivables/:id/pay  -> marca como pagada (verificacion manual).
router.post("/:id/pay", async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const updated = await prisma.receivable.update({
      where: { id },
      data: { status: "pagada", pending: 0, paidAt: new Date() }
    });
    res.json(updated);
  } catch (e) {
    next(e);
  }
});

export default router;
