// Llamadas / vencimientos de RTM. La RTM es anual: vence ~1 ano despues de la
// ultima RTM realizada (pinAdquirido > 0) de cada placa. Sirve para saber a quien
// llamar entre dos fechas. Fuente: ventas + clientes (sin FK, por valor).
import { Router } from "express";
import { prisma } from "../db.js";
import { toWorkbook, sendXlsx } from "../services/excel.js";

const router = Router();

const iso = (d) => d.toISOString().slice(0, 10);
function addYear(dateStr, years = 1) {
  const d = new Date(dateStr + "T00:00:00");
  d.setFullYear(d.getFullYear() + years);
  return iso(d);
}

// Calcula los vencimientos (ultima RTM por placa + 1 año) dentro del rango.
async function computeCalls(from, hasta) {
  const sales = await prisma.sale.findMany({
    where: { status: "activa", pinAdquirido: { gt: 0 }, plate: { not: null } },
    select: { plate: true, saleDate: true, clientDoc: true, clientName: true, modelYear: true, rangeName: true },
    orderBy: { saleDate: "desc" }
  });
  const lastByPlate = new Map();
  for (const s of sales) if (!lastByPlate.has(s.plate)) lastByPlate.set(s.plate, s);

  const docs = [...new Set([...lastByPlate.values()].map((s) => s.clientDoc))];
  const clients = docs.length ? await prisma.client.findMany({ where: { docNumber: { in: docs } } }) : [];
  const phoneByDoc = Object.fromEntries(clients.map((c) => [c.docNumber, c.phone || (Array.isArray(c.phones) ? c.phones[0] : null) || ""]));

  const items = [];
  for (const s of lastByPlate.values()) {
    const dueDate = addYear(s.saleDate, 1);
    if (dueDate >= from && dueDate <= hasta) {
      items.push({ plate: s.plate, clientDoc: s.clientDoc, clientName: s.clientName, phone: phoneByDoc[s.clientDoc] || "", lastRtm: s.saleDate, dueDate, modelYear: s.modelYear, rangeName: s.rangeName });
    }
  }
  items.sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  return items;
}

function rangeFromQuery(req) {
  const today = iso(new Date());
  const from = String(req.query.from || today);
  let hasta = String(req.query.to || "");
  if (!hasta) { const d = new Date(today + "T00:00:00"); d.setDate(d.getDate() + 30); hasta = iso(d); }
  return { from, hasta };
}

// GET /api/calls?from=YYYY-MM-DD&to=YYYY-MM-DD  (por defecto: hoy hasta +30 dias)
router.get("/", async (req, res, next) => {
  try {
    const { from, hasta } = rangeFromQuery(req);
    const items = await computeCalls(from, hasta);
    res.json({ from, to: hasta, count: items.length, items });
  } catch (e) {
    next(e);
  }
});

// GET /api/calls/export?from=&to= -> Excel de los vencimientos
router.get("/export", async (req, res, next) => {
  try {
    const { from, hasta } = rangeFromQuery(req);
    const items = await computeCalls(from, hasta);
    const buf = await toWorkbook({
      sheets: [{
        name: "Llamadas", title: `Vencimientos RTM ${from} a ${hasta}`,
        columns: [
          { header: "Vence", key: "dueDate", width: 12 }, { header: "Placa", key: "plate", width: 10 },
          { header: "Cliente", key: "clientName", width: 28 }, { header: "Documento", key: "clientDoc", width: 16 },
          { header: "Telefono", key: "phone", width: 16 }, { header: "Ultima RTM", key: "lastRtm", width: 12 },
          { header: "Año", key: "modelYear", width: 8, number: true }, { header: "Rango", key: "rangeName", width: 22 }
        ],
        rows: items
      }]
    });
    sendXlsx(res, buf, `llamadas-${from}_${hasta}.xlsx`);
  } catch (e) {
    next(e);
  }
});

// ---------- Seguimiento de llamadas (CallLog) ----------
const CALL_STATUS = ["pendiente", "llamado", "no_contesta", "numero_errado", "contestado", "agendado", "vino", "no_vino"];

