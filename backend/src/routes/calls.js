// Llamadas / vencimientos de RTM. La RTM es anual: vence ~1 ano despues de la
// ultima RTM realizada (pinAdquirido > 0) de cada placa. Sirve para saber a quien
// llamar entre dos fechas. Fuente: ventas + clientes (sin FK, por valor).
import { Router } from "express";
import { prisma } from "../db.js";

const router = Router();

const iso = (d) => d.toISOString().slice(0, 10);
function addYear(dateStr, years = 1) {
  const d = new Date(dateStr + "T00:00:00");
  d.setFullYear(d.getFullYear() + years);
  return iso(d);
}

// GET /api/calls?from=YYYY-MM-DD&to=YYYY-MM-DD
// Por defecto: desde hoy hasta +30 dias.
router.get("/", async (req, res, next) => {
  try {
    const today = iso(new Date());
    const from = String(req.query.from || today);
    let hasta = String(req.query.to || "");
    if (!hasta) {
      const d = new Date(today + "T00:00:00");
      d.setDate(d.getDate() + 30);
      hasta = iso(d);
    }

    // RTM realizadas (placa con pin), ventas activas.
    const sales = await prisma.sale.findMany({
      where: { status: "activa", pinAdquirido: { gt: 0 }, plate: { not: null } },
      select: { plate: true, saleDate: true, clientDoc: true, clientName: true, modelYear: true, rangeName: true },
      orderBy: { saleDate: "desc" }
    });

    // Ultima RTM por placa.
    const lastByPlate = new Map();
    for (const s of sales) {
      if (!lastByPlate.has(s.plate)) lastByPlate.set(s.plate, s);
    }

    // Telefonos por cliente (para llamar).
    const docs = [...new Set([...lastByPlate.values()].map((s) => s.clientDoc))];
    const clients = docs.length ? await prisma.client.findMany({ where: { docNumber: { in: docs } } }) : [];
    const phoneByDoc = Object.fromEntries(clients.map((c) => [c.docNumber, c.phone || (Array.isArray(c.phones) ? c.phones[0] : null) || ""]));

    const items = [];
    for (const s of lastByPlate.values()) {
      const dueDate = addYear(s.saleDate, 1);
      if (dueDate >= from && dueDate <= hasta) {
        items.push({
          plate: s.plate,
          clientDoc: s.clientDoc,
          clientName: s.clientName,
          phone: phoneByDoc[s.clientDoc] || "",
          lastRtm: s.saleDate,
          dueDate,
          modelYear: s.modelYear,
          rangeName: s.rangeName
        });
      }
    }
    items.sort((a, b) => a.dueDate.localeCompare(b.dueDate));
    res.json({ from, to: hasta, count: items.length, items });
  } catch (e) {
    next(e);
  }
});

export default router;
