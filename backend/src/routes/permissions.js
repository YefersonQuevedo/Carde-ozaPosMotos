// Configuracion de permisos por ROL (paneles + exports) y gestion de roles
// personalizados. Solo el admin configura; cualquier usuario consulta los suyos (/mine).
import { Router } from "express";
import { prisma } from "../db.js";
import { auth } from "../auth.js";
import { currentCompanyId } from "../tenant.js";
import { PANELS, EXPORTS, permsForRole, allRoles, roleExists, isBuiltinRole } from "../permissions.js";

const router = Router();

const slug = (s) => String(s || "").trim().toLowerCase().normalize("NFD")
  .replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 30);

// GET /api/permissions -> catalogo + roles (built-in + personalizados) para el panel (admin).
router.get("/", auth(["admin"]), async (_req, res, next) => {
  try {
    res.json({ panels: PANELS, exports: EXPORTS.map(({ id, label }) => ({ id, label })), roles: await allRoles() });
  } catch (e) { next(e); }
});

// GET /api/permissions/mine -> permisos del usuario que pide (segun su rol).
router.get("/mine", async (req, res, next) => {
  try {
    const role = req.user?.role || "vendedor";
    res.json({ role, ...(await permsForRole(role)) });
  } catch (e) { next(e); }
});

// POST /api/permissions/roles { name, readonly } -> crea un rol personalizado (admin).
router.post("/roles", auth(["admin"]), async (req, res, next) => {
  try {
    const label = String(req.body?.name || "").trim();
    const role = slug(label);
    if (!role) return res.status(400).json({ error: "Nombre de rol obligatorio" });
    if (role === "admin" || isBuiltinRole(role)) return res.status(400).json({ error: "Ese rol ya existe (de fábrica)" });
    if (await roleExists(role)) return res.status(400).json({ error: "Ya existe un rol con ese nombre" });
    const item = await prisma.rolePermission.create({ data: { role, label, readonly: !!req.body?.readonly, views: [], exports: [] } });
    res.status(201).json({ role: item.role, label: item.label, readonly: item.readonly });
  } catch (e) { next(e); }
});

// PUT /api/permissions/:role { views, exports, readonly?, label? } -> guarda permisos (admin).
router.put("/:role", auth(["admin"]), async (req, res, next) => {
  try {
    const role = String(req.params.role);
    if (role === "admin") return res.status(400).json({ error: "El admin tiene todo y no se configura" });
    if (!(await roleExists(role))) return res.status(404).json({ error: "Rol no existe" });
    const views = Array.isArray(req.body?.views) ? req.body.views.map(String) : [];
    const exports = Array.isArray(req.body?.exports) ? req.body.exports.map(String) : [];
    const data = { views, exports };
    // readonly/label solo cambian en roles personalizados (los de fábrica son fijos).
    if (!isBuiltinRole(role)) {
      if (req.body?.readonly !== undefined) data.readonly = !!req.body.readonly;
      if (req.body?.label !== undefined) data.label = String(req.body.label).trim() || role;
    }
    const companyId = currentCompanyId();
    const item = await prisma.rolePermission.upsert({
      where: { companyId_role: { companyId, role } },
      update: data,
      create: { role, views, exports, readonly: data.readonly || false, label: data.label || null }
    });
    res.json({ item: { role: item.role, label: item.label, readonly: item.readonly, views: item.views, exports: item.exports } });
  } catch (e) { next(e); }
});

// DELETE /api/permissions/:role -> borra un rol personalizado (admin). Built-in no se borra.
router.delete("/:role", auth(["admin"]), async (req, res, next) => {
  try {
    const role = String(req.params.role);
    if (isBuiltinRole(role)) return res.status(400).json({ error: "Los roles de fábrica no se pueden borrar" });
    const inUse = await prisma.user.count({ where: { role, companyId: currentCompanyId() } });
    if (inUse > 0) return res.status(400).json({ error: `Hay ${inUse} usuario(s) con ese rol. Cámbiales el rol antes de borrarlo.` });
    await prisma.rolePermission.deleteMany({ where: { role } });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

export default router;
