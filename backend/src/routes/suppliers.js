import { Router } from "express";
import { prisma } from "../db.js";

const router = Router();

function supplierData(body = {}) {
  return {
    docType: body.docType || "NIT",
    docNumber: String(body.docNumber || "").trim(),
    name: String(body.name || "").trim(),
    email: body.email || null,
    phone: body.phone || null,
    address: body.address || null,
    paymentMethod: body.paymentMethod || null,
    active: body.active !== false
  };
}

router.get("/", async (req, res, next) => {
  try {
    const q = String(req.query.q || "").trim();
    const where = q
      ? { OR: [{ name: { contains: q } }, { docNumber: { contains: q } }] }
      : {};
    const items = await prisma.supplier.findMany({ where, orderBy: { name: "asc" }, take: 200 });
    res.json({ items });
  } catch (e) {
    next(e);
  }
});

router.post("/", async (req, res, next) => {
  try {
    const data = supplierData(req.body);
    if (!data.docNumber || !data.name) return res.status(400).json({ error: "docNumber y name son obligatorios" });
    const supplier = await prisma.supplier.upsert({
      where: { docNumber: data.docNumber },
      update: data,
      create: data
    });
    res.status(201).json(supplier);
  } catch (e) {
    next(e);
  }
});

router.put("/:id", async (req, res, next) => {
  try {
    const data = supplierData(req.body);
    if (!data.docNumber || !data.name) return res.status(400).json({ error: "docNumber y name son obligatorios" });
    const supplier = await prisma.supplier.update({ where: { id: Number(req.params.id) }, data });
    res.json(supplier);
  } catch (e) {
    next(e);
  }
});

router.delete("/:id", async (req, res, next) => {
  try {
    const supplier = await prisma.supplier.update({ where: { id: Number(req.params.id) }, data: { active: false } });
    res.json({ supplier });
  } catch (e) {
    next(e);
  }
});

export default router;
