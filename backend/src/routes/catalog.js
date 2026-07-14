import { Router } from "express";
import { prisma } from "../db.js";
import { auth } from "../auth.js";

const router = Router();
const toInt = (v) => Math.round(Number(v) || 0);

// ---------- Tarifas (SICOV, RECAUDO, ANSV, FUPA, SUSTRATOS, IVA_FACT, IVA_RATE...) ----------
// Editables solo por admin. value en COP (para IVA_RATE = porcentaje, ej. 19).
// GET /api/catalog/tariffs?vehicleType=MOTO
router.get("/tariffs", auth(["admin"]), async (req, res, next) => {
  try {
    const where = {};
    if (req.query.vehicleType) where.vehicleType = String(req.query.vehicleType);
    const items = await prisma.tariff.findMany({ where, orderBy: [{ vehicleType: "asc" }, { concept: "asc" }, { yearFrom: "asc" }] });
    res.json({ items });
  } catch (e) { next(e); }
});

// POST /api/catalog/tariffs -> crea una tarifa.
router.post("/tariffs", auth(["admin"]), async (req, res, next) => {
  try {
    const b = req.body || {};
    const concept = String(b.concept || "").trim().toUpperCase();
    if (!concept) return res.status(400).json({ error: "El concepto es obligatorio (ej: SICOV, RECAUDO, ANSV, FUPA, SUSTRATOS, IVA_FACT, IVA_RATE)" });
    const item = await prisma.tariff.create({
      data: {
        vehicleType: String(b.vehicleType || "MOTO").trim().toUpperCase(),
        concept, value: toInt(b.value),
        yearFrom: toInt(b.yearFrom) || 0, yearTo: toInt(b.yearTo) || 9999,
        validFrom: String(b.validFrom || new Date().toISOString().slice(0, 10)),
        active: b.active !== false
      }
    });
    res.status(201).json({ item });
  } catch (e) { next(e); }
});

// PUT /api/catalog/tariffs/:id -> edita una tarifa.
router.put("/tariffs/:id", auth(["admin"]), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const prev = await prisma.tariff.findFirst({ where: { id } });
    if (!prev) return res.status(404).json({ error: "No existe la tarifa" });
    const b = req.body || {};
    const item = await prisma.tariff.update({
      where: { id },
      data: {
        vehicleType: b.vehicleType !== undefined ? String(b.vehicleType).trim().toUpperCase() : prev.vehicleType,
        concept: b.concept !== undefined ? String(b.concept).trim().toUpperCase() : prev.concept,
        value: b.value !== undefined ? toInt(b.value) : prev.value,
        yearFrom: b.yearFrom !== undefined ? toInt(b.yearFrom) : prev.yearFrom,
        yearTo: b.yearTo !== undefined ? toInt(b.yearTo) : prev.yearTo,
        validFrom: b.validFrom !== undefined ? String(b.validFrom) : prev.validFrom,
        active: b.active !== undefined ? b.active !== false : prev.active
      }
    });
    res.json({ item });
  } catch (e) { next(e); }
});

// DELETE /api/catalog/tariffs/:id
router.delete("/tariffs/:id", auth(["admin"]), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const prev = await prisma.tariff.findFirst({ where: { id } });
    if (!prev) return res.status(404).json({ error: "No existe la tarifa" });
    await prisma.tariff.delete({ where: { id } });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// Catalogos para el frontend: productos, paquetes (con componentes) y metodos de pago.
router.get("/", async (_req, res, next) => {
  try {
    const [products, packages, components, paymentMethods] = await Promise.all([
      prisma.product.findMany({ where: { active: true }, orderBy: { code: "asc" } }),
      prisma.package.findMany({ where: { active: true }, orderBy: { code: "asc" } }),
      prisma.packageComponent.findMany(),
      prisma.paymentMethod.findMany({ where: { active: true } })
    ]);
    const componentsByPackage = {};
    for (const c of components) {
      (componentsByPackage[c.packageCode] ||= []).push(c.productCode);
    }
    res.json({ products, packages, componentsByPackage, paymentMethods });
  } catch (e) {
    next(e);
  }
});

export default router;
