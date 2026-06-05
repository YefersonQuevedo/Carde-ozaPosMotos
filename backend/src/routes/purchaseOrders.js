import { Router } from "express";
import { prisma } from "../db.js";
import { sendXlsx, toWorkbook } from "../services/excel.js";

const router = Router();

const toInt = (value) => Math.max(0, Math.round(Number(value) || 0));

function calcLine(line = {}) {
  const quantity = Math.max(1, toInt(line.quantity) || 1);
  const unitPrice = toInt(line.unitPrice);
  const taxRate = toInt(line.taxRate);
  const total = quantity * unitPrice;
  const base = taxRate > 0 ? Math.round(total / (1 + taxRate / 100)) : total;
  const tax = total - base;
  return {
    description: String(line.description || "").trim(),
    quantity,
    unitPrice,
    taxRate,
    base,
    tax,
    total
  };
}

async function nextNumber(tx) {
  const count = await tx.purchaseOrder.count();
  return `OC-${String(count + 1).padStart(4, "0")}`;
}

router.get("/", async (req, res, next) => {
  try {
    const { from, to, supplierId } = req.query;
    const where = {};
    if (from || to) where.date = { ...(from ? { gte: String(from) } : {}), ...(to ? { lte: String(to) } : {}) };
    if (supplierId) where.supplierId = Number(supplierId);
    const items = await prisma.purchaseOrder.findMany({ where, orderBy: { id: "desc" }, take: 200 });
    res.json({ items });
  } catch (e) {
    next(e);
  }
});

router.get("/export", async (req, res, next) => {
  try {
    const { from, to } = req.query;
    const where = {};
    if (from || to) where.date = { ...(from ? { gte: String(from) } : {}), ...(to ? { lte: String(to) } : {}) };
    const items = await prisma.purchaseOrder.findMany({ where, orderBy: { id: "desc" }, take: 1000 });
    const totals = items.reduce((a, i) => ({ base: a.base + i.base, iva: a.iva + i.iva, total: a.total + i.total }), { base: 0, iva: 0, total: 0 });
    const buffer = await toWorkbook({
      sheets: [{
        name: "Ordenes",
        columns: [
          { header: "Numero", key: "number", width: 14 },
          { header: "Fecha", key: "date", width: 12 },
          { header: "Proveedor", key: "supplierName", width: 32 },
          { header: "Concepto", key: "concept", width: 32 },
          { header: "Base", key: "base", width: 14, money: true },
          { header: "IVA", key: "iva", width: 14, money: true },
          { header: "Total", key: "total", width: 14, money: true },
          { header: "Estado", key: "status", width: 12 }
        ],
        rows: items,
        totals
      }]
    });
    sendXlsx(res, buffer, `ordenes-compra-${new Date().toISOString().slice(0, 10)}.xlsx`);
  } catch (e) {
    next(e);
  }
});

router.get("/:id", async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const order = await prisma.purchaseOrder.findUnique({ where: { id } });
    if (!order) return res.status(404).json({ error: "Orden no existe" });
    const lines = await prisma.purchaseOrderLine.findMany({ where: { orderId: id } });
    res.json({ order, lines });
  } catch (e) {
    next(e);
  }
});

router.post("/", async (req, res, next) => {
  try {
    const b = req.body || {};
    const lines = (b.lines || []).map(calcLine).filter((l) => l.description && l.total > 0);
    if (!b.supplierName) return res.status(400).json({ error: "supplierName es obligatorio" });
    if (!lines.length) return res.status(400).json({ error: "Agrega al menos una linea" });
    const base = lines.reduce((s, l) => s + l.base, 0);
    const iva = lines.reduce((s, l) => s + l.tax, 0);
    const total = lines.reduce((s, l) => s + l.total, 0);

    const result = await prisma.$transaction(async (tx) => {
      const number = await nextNumber(tx);
      const order = await tx.purchaseOrder.create({
        data: {
          number,
          supplierId: b.supplierId ? Number(b.supplierId) : null,
          supplierName: String(b.supplierName).trim(),
          date: b.date || new Date().toISOString().slice(0, 10),
          concept: b.concept || null,
          note: b.note || null,
          base,
          iva,
          total
        }
      });
      await tx.purchaseOrderLine.createMany({ data: lines.map((l) => ({ ...l, orderId: order.id })) });
      return { order, lines };
    });
    res.status(201).json(result);
  } catch (e) {
    next(e);
  }
});

router.post("/:id/void", async (req, res, next) => {
  try {
    const order = await prisma.purchaseOrder.update({
      where: { id: Number(req.params.id) },
      data: { status: "anulada" }
    });
    res.json({ order });
  } catch (e) {
    next(e);
  }
});

export default router;
