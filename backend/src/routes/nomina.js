// Nomina: registro de empleados + calculo de quincena + pago.
// Pago quincenal (dia 15 y 30/31). Devengado quincena = mitad del salario base +
// mitad de auxilios. Descuentos del empleado = 8% (salud 4% + pension 4%) sobre el
// IBC quincenal (= mitad del salario base; los auxilios NO cotizan). Neto = dev - desc.
// Pagar la quincena genera un GASTO por empleado en su caja (banco/efectivo), asi
// entra en el flujo de caja, el consolidado y la naturaleza "Nomina".
import { Router } from "express";
import { prisma } from "../db.js";
import { auth } from "../auth.js";

const router = Router();
const iso = () => new Date().toISOString().slice(0, 10);
const toInt = (v) => Math.max(0, Math.round(Number(v) || 0));
const HEALTH_PENSION = 0.08; // 4% salud + 4% pension

function quincenaDeEmpleado(e) {
  const baseQ = Math.round((e.salaryBase || 0) / 2);
  const transpQ = Math.round((e.auxTransporte || 0) / 2);
  const alimQ = Math.round((e.auxAlimentacion || 0) / 2);
  const devengado = baseQ + transpQ + alimQ;
  const deduccion = Math.round(baseQ * HEALTH_PENSION); // sobre el IBC (salario), no auxilios
  const neto = devengado - deduccion;
  return { baseQ, transpQ, alimQ, devengado, deduccion, neto };
}

const cajaPorMetodo = (m) => (String(m).toLowerCase() === "efectivo" ? "CAJA_MENOR" : "BANCO");

// GET /api/nomina/employees -> lista (activos primero)
router.get("/employees", async (_req, res, next) => {
  try {
    const items = await prisma.employee.findMany({ orderBy: [{ active: "desc" }, { name: "asc" }] });
    res.json({ items });
  } catch (e) { next(e); }
});

// POST /api/nomina/employees (solo admin)
router.post("/employees", auth(["admin"]), async (req, res, next) => {
  try {
    const b = req.body || {};
    if (!String(b.name || "").trim()) return res.status(400).json({ error: "El nombre es obligatorio" });
    const item = await prisma.employee.create({
      data: {
        name: String(b.name).trim(), docNumber: b.docNumber || null, role: b.role || null,
        salaryBase: toInt(b.salaryBase), auxTransporte: toInt(b.auxTransporte), auxAlimentacion: toInt(b.auxAlimentacion),
        paymentMethod: String(b.paymentMethod).toLowerCase() === "efectivo" ? "efectivo" : "banco",
        active: b.active !== false, startDate: b.startDate || null, note: b.note || null
      }
    });
    res.status(201).json({ item });
  } catch (e) { next(e); }
});

// PUT /api/nomina/employees/:id (solo admin)
router.put("/employees/:id", auth(["admin"]), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const prev = await prisma.employee.findFirst({ where: { id } });
    if (!prev) return res.status(404).json({ error: "Empleado no encontrado" });
    const b = req.body || {};
    const item = await prisma.employee.update({
      where: { id },
      data: {
        name: b.name !== undefined ? String(b.name).trim() || prev.name : prev.name,
        docNumber: b.docNumber !== undefined ? (b.docNumber || null) : prev.docNumber,
        role: b.role !== undefined ? (b.role || null) : prev.role,
        salaryBase: b.salaryBase !== undefined ? toInt(b.salaryBase) : prev.salaryBase,
        auxTransporte: b.auxTransporte !== undefined ? toInt(b.auxTransporte) : prev.auxTransporte,
        auxAlimentacion: b.auxAlimentacion !== undefined ? toInt(b.auxAlimentacion) : prev.auxAlimentacion,
        paymentMethod: b.paymentMethod !== undefined ? (String(b.paymentMethod).toLowerCase() === "efectivo" ? "efectivo" : "banco") : prev.paymentMethod,
        active: b.active !== undefined ? b.active !== false : prev.active,
        startDate: b.startDate !== undefined ? (b.startDate || null) : prev.startDate,
        note: b.note !== undefined ? (b.note || null) : prev.note
      }
    });
    res.json({ item });
  } catch (e) { next(e); }
});

// DELETE /api/nomina/employees/:id (solo admin) -> desactiva (conserva historial)
router.delete("/employees/:id", auth(["admin"]), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const prev = await prisma.employee.findFirst({ where: { id } });
    if (!prev) return res.status(404).json({ error: "Empleado no encontrado" });
    await prisma.employee.update({ where: { id }, data: { active: false } });
    res.json({ ok: true, deactivated: true });
  } catch (e) { next(e); }
});

// GET /api/nomina/quincena -> calculo de la quincena para los empleados activos.
router.get("/quincena", async (_req, res, next) => {
  try {
    const emps = await prisma.employee.findMany({ where: { active: true }, orderBy: { name: "asc" } });
    const rows = emps.map((e) => {
      const q = quincenaDeEmpleado(e);
      return {
        id: e.id, name: e.name, role: e.role || "", paymentMethod: e.paymentMethod,
        salaryBase: e.salaryBase, auxTransporte: e.auxTransporte, auxAlimentacion: e.auxAlimentacion, ...q
      };
    });
    const totals = rows.reduce((t, r) => ({
      devengado: t.devengado + r.devengado, deduccion: t.deduccion + r.deduccion, neto: t.neto + r.neto,
      banco: t.banco + (r.paymentMethod === "banco" ? r.neto : 0), efectivo: t.efectivo + (r.paymentMethod === "efectivo" ? r.neto : 0)
    }), { devengado: 0, deduccion: 0, neto: 0, banco: 0, efectivo: 0 });
    res.json({ rows, totals, count: rows.length });
  } catch (e) { next(e); }
});

// POST /api/nomina/pay { date, period, employeeIds? } (solo admin)
// Registra el pago neto de la quincena como GASTO por empleado en su caja.
router.post("/pay", auth(["admin"]), async (req, res, next) => {
  try {
    const b = req.body || {};
    const date = b.date || iso();
    const period = String(b.period || "").trim() || date;
    const where = { active: true };
    if (Array.isArray(b.employeeIds) && b.employeeIds.length) where.id = { in: b.employeeIds.map(Number) };
    const emps = await prisma.employee.findMany({ where });
    if (!emps.length) return res.status(400).json({ error: "No hay empleados para pagar" });
    const result = await prisma.$transaction(async (tx) => {
      let total = 0; const detalle = [];
      for (const e of emps) {
        const q = quincenaDeEmpleado(e);
        if (q.neto <= 0) continue;
        const boxCode = cajaPorMetodo(e.paymentMethod);
        const concept = `Nomina ${period} · ${e.name}`;
        const exp = await tx.expense.create({ data: { date, concept, category: "NOMINA", amount: q.neto, boxCode, note: `Pago quincena (${e.paymentMethod})` } });
        await tx.cashMovement.create({ data: { boxCode, type: "egreso", amount: q.neto, refType: "nomina", refId: exp.id, date, note: concept } });
        total += q.neto; detalle.push({ employee: e.name, neto: q.neto, boxCode });
      }
      return { total, detalle };
    });
    res.json({ ok: true, period, ...result });
  } catch (e) { next(e); }
});

export default router;
