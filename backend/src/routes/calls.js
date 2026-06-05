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

export default router;
