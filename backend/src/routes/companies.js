// Gestion de empresas (multi-tenant). Solo el ADMIN de la empresa PRINCIPAL (id=1)
// puede crear/editar empresas: actua como "superadmin" del sistema.
// Al crear una empresa se le clona el catalogo base de la principal (productos,
// paquetes, metodos de pago, tarifas, cajas y naturalezas) y se crea su usuario admin.
import { Router } from "express";
import bcrypt from "bcryptjs";
import { prisma } from "../db.js";
import { auth } from "../auth.js";

const router = Router();

router.use(auth(["admin"]), (req, res, next) => {
  if (Number(req.companyId) !== 1) {
    return res.status(403).json({ error: "Solo el administrador de la empresa principal gestiona empresas" });
  }
  next();
});

// GET /api/companies -> lista de empresas (con # de usuarios).
router.get("/", async (_req, res, next) => {
  try {
    const [items, users] = await Promise.all([
      prisma.company.findMany({ orderBy: { id: "asc" } }),
      prisma.user.findMany({ select: { companyId: true } })
    ]);
    const count = {};
    for (const u of users) count[u.companyId] = (count[u.companyId] || 0) + 1;
    res.json({ items: items.map((c) => ({ ...c, users: count[c.id] || 0 })) });
  } catch (e) {
    next(e);
  }
});

// POST /api/companies { name, nit, dv, commercialName, address, city, phone,
//                       adminUsername, adminName, adminPassword }
// Crea la empresa + clona el catalogo de la principal + crea su usuario admin.
router.post("/", async (req, res, next) => {
  try {
    const b = req.body || {};
    if (!String(b.name || "").trim()) return res.status(400).json({ error: "El nombre de la empresa es obligatorio" });
    if (!b.adminUsername || !b.adminName || !b.adminPassword) {
      return res.status(400).json({ error: "El usuario administrador de la empresa es obligatorio (usuario, nombre y clave)" });
    }
    const usernameTaken = await prisma.user.findUnique({ where: { username: String(b.adminUsername).trim() } });
    if (usernameTaken) return res.status(400).json({ error: "Ese nombre de usuario ya existe" });

    // Catalogo base de la empresa del request (la principal): el contexto tenant
    // ya filtra estos findMany por companyId=1.
    const [products, packages, components, methods, tariffs, boxes, natures] = await Promise.all([
      prisma.product.findMany(),
      prisma.package.findMany(),
      prisma.packageComponent.findMany(),
      prisma.paymentMethod.findMany(),
      prisma.tariff.findMany(),
      prisma.cashBox.findMany(),
      prisma.expenseNature.findMany()
    ]);

    const company = await prisma.company.create({
      data: {
        name: String(b.name).trim(),
        nit: b.nit || null,
        dv: b.dv || null,
        commercialName: b.commercialName || null,
        address: b.address || null,
        city: b.city || null,
        phone: b.phone || null
      }
    });

    // El companyId explicito gana sobre el del contexto (asi el catalogo queda en la nueva).
    const strip = (rows) => rows.map(({ id, companyId, createdAt, ...rest }) => ({ ...rest, companyId: company.id }));
    if (products.length) await prisma.product.createMany({ data: strip(products) });
    if (packages.length) await prisma.package.createMany({ data: strip(packages) });
    if (components.length) await prisma.packageComponent.createMany({ data: strip(components) });
    if (methods.length) await prisma.paymentMethod.createMany({ data: strip(methods) });
    if (tariffs.length) await prisma.tariff.createMany({ data: strip(tariffs) });
    if (boxes.length) await prisma.cashBox.createMany({ data: strip(boxes) });
    if (natures.length) await prisma.expenseNature.createMany({ data: strip(natures) });

    const admin = await prisma.user.create({
      data: {
        companyId: company.id,
        username: String(b.adminUsername).trim(),
        name: String(b.adminName).trim(),
        passwordHash: await bcrypt.hash(String(b.adminPassword), 10),
        role: "admin",
        active: true
      }
    });

    res.status(201).json({
      company,
      admin: { id: admin.id, username: admin.username, name: admin.name },
      cloned: {
        products: products.length, packages: packages.length, paymentMethods: methods.length,
        tariffs: tariffs.length, cashBoxes: boxes.length, expenseNatures: natures.length
      }
    });
  } catch (e) {
    next(e);
  }
});

// PUT /api/companies/:id -> editar datos / activar / desactivar.
router.put("/:id", async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const prev = await prisma.company.findUnique({ where: { id } });
    if (!prev) return res.status(404).json({ error: "No existe la empresa" });
    const b = req.body || {};
    if (id === 1 && b.active === false) return res.status(400).json({ error: "La empresa principal no se puede desactivar" });
    const company = await prisma.company.update({
      where: { id },
      data: {
        name: b.name !== undefined ? String(b.name).trim() || prev.name : prev.name,
        nit: b.nit !== undefined ? (b.nit || null) : prev.nit,
        dv: b.dv !== undefined ? (b.dv || null) : prev.dv,
        commercialName: b.commercialName !== undefined ? (b.commercialName || null) : prev.commercialName,
        address: b.address !== undefined ? (b.address || null) : prev.address,
        city: b.city !== undefined ? (b.city || null) : prev.city,
        phone: b.phone !== undefined ? (b.phone || null) : prev.phone,
        active: b.active !== undefined ? b.active !== false : prev.active
      }
    });
    res.json({ company });
  } catch (e) {
    next(e);
  }
});

export default router;
