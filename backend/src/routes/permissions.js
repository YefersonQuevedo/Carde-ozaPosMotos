// Configuracion de permisos por ROL (paneles + exports). Solo el admin configura;
// cualquier usuario puede consultar los suyos (/mine) para que el front arme su menu.
import { Router } from "express";
import { prisma } from "../db.js";
import { auth } from "../auth.js";
import { currentCompanyId } from "../tenant.js";
import { PANELS, EXPORTS, permsForRole, CONFIGURABLE_ROLES } from "../permissions.js";

const router = Router();

// GET /api/permissions -> catalogo + permisos actuales por rol (panel de config, admin).
router.get("/", auth(["admin"]), async (_req, res, next) => {
  try {
    const roles = {};
    for (const r of CONFIGURABLE_ROLES) roles[r] = await permsForRole(r);
    res.json({ panels: PANELS, exports: EXPORTS.map(({ id, label }) => ({ id, label })), roles });
  } catch (e) { next(e); }
});

// GET /api/permissions/mine -> permisos del usuario que pide (segun su rol).
router.get("/mine", async (req, res, next) => {
  try {
    const role = req.user?.role || "vendedor";
    res.json({ role, ...(await permsForRole(role)) });
  } catch (e) { next(e); }
});

// PUT /api/permissions/:role { views, exports } -> guarda los permisos de un rol (admin).
router.put("/:role", auth(["admin"]), async (req, res, next) => {
  try {
    const role = String(req.params.role);
    if (!CONFIGURABLE_ROLES.includes(role)) return res.status(400).json({ error: "Rol no configurable" });
    const views = Array.isArray(req.body?.views) ? req.body.views.map(String) : [];
    const exports = Array.isArray(req.body?.exports) ? req.body.exports.map(String) : [];
    const companyId = currentCompanyId();
    const item = await prisma.rolePermission.upsert({
      where: { companyId_role: { companyId, role } },
      update: { views, exports },
      create: { role, views, exports }
    });
    res.json({ item: { role: item.role, views: item.views, exports: item.exports } });
  } catch (e) { next(e); }
});

export default router;
