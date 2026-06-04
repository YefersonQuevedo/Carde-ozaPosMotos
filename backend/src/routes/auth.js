import { Router } from "express";
import bcrypt from "bcryptjs";
import { prisma } from "../db.js";
import { signToken, auth } from "../auth.js";

const router = Router();

// POST /api/auth/login
router.post("/login", async (req, res, next) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) return res.status(400).json({ error: "Usuario y clave obligatorios" });
    const user = await prisma.user.findUnique({ where: { username: String(username).trim() } });
    if (!user || !user.active) return res.status(401).json({ error: "Usuario o clave incorrectos" });
    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) return res.status(401).json({ error: "Usuario o clave incorrectos" });
    const token = signToken(user);
    res.json({ token, user: { id: user.id, username: user.username, name: user.name, role: user.role } });
  } catch (e) {
    next(e);
  }
});

// GET /api/auth/me  -> valida el token y devuelve el usuario actual.
router.get("/me", auth(), (req, res) => res.json({ user: req.user }));

export default router;
