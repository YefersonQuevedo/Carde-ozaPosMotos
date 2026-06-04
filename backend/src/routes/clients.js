import { Router } from "express";
import { prisma } from "../db.js";

const router = Router();

// Buscar por documento o nombre: GET /api/clients?q=...
router.get("/", async (req, res, next) => {
  try {
    const q = String(req.query.q || "").trim();
    const where = q
      ? { OR: [{ docNumber: { contains: q } }, { name: { contains: q } }] }
      : {};
    const items = await prisma.client.findMany({ where, take: 100, orderBy: { name: "asc" } });
    res.json(items);
  } catch (e) {
    next(e);
  }
});

router.get("/:docNumber", async (req, res, next) => {
  try {
    const client = await prisma.client.findUnique({ where: { docNumber: req.params.docNumber } });
    if (!client) return res.status(404).json({ error: "No existe" });
    const vehicles = await prisma.vehicle.findMany({ where: { clientDoc: client.docNumber } });
    res.json({ ...client, vehicles });
  } catch (e) {
    next(e);
  }
});

// Crear o actualizar (upsert por docNumber).
router.post("/", async (req, res, next) => {
  try {
    const b = req.body || {};
    if (!b.docNumber || !b.name) return res.status(400).json({ error: "docNumber y name son obligatorios" });
    const data = {
      docType: b.docType || "CC",
      docNumber: String(b.docNumber).trim(),
      dv: b.dv || null,
      personType: b.personType || "NATURAL",
      name: b.name,
      commercialName: b.commercialName || null,
      email: b.email || null,
      phone: b.phone || null,
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

export default router;
