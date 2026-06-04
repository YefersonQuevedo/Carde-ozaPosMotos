import { Router } from "express";
import { prisma } from "../db.js";

const router = Router();

// GET /api/receivables?status=abierta&provider=GORA
router.get("/", async (req, res, next) => {
  try {
    const { status, provider } = req.query;
    const where = {};
    if (status) where.status = String(status);
    if (provider) where.provider = String(provider);
    const items = await prisma.receivable.findMany({ where, orderBy: { id: "desc" }, take: 500 });
    const open = items.filter((r) => r.status !== "pagada").reduce((s, r) => s + r.pending, 0);
    res.json({ items, open });
  } catch (e) {
    next(e);
  }
});

// POST /api/receivables/:id/pay  -> marca como pagada (verificacion manual).
router.post("/:id/pay", async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const updated = await prisma.receivable.update({
      where: { id },
      data: { status: "pagada", pending: 0, paidAt: new Date() }
    });
    res.json(updated);
  } catch (e) {
    next(e);
  }
});

export default router;
