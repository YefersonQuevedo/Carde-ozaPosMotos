import { Router } from "express";
import { prisma } from "../db.js";

const router = Router();

const normalizePlate = (v) => String(v || "").trim().toUpperCase().replace(/\s+/g, "");
// Normaliza la lista de telefonos: principal (`phone`) + adicionales (`phones`).
function normalizePhones(b) {
  const list = [];
  if (Array.isArray(b.phones)) list.push(...b.phones);
  if (b.phone) list.unshift(b.phone);
  const clean = [...new Set(list.map((p) => String(p || "").trim()).filter(Boolean))];
  return { phone: clean[0] || null, phones: clean.length > 1 ? clean.slice(1) : null };
}

// Buscar por documento, nombre o PLACA: GET /api/clients?q=...
router.get("/", async (req, res, next) => {
  try {
    const q = String(req.query.q || "").trim();
    const where = q
      ? { OR: [{ docNumber: { contains: q } }, { name: { contains: q } }] }
      : {};
    let items = await prisma.client.findMany({ where, take: 100, orderBy: { name: "asc" } });

    // Busqueda por placa: ubica el dueno aunque el texto sea una placa.
    if (q) {
      const vehicles = await prisma.vehicle.findMany({ where: { plate: { contains: normalizePlate(q) } }, take: 50 });
      const docs = [...new Set(vehicles.map((v) => v.clientDoc))];
      const known = new Set(items.map((c) => c.docNumber));
      const missing = docs.filter((d) => !known.has(d));
      if (missing.length) {
        const more = await prisma.client.findMany({ where: { docNumber: { in: missing } } });
        items = items.concat(more);
      }
    }
    res.json(items);
  } catch (e) {
    next(e);
  }
});

// Reporte: clientes que llegaron como directos y luego pasaron a referidos (posible abuso).
// GET /api/clients/reports/directo-referido
router.get("/reports/directo-referido", async (_req, res, next) => {
  try {
    const rows = await prisma.clientHistory.findMany({
      where: { eventType: { in: ["directo", "referido"] } },
      orderBy: [{ clientDoc: "asc" }, { year: "asc" }, { id: "asc" }]
    });
    const byDoc = {};
    for (const r of rows) (byDoc[r.clientDoc] ||= []).push(r);

    const result = [];
    for (const [doc, events] of Object.entries(byDoc)) {
      const firstDirecto = events.find((e) => e.eventType === "directo");
      if (!firstDirecto) continue;
      // referido posterior (en anio mayor o mas adelante en el log) al primer directo
      const laterReferido = events.find(
        (e) => e.eventType === "referido" && (e.year > firstDirecto.year || (e.year === firstDirecto.year && e.id > firstDirecto.id))
      );
      if (!laterReferido) continue;
      const client = await prisma.client.findUnique({ where: { docNumber: doc } });
      result.push({
        docNumber: doc,
        name: client?.name || doc,
        directoYear: firstDirecto.year,
        referidoYear: laterReferido.year,
        referidoBy: laterReferido.allyName || null,
        plate: laterReferido.plate || firstDirecto.plate || null
      });
    }
    res.json({ items: result });
  } catch (e) {
    next(e);
  }
});

router.get("/:docNumber", async (req, res, next) => {
  try {
    const client = await prisma.client.findUnique({ where: { docNumber: req.params.docNumber } });
    if (!client) return res.status(404).json({ error: "No existe" });
    const [vehicles, history] = await Promise.all([
      prisma.vehicle.findMany({ where: { clientDoc: client.docNumber } }),
      prisma.clientHistory.findMany({ where: { clientDoc: client.docNumber }, orderBy: { id: "desc" }, take: 100 })
    ]);
    res.json({ ...client, vehicles, history });
  } catch (e) {
    next(e);
  }
});

// Crear o actualizar (upsert por docNumber).
router.post("/", async (req, res, next) => {
  try {
    const b = req.body || {};
    if (!b.docNumber || !b.name) return res.status(400).json({ error: "docNumber y name son obligatorios" });
    const { phone, phones } = normalizePhones(b);
    const data = {
      docType: b.docType || "CC",
      docNumber: String(b.docNumber).trim(),
      dv: b.dv || null,
      personType: b.personType || (b.docType === "NIT" ? "JURIDICA" : "NATURAL"),
      name: b.name,
      commercialName: b.commercialName || null,
      email: b.email || null,
      phone,
      phones,
      address: b.address || null,
      status: b.status || "ACTIVO"
    };
    const client = await prisma.client.upsert({
      where: { docNumber: data.docNumber },
      update: data,
      create: data
    });
    res.json(client);
  } catch (e) {
    next(e);
  }
});

// Eliminar cliente y sus motos (sin FK: se borran por valor de docNumber).
router.delete("/:docNumber", async (req, res, next) => {
  try {
    const docNumber = req.params.docNumber;
    await prisma.vehicle.deleteMany({ where: { clientDoc: docNumber } });
    await prisma.client.delete({ where: { docNumber } });
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

export default router;
