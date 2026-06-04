import { Router } from "express";
import { prisma } from "../db.js";

const router = Router();

const normalizePlate = (v) => String(v || "").trim().toUpperCase().replace(/\s+/g, "");

function rangeFromModel(year) {
  const y = Number(year) || 0;
  if (y >= 2024) return "MOTOCICLETAS 2024-2026";
  if (y >= 2019) return "MOTOCICLETAS 2019-2023";
  if (y >= 2010) return "MOTOCICLETAS 2010-2018";
  return "MOTOCICLETAS 2009-ANTES";
}

// GET /api/vehicles?plate=...  |  ?clientDoc=...
router.get("/", async (req, res, next) => {
  try {
    const { plate, clientDoc } = req.query;
    const where = {};
    if (plate) where.plate = { contains: normalizePlate(plate) };
    if (clientDoc) where.clientDoc = String(clientDoc);
    const items = await prisma.vehicle.findMany({ where, take: 25, orderBy: { plate: "asc" } });
    res.json(items);
  } catch (e) {
    next(e);
  }
});

router.post("/", async (req, res, next) => {
  try {
    const b = req.body || {};
    const plate = normalizePlate(b.plate);
    if (!plate || !b.clientDoc) return res.status(400).json({ error: "plate y clientDoc son obligatorios" });
    const modelYear = Number(b.modelYear) || null;
    const rangeName = b.rangeName || rangeFromModel(modelYear);
    const existing = await prisma.vehicle.findFirst({ where: { plate, clientDoc: String(b.clientDoc) } });
    if (existing) {
      const updated = await prisma.vehicle.update({
        where: { id: existing.id },
        data: { modelYear, rangeName }
      });
      return res.json(updated);
    }
    const vehicle = await prisma.vehicle.create({
      data: { clientDoc: String(b.clientDoc), plate, modelYear, rangeName, status: "ACTIVO" }
    });
    res.json(vehicle);
  } catch (e) {
    next(e);
  }
});

export default router;
