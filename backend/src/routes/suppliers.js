import { Router } from "express";
import { prisma } from "../db.js";
import { sendXlsx, toWorkbook } from "../services/excel.js";

const router = Router();
const toInt = (value) => Math.max(0, Math.round(Number(value) || 0));

function supplierData(body = {}) {
  return {
    docType: body.docType || "NIT",
    docNumber: String(body.docNumber || "").trim(),
    name: String(body.name || "").trim(),
    email: body.email || null,
    phone: body.phone || null,
    address: body.address || null,
    paymentMethod: body.paymentMethod || null,
    active: body.active !== false
  };
}

async function supplierInvoiceData(body = {}) {
  const supplierId = body.supplierId ? Number(body.supplierId) : null;
  const supplier = supplierId ? await prisma.supplier.findUnique({ where: { id: supplierId } }) : null;
  const base = toInt(body.base);
  const iva = toInt(body.iva);
  const total = toInt(body.total) || base + iva;
  return {
    supplierId,
    supplierDoc: supplier?.docNumber || String(body.supplierDoc || "").trim() || null,
    supplierName: supplier?.name || String(body.supplierName || "").trim(),
    number: String(body.number || "").trim(),
    date: String(body.date || new Date().toISOString().slice(0, 10)),
    dueDate: body.dueDate ? String(body.dueDate) : null,
    concept: String(body.concept || "").trim() || null,
    natureCode: String(body.natureCode || "").trim() || null,
    base,
    iva,
    total,
    deductible: body.deductible !== false,
    source: String(body.source || "manual").trim() || "manual",
    filePath: String(body.filePath || "").trim() || null,
    status: body.status || "pendiente",
    paidAmount: toInt(body.paidAmount),
    paidDate: body.paidDate ? String(body.paidDate) : null,
    note: String(body.note || "").trim() || null
  };
}

function invoiceWhere(query = {}) {
  const where = {};
  if (query.from || query.to) where.date = { ...(query.from ? { gte: String(query.from) } : {}), ...(query.to ? { lte: String(query.to) } : {}) };
  if (query.status) where.status = String(query.status);
  if (query.supplierId) where.supplierId = Number(query.supplierId);
  if (query.natureCode) where.natureCode = String(query.natureCode);
  return where;
}

router.get("/", async (req, res, next) => {
  try {
    const q = String(req.query.q || "").trim();
    const where = q
      ? { OR: [{ name: { contains: q } }, { docNumber: { contains: q } }] }
      : {};
    const items = await prisma.supplier.findMany({ where, orderBy: { name: "asc" }, take: 200 });
    res.json({ items });
  } catch (e) {
    next(e);
  }
});

router.post("/", async (req, res, next) => {
  try {
    const data = supplierData(req.body);
    if (!data.docNumber || !data.name) return res.status(400).json({ error: "docNumber y name son obligatorios" });
    const supplier = await prisma.supplier.upsert({
      where: { docNumber: data.docNumber },
      update: data,
      create: data
    });
    res.status(201).json(supplier);
  } catch (e) {
    next(e);
  }
});

// GET /api/suppliers/invoices -> facturas recibidas de proveedores.
router.get("/invoices", async (req, res, next) => {
  try {
    const items = await prisma.supplierInvoice.findMany({
      where: invoiceWhere(req.query),
      orderBy: [{ date: "desc" }, { id: "desc" }],
      take: 500
    });
    const summary = items.reduce((acc, i) => {
      acc.total += i.total;
      acc.pending += Math.max(0, i.total - i.paidAmount);
      acc.iva += i.iva;
      if (i.deductible && i.status !== "anulada") acc.ivaDeductible += i.iva;
      return acc;
    }, { total: 0, pending: 0, iva: 0, ivaDeductible: 0 });
    res.json({ items, summary, count: items.length });
  } catch (e) {
    next(e);
  }
});

