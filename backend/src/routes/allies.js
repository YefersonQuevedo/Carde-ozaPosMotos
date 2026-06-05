import { Router } from "express";
import { prisma } from "../db.js";

const router = Router();

// GET /api/allies?q=...
router.get("/", async (req, res, next) => {
  try {
    const q = String(req.query.q || "").trim();
    const where = q ? { name: { contains: q } } : {};
    const items = await prisma.ally.findMany({ where, take: 50, orderBy: { name: "asc" } });
    res.json(items);
  } catch (e) {
    next(e);
  }
});

// PUT /api/allies/commission-all -> actualiza la comision de todos los convenios activos.
router.put("/commission-all", async (req, res, next) => {
  try {
    const commission = Math.round(Number(req.body?.commission) || 0);
    if (commission <= 0) return res.status(400).json({ error: "commission debe ser mayor a 0" });
    const updated = await prisma.ally.updateMany({
      where: { active: true, isDirectUser: false },
      data: { commission }
    });
    res.json({ ok: true, commission, count: updated.count });
  } catch (e) {
    next(e);
  }
});

router.post("/", async (req, res, next) => {
  try {
    const b = req.body || {};
    if (!b.name) return res.status(400).json({ error: "name es obligatorio" });
    const data = {
      name: b.name,
      contactPhone: b.contactPhone || null,
      altPhone: b.altPhone || null,
      docType: b.docType || null,
      docNumber: b.docNumber || null,
      paymentMethod: b.paymentMethod || null,
      accountNumber: b.accountNumber || null,
      address: b.address || null,
      company: b.company || null,
      observation: b.observation || null,
      notes: b.notes || null,
      enrolled: !!b.enrolled,
      commission: Number(b.commission) || 40000,
      isDirectUser: !!b.isDirectUser,
      active: b.active !== false
    };
    const ally = await prisma.ally.create({ data });
    res.json(ally);
  } catch (e) {
    next(e);
  }
});

router.put("/:id", async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const b = req.body || {};
    const data = {
      name: b.name,
      contactPhone: b.contactPhone || null,
      altPhone: b.altPhone || null,
      docType: b.docType || null,
      docNumber: b.docNumber || null,
      paymentMethod: b.paymentMethod || null,
      accountNumber: b.accountNumber || null,
      holderDocType: b.holderDocType || null,
      holderDoc: b.holderDoc || null,
      address: b.address || null,
      company: b.company || null,
      observation: b.observation || null,
      notes: b.notes || null,
      enrolled: !!b.enrolled,
      commission: Number(b.commission) || 40000,
      isDirectUser: !!b.isDirectUser,
      active: b.active !== false
    };
    const ally = await prisma.ally.update({ where: { id }, data });
    res.json(ally);
  } catch (e) {
    next(e);
  }
});

router.delete("/:id", async (req, res, next) => {
  try {
    await prisma.ally.delete({ where: { id: Number(req.params.id) } });
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

export default router;
