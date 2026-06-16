// Facturacion electronica DIAN: configuracion de apidian + trazabilidad de envios.
// Permite ver que facturas estan en la DIAN (aceptadas), cuales no (pendientes/
// rechazadas) y el detalle (CUFE, track id, mensajes, reintentos).
import { Router } from "express";
import { prisma } from "../db.js";
import { currentCompanyId } from "../tenant.js";
import { sendInvoiceToApidian } from "../services/dian.js";
import { toWorkbook, sendXlsx } from "../services/excel.js";

const router = Router();

// Config DIAN de LA EMPRESA del request (una fila por empresa).
async function getConfig() {
  let cfg = await prisma.dianConfig.findFirst();
  if (!cfg) cfg = await prisma.dianConfig.create({ data: {} });
  return cfg;
}

// GET /api/dian/config
router.get("/config", async (_req, res, next) => {
  try {
    res.json(await getConfig());
  } catch (e) {
    next(e);
  }
});

// PUT /api/dian/config  -> actualiza la fila unica
router.put("/config", async (req, res, next) => {
  try {
    const b = req.body || {};
    const data = {
      companyNit: b.companyNit ?? null, companyDv: b.companyDv ?? null, companyName: b.companyName ?? null,
      apidianUrl: b.apidianUrl ?? null, apidianToken: b.apidianToken ?? null, testSetId: b.testSetId ?? null,
      softwareId: b.softwareId ?? null, softwarePin: b.softwarePin ?? null,
      environment: Number(b.environment) || 2, resolution: b.resolution ?? null, prefix: b.prefix ?? null,
      emailApiUrl: b.emailApiUrl ?? null, active: !!b.active
    };
    const cfg = await prisma.dianConfig.upsert({ where: { companyId: currentCompanyId() }, update: data, create: data });
    res.json(cfg);
  } catch (e) {
    next(e);
  }
});

// GET /api/dian/iva  -> IVA cobrado en las facturas EMITIDAS electronicamente.
// Cada Invoice es una factura emitida (al registrar la venta con facturacion); las ventas
// sin facturar no generan Invoice y las anuladas borran el suyo, asi que basta sumar todas.
// Es lo que se muestra en el tablero de caja como "Provision IVA" / "IVA facturado".
router.get("/iva", async (req, res, next) => {
  try {
    const where = {};
    if (req.query.from || req.query.to) {
      where.issuedAt = {};
      if (req.query.from) where.issuedAt.gte = new Date(String(req.query.from));
      if (req.query.to) where.issuedAt.lte = new Date(String(req.query.to) + "T23:59:59");
    }
    const agg = await prisma.invoice.aggregate({ where, _sum: { iva: true, base: true, total: true }, _count: true });
    res.json({ iva: agg._sum.iva || 0, base: agg._sum.base || 0, total: agg._sum.total || 0, count: agg._count || 0 });
  } catch (e) {
    next(e);
  }
});

// GET /api/dian/invoices?status=&from=&to=  -> trazabilidad (factura + venta)
router.get("/invoices", async (req, res, next) => {
  try {
    const where = {};
    if (req.query.status) where.sendStatus = String(req.query.status);
    const invoices = await prisma.invoice.findMany({ where, orderBy: { id: "desc" }, take: 1000 });
    const saleIds = invoices.map((i) => i.saleId);
    const sales = saleIds.length ? await prisma.sale.findMany({ where: { id: { in: saleIds } }, select: { id: true, saleNumber: true, saleDate: true, clientName: true, clientDoc: true, plate: true } }) : [];
    const saleById = Object.fromEntries(sales.map((s) => [s.id, s]));
    const items = invoices.map((i) => ({
      id: i.id, number: i.number, cufe: i.cufe, sendStatus: i.sendStatus, dianIsValid: i.dianIsValid,
      dianTrackId: i.dianTrackId, dianMessages: i.dianMessages, lastSentAt: i.lastSentAt, retries: i.retries,
      total: i.total, environment: i.environment,
      sale: saleById[i.saleId] || null
    }));
    // Resumen por estado.
    const summary = items.reduce((acc, i) => { acc[i.sendStatus] = (acc[i.sendStatus] || 0) + 1; return acc; }, {});
    res.json({ items, summary, count: items.length });
  } catch (e) {
    next(e);
  }
});