// GET /api/calls/logs?status=&clientDoc=&q= -> lista de gestiones
router.get("/logs", async (req, res, next) => {
  try {
    const where = {};
    if (req.query.status) where.status = String(req.query.status);
    if (req.query.clientDoc) where.clientDoc = String(req.query.clientDoc);
    const items = await prisma.callLog.findMany({ where, orderBy: [{ nextCallDate: "asc" }, { id: "desc" }], take: 1000 });
    const summary = items.reduce((a, c) => { a[c.status] = (a[c.status] || 0) + 1; return a; }, {});
    res.json({ items, summary, count: items.length });
  } catch (e) {
    next(e);
  }
});

// POST /api/calls/logs -> crea o actualiza (si trae id) una gestion de llamada
router.post("/logs", async (req, res, next) => {
  try {
    const b = req.body || {};
    if (b.status && !CALL_STATUS.includes(b.status)) return res.status(400).json({ error: "status invalido" });
    const data = {
      clientDoc: b.clientDoc || null, clientName: b.clientName || null, plate: b.plate || null, phone: b.phone || null,
      status: b.status || "pendiente", result: b.result || null, note: b.note || null,
      dueDate: b.dueDate || null, nextCallDate: b.nextCallDate || null, createdBy: b.createdBy || null
    };
    const log = b.id
      ? await prisma.callLog.update({ where: { id: Number(b.id) }, data })
      : await prisma.callLog.create({ data });
    res.json(log);
  } catch (e) {
    next(e);
  }
});

router.delete("/logs/:id", async (req, res, next) => {
  try {
    await prisma.callLog.delete({ where: { id: Number(req.params.id) } });
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

// GET /api/calls/logs/export
router.get("/logs/export", async (req, res, next) => {
  try {
    const where = {};
    if (req.query.status) where.status = String(req.query.status);
    const items = await prisma.callLog.findMany({ where, orderBy: [{ nextCallDate: "asc" }, { id: "desc" }], take: 5000 });
    const buf = await toWorkbook({
      sheets: [{
        name: "Gestion llamadas", title: "Seguimiento de llamadas",
        columns: [
          { header: "Cliente", key: "clientName", width: 26 }, { header: "Documento", key: "clientDoc", width: 16 },
          { header: "Placa", key: "plate", width: 10 }, { header: "Telefono", key: "phone", width: 16 },
          { header: "Estado", key: "status", width: 14 }, { header: "Vence", key: "dueDate", width: 12 },
          { header: "Proxima llamada", key: "nextCallDate", width: 14 }, { header: "Nota", key: "note", width: 36 }
        ],
        rows: items
      }]
    });
    sendXlsx(res, buf, "gestion-llamadas.xlsx");
  } catch (e) {
    next(e);
  }
});

// GET /api/calls/referidos -> rendimiento por referido + placas pendientes (provisionadas no realizadas)
router.get("/referidos", async (_req, res, next) => {
  try {
    const sales = await prisma.sale.findMany({
      where: { status: "activa", allyType: "referido" },
      select: { allyName: true, saleDate: true, plate: true, clientName: true, clientDoc: true, rtmStatus: true, provisionAmount: true, total: true }
    });
    const byAlly = {};
    for (const s of sales) {
      const name = s.allyName || "(sin nombre)";
      const a = (byAlly[name] ||= { referido: name, total: 0, realizadas: 0, pendientes: 0, montoPendiente: 0, porMes: {}, placasPendientes: [] });
      a.total += 1;
      const mes = (s.saleDate || "").slice(0, 7);
      a.porMes[mes] = (a.porMes[mes] || 0) + 1;
      if (s.rtmStatus === "pending") {
        a.pendientes += 1;
        a.montoPendiente += s.provisionAmount || s.total || 0;
        a.placasPendientes.push({ plate: s.plate, clientName: s.clientName, clientDoc: s.clientDoc, saleDate: s.saleDate, monto: s.provisionAmount || s.total || 0 });
      } else {
        a.realizadas += 1;
      }
    }
    const items = Object.values(byAlly).sort((a, b) => b.total - a.total);
    res.json({ items, count: items.length });
  } catch (e) {
    next(e);
  }
});

export default router;
