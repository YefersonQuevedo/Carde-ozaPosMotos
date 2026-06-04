import { Router } from "express";
import { prisma } from "../db.js";

const router = Router();

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