// POST /api/dian/invoices/:id/send  -> envia a apidian y guarda la trazabilidad
router.post("/invoices/:id/send", async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const invoice = await prisma.invoice.findUnique({ where: { id } });
    if (!invoice) return res.status(404).json({ error: "No existe la factura" });
    const config = await getConfig();
    const [sale, lines] = await Promise.all([
      prisma.sale.findUnique({ where: { id: invoice.saleId } }),
      prisma.saleLine.findMany({ where: { saleId: invoice.saleId } })
    ]);
    const client = sale ? await prisma.client.findFirst({ where: { docNumber: sale.clientDoc } }) : null;

    let result;
    try {
      result = await sendInvoiceToApidian({ invoice, sale, lines, client, config });
    } catch (err) {
      // Falla de conexion/config: guarda el mensaje e incrementa reintentos.
      await prisma.invoice.update({
        where: { id },
        data: { sendStatus: invoice.sendStatus === "ACEPTADA" ? "ACEPTADA" : "ENVIADA", dianMessages: err.message, lastSentAt: new Date(), retries: { increment: 1 } }
      });
      return res.status(err.status || 502).json({ error: err.message });
    }

    const updated = await prisma.invoice.update({
      where: { id },
      data: {
        cufe: result.cufe || invoice.cufe,
        sendStatus: result.sendStatus,
        dianIsValid: result.dianIsValid,
        dianTrackId: result.trackId,
        dianMessages: result.messages,
        qrUrl: result.qrUrl || invoice.qrUrl,
        environment: config.environment,
        softwareId: config.softwareId,
        lastSentAt: new Date(),
        validatedAt: result.dianIsValid ? new Date() : invoice.validatedAt,
        retries: { increment: 1 },
        dianStatus: result.dianIsValid === true ? "aceptada" : (result.dianIsValid === false ? "rechazada" : invoice.dianStatus)
      }
    });
    res.json({ ok: result.ok, invoice: updated, result });
  } catch (e) {
    next(e);
  }
});

// GET /api/dian/export  -> trazabilidad en Excel
router.get("/export", async (_req, res, next) => {
  try {
    const invoices = await prisma.invoice.findMany({ orderBy: { id: "desc" }, take: 5000 });
    const saleIds = invoices.map((i) => i.saleId);
    const sales = saleIds.length ? await prisma.sale.findMany({ where: { id: { in: saleIds } }, select: { id: true, clientName: true, saleDate: true } }) : [];
    const saleById = Object.fromEntries(sales.map((s) => [s.id, s]));
    const rows = invoices.map((i) => ({
      numero: i.number, fecha: saleById[i.saleId]?.saleDate || "", cliente: saleById[i.saleId]?.clientName || "",
      estado: i.sendStatus, valida: i.dianIsValid === true ? "Si" : i.dianIsValid === false ? "No" : "",
      cufe: i.cufe || "", trackId: i.dianTrackId || "", mensajes: i.dianMessages || "", total: i.total
    }));
    const buf = await toWorkbook({
      sheets: [{
        name: "DIAN", title: "Trazabilidad facturacion electronica DIAN",
        columns: [
          { header: "Factura", key: "numero", width: 16 }, { header: "Fecha", key: "fecha", width: 12 },
          { header: "Cliente", key: "cliente", width: 26 }, { header: "Estado", key: "estado", width: 12 },
          { header: "Valida DIAN", key: "valida", width: 10 }, { header: "CUFE", key: "cufe", width: 40 },
          { header: "Track ID", key: "trackId", width: 24 }, { header: "Mensajes", key: "mensajes", width: 40 },
          { header: "Total", key: "total", width: 14, money: true }
        ],
        rows
      }]
    });
    sendXlsx(res, buf, "dian-trazabilidad.xlsx");
  } catch (e) {
    next(e);
  }
});

export default router;
