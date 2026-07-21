import { Router } from "express";
import { prisma } from "../db.js";
import { currentCompanyId } from "../tenant.js";
import { toWorkbook, sendXlsx } from "../services/excel.js";

const router = Router();

const normalizePlate = (v) => String(v || "").trim().toUpperCase().replace(/\s+/g, "");

// --- Validaciones de cliente (Colombia) ---
const CO_MOBILE_RE = /^3\d{9}$/;                       // celular: 10 digitos, empieza en 3
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Deja solo digitos y descarta el prefijo 57 (+57): guardamos los 10 digitos pelados.
function normalizeCoPhone(raw) {
  let d = String(raw || "").replace(/\D/g, "");
  if (d.length === 12 && d.startsWith("57")) d = d.slice(2);
  return d;
}

// Normaliza la lista de telefonos: principal (`phone`) + adicionales (`phones`).
// Cada telefono debe ser un celular colombiano valido (10 digitos, empieza en 3).
function normalizePhones(b) {
  const list = [];
  if (Array.isArray(b.phones)) list.push(...b.phones);
  if (b.phone) list.unshift(b.phone);
  const clean = [...new Set(list.map((p) => normalizeCoPhone(p)).filter(Boolean))];
  for (const p of clean) {
    if (!CO_MOBILE_RE.test(p)) {
      throw Object.assign(new Error(`Telefono invalido: "${p}". Debe ser un celular de 10 digitos que empiece en 3.`), { status: 400 });
    }
  }
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
async function computeDirectoReferido() {
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
    const laterReferido = events.find(
      (e) => e.eventType === "referido" && (e.year > firstDirecto.year || (e.year === firstDirecto.year && e.id > firstDirecto.id))
    );
    if (!laterReferido) continue;
    const client = await prisma.client.findFirst({ where: { docNumber: doc } });
    result.push({
      docNumber: doc, name: client?.name || doc,
      directoYear: firstDirecto.year, referidoYear: laterReferido.year,
      referidoBy: laterReferido.allyName || null,
      plate: laterReferido.plate || firstDirecto.plate || null
    });
  }
  return result;
}

router.get("/reports/directo-referido", async (_req, res, next) => {
  try {
    res.json({ items: await computeDirectoReferido() });
  } catch (e) {
    next(e);
  }
});

router.get("/reports/directo-referido/export", async (_req, res, next) => {
  try {
    const items = await computeDirectoReferido();
    const buf = await toWorkbook({
      sheets: [{
        name: "Directo-Referido", title: "Clientes que pasaron de directo a referido",
        columns: [
          { header: "Cliente", key: "name", width: 28 }, { header: "Documento", key: "docNumber", width: 16 },
          { header: "Año directo", key: "directoYear", width: 12, number: true }, { header: "Año referido", key: "referidoYear", width: 12, number: true },
          { header: "Lo refirio", key: "referidoBy", width: 22 }, { header: "Placa", key: "plate", width: 10 }
        ],
        rows: items
      }]
    });
    sendXlsx(res, buf, "directo-referido.xlsx");
  } catch (e) {
    next(e);
  }
});

router.get("/:docNumber", async (req, res, next) => {
  try {
    const client = await prisma.client.findFirst({ where: { docNumber: req.params.docNumber } });
    if (!client) return res.status(404).json({ error: "No existe" });
    const [vehicles, history] = await Promise.all([
      prisma.vehicle.findMany({ where: { clientDoc: client.docNumber } }),
      prisma.clientHistory.findMany({ where: { clientDoc: client.docNumber }, orderBy: { id: "desc" }, take: 100 })
    ]);
    // Marca los eventos cuya venta fue anulada: la anulación no borra el historial
    // (queda como rastro), pero el cliente debe verlos señalados como anulados.
    const saleIds = [...new Set(history.map((h) => h.saleId).filter((id) => id != null))];
    const voidedIds = new Set();
    if (saleIds.length) {
      const sales = await prisma.sale.findMany({ where: { id: { in: saleIds }, status: "anulada" }, select: { id: true } });
      for (const s of sales) voidedIds.add(s.id);
    }
    const historyMarked = history.map((h) => ({ ...h, voided: h.saleId != null && voidedIds.has(h.saleId) }));
    res.json({ ...client, vehicles, history: historyMarked });
  } catch (e) {
    next(e);
  }
});

// Crear o actualizar (upsert por docNumber).
router.post("/", async (req, res, next) => {
  try {
    const b = req.body || {};
    if (!b.docNumber || !b.name) return res.status(400).json({ error: "docNumber y name son obligatorios" });

    // Nombre: minimo 3 caracteres y que no sea solo numeros.
    const name = String(b.name).trim();
    if (name.length < 3 || /^\d+$/.test(name)) {
      return res.status(400).json({ error: "El nombre debe tener al menos 3 caracteres y no puede ser solo numeros." });
    }
    // Documento: solo numeros. CC 6-10 digitos, NIT 9-10 digitos.
    const docType = b.docType || (b.personType === "JURIDICA" ? "NIT" : "CC");
    const docNumber = String(b.docNumber).trim();
    if (!/^\d+$/.test(docNumber)) {
      return res.status(400).json({ error: "El documento debe contener solo numeros." });
    }
    const docOk = docType === "NIT" ? /^\d{9,10}$/.test(docNumber) : /^\d{6,10}$/.test(docNumber);
    if (!docOk) {
      return res.status(400).json({ error: docType === "NIT" ? "El NIT debe tener 9 o 10 digitos." : "La cedula debe tener entre 6 y 10 digitos." });
    }
    // Email opcional, pero si viene debe tener formato valido.
    const email = String(b.email || "").trim();
    if (email && !EMAIL_RE.test(email)) {
      return res.status(400).json({ error: "El email no tiene un formato valido." });
    }

    const { phone, phones } = normalizePhones(b);
    const data = {
      docType,
      docNumber,
      dv: b.dv || null,
      personType: b.personType || (docType === "NIT" ? "JURIDICA" : "NATURAL"),
      name,
      commercialName: b.commercialName || null,
      email: email || null,
      phone,
      phones,
      address: b.address || null,
      status: b.status || "ACTIVO"
    };
    const client = await prisma.client.upsert({
      where: { companyId_docNumber: { companyId: currentCompanyId(), docNumber: data.docNumber } },
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
    await prisma.client.deleteMany({ where: { docNumber } });
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

export default router;
