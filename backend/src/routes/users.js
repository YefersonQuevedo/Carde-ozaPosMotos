import { Router } from "express";
import bcrypt from "bcryptjs";
import { prisma } from "../db.js";
import { auth } from "../auth.js";

const router = Router();

// Todo este modulo es solo para administradores.
router.use(auth(["admin"]));

const safe = (u) => ({ id: u.id, username: u.username, name: u.name, role: u.role, active: u.active, createdAt: u.createdAt });

// Cada admin solo ve y gestiona los usuarios de SU empresa (multi-tenant).
router.get("/", async (req, res, next) => {
  try {
    const users = await prisma.user.findMany({ where: { companyId: req.companyId }, orderBy: { username: "asc" } });
    res.json(users.map(safe));
  } catch (e) {
    next(e);
  }
});

router.post("/", async (req, res, next) => {
  try {
    const b = req.body || {};
    if (!b.username || !b.name || !b.password) return res.status(400).json({ error: "username, name y password obligatorios" });
    const user = await prisma.user.create({
      data: {
        companyId: req.companyId,
        username: String(b.username).trim(),
        name: b.name,
        role: b.role === "admin" ? "admin" : "vendedor",
        passwordHash: await bcrypt.hash(b.password, 10),
        active: b.active !== false
      }
    });
    res.status(201).json(safe(user));
  } catch (e) {
    if (e.code === "P2002") return res.status(400).json({ error: "Ese usuario ya existe" });
    next(e);
  }
});

router.put("/:id", async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const target = await prisma.user.findFirst({ where: { id, companyId: req.companyId } });
    if (!target) return res.status(404).json({ error: "Usuario no encontrado" });
    const b = req.body || {};
    const data = { name: b.name, role: b.role === "admin" ? "admin" : "vendedor", active: b.active !== false };
    if (b.password) data.passwordHash = await bcrypt.hash(b.password, 10);
    const user = await prisma.user.update({ where: { id }, data });
    res.json(safe(user));
  } catch (e) {
    next(e);
  }
});

router.delete("/:id", async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const target = await prisma.user.findFirst({ where: { id, companyId: req.companyId } });
    if (!target) return res.status(404).json({ error: "Usuario no encontrado" });
    await prisma.user.delete({ where: { id } });
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

export default router;