router.get("/invoices/export", async (req, res, next) => {
  try {
    const items = await prisma.supplierInvoice.findMany({
      where: invoiceWhere(req.query),
      orderBy: [{ date: "desc" }, { id: "desc" }],
      take: 5000
    });
    const invoiceIds = items.map((i) => i.id);
    const payments = invoiceIds.length ? await prisma.supplierInvoicePayment.findMany({
      where: { invoiceId: { in: invoiceIds } },
      orderBy: [{ paidDate: "desc" }, { id: "desc" }]
    }) : [];
    const totals = items.reduce((acc, i) => {
      acc.base += i.base;
      acc.iva += i.iva;
      acc.total += i.total;
      acc.paidAmount += i.paidAmount;
      acc.pending += Math.max(0, i.total - i.paidAmount);
      acc.ivaDeductible += i.deductible && i.status !== "anulada" ? i.iva : 0;
      return acc;
    }, { base: 0, iva: 0, total: 0, paidAmount: 0, pending: 0, ivaDeductible: 0 });
    const rows = items.map((i) => ({ ...i, pending: Math.max(0, i.total - i.paidAmount), ivaDeductible: i.deductible && i.status !== "anulada" ? i.iva : 0 }));
    const paymentsByInvoice = Object.fromEntries(items.map((i) => [i.id, i]));
    const paymentRows = payments.map((p) => ({
      ...p,
      supplierName: paymentsByInvoice[p.invoiceId]?.supplierName || "",
      invoiceNumber: paymentsByInvoice[p.invoiceId]?.number || ""
    }));
    const buffer = await toWorkbook({
      sheets: [
        {
          name: "Facturas recibidas",
          title: "Facturas recibidas de proveedores",
          columns: [
            { header: "Fecha", key: "date", width: 12 },
            { header: "Vence", key: "dueDate", width: 12 },
            { header: "Proveedor", key: "supplierName", width: 32 },
            { header: "NIT/Doc", key: "supplierDoc", width: 16 },
            { header: "Numero", key: "number", width: 18 },
            { header: "Concepto", key: "concept", width: 32 },
            { header: "Naturaleza", key: "natureCode", width: 18 },
            { header: "Base", key: "base", width: 14, money: true },
            { header: "IVA", key: "iva", width: 14, money: true },
            { header: "Total", key: "total", width: 14, money: true },
            { header: "Pagado", key: "paidAmount", width: 14, money: true },
            { header: "Pendiente", key: "pending", width: 14, money: true },
            { header: "IVA descontable", key: "ivaDeductible", width: 16, money: true },
            { header: "Estado", key: "status", width: 12 },
            { header: "Origen", key: "source", width: 14 },
            { header: "Archivo", key: "filePath", width: 36 }
          ],
          rows,
          totals
        },
        {
          name: "Pagos",
          title: "Pagos de facturas recibidas",
          columns: [
            { header: "Fecha pago", key: "paidDate", width: 12 },
            { header: "Proveedor", key: "supplierName", width: 32 },
            { header: "Factura", key: "invoiceNumber", width: 18 },
            { header: "Caja", key: "boxCode", width: 16 },
            { header: "Monto", key: "amount", width: 14, money: true },
            { header: "Nota", key: "note", width: 30 }
          ],
          rows: paymentRows,
          totals: { amount: paymentRows.reduce((a, p) => a + toInt(p.amount), 0) }
        }
      ]
    });
    sendXlsx(res, buffer, `facturas-recibidas-${new Date().toISOString().slice(0, 10)}.xlsx`);
  } catch (e) {
    next(e);
  }
});

router.post("/invoices", async (req, res, next) => {
  try {
    const data = await supplierInvoiceData(req.body);
    if (!data.supplierName || !data.number) return res.status(400).json({ error: "Proveedor y numero de factura son obligatorios" });
    if (data.total <= 0) return res.status(400).json({ error: "El total debe ser mayor a 0" });
    const invoice = await prisma.supplierInvoice.create({ data });
    res.status(201).json({ invoice });
  } catch (e) {
    next(e);
  }
});

router.post("/invoices/:id/pay", async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const current = await prisma.supplierInvoice.findUnique({ where: { id } });
    if (!current) return res.status(404).json({ error: "Factura recibida no existe" });
    if (current.status === "anulada") return res.status(400).json({ error: "La factura esta anulada" });
    const amount = toInt(req.body?.amount);
    if (amount <= 0) return res.status(400).json({ error: "El valor pagado debe ser mayor a 0" });
    const paidDate = req.body?.paidDate || new Date().toISOString().slice(0, 10);
    const boxCode = String(req.body?.boxCode || "CAJA_MENOR").trim() || "CAJA_MENOR";
    const payableAmount = Math.max(0, current.total - current.paidAmount);
    const appliedAmount = Math.min(payableAmount, amount);
    if (appliedAmount <= 0) return res.status(400).json({ error: "La factura ya esta pagada" });
    const paidAmount = current.paidAmount + appliedAmount;
    const status = paidAmount >= current.total ? "pagada" : "parcial";
    const result = await prisma.$transaction(async (tx) => {
      const payment = await tx.supplierInvoicePayment.create({
        data: {
          invoiceId: id,
          amount: appliedAmount,
          paidDate,
          boxCode,
          note: String(req.body?.note || "").trim() || null
        }
      });
      await tx.cashMovement.create({
        data: {
          boxCode,
          type: "egreso",
          amount: appliedAmount,
          refType: "supplier_invoice_payment",
          refId: payment.id,
          date: paidDate,
          note: `Pago factura recibida ${current.number} - ${current.supplierName}`
        }
      });
      const invoice = await tx.supplierInvoice.update({
        where: { id },
        data: { paidAmount, paidDate, status }
      });
      return { invoice, payment };
    });
    res.json(result);
  } catch (e) {
    next(e);
  }
});

router.post("/invoices/:id/void", async (req, res, next) => {
  try {
    const invoice = await prisma.supplierInvoice.update({
      where: { id: Number(req.params.id) },
      data: { status: "anulada" }
    });
    res.json({ invoice });
  } catch (e) {
    next(e);
  }
});

router.put("/:id", async (req, res, next) => {
  try {
    const data = supplierData(req.body);
    if (!data.docNumber || !data.name) return res.status(400).json({ error: "docNumber y name son obligatorios" });
    const supplier = await prisma.supplier.update({ where: { id: Number(req.params.id) }, data });
    res.json(supplier);
  } catch (e) {
    next(e);
  }
});

router.delete("/:id", async (req, res, next) => {
  try {
    const supplier = await prisma.supplier.update({ where: { id: Number(req.params.id) }, data: { active: false } });
    res.json({ supplier });
  } catch (e) {
    next(e);
  }
});

export default router;
