// Turnos de caja. Las ventas se facturan dentro de un turno ABIERTO (ver sales.js).
// Al cerrar un turno SOLO se hace el ARQUEO de efectivo (esperado vs contado).
// La dispersion del dinero (caja menor + cuenta por pagar Supergiros) ocurre en el
// CIERRE DIARIO (ver closings.js), no aqui.
// Solo puede haber un turno abierto a la vez (cambio de cajera = cerrar y abrir otro).
// `number` es un consecutivo GLOBAL unico (nunca se repite).
import { Router } from "express";
import { prisma } from "../db.js";
import { gatherShift } from "../services/dayAudit.js";
import { toWorkbook, sendXlsx } from "../services/excel.js";

const router = Router();
const iso = () => new Date().toISOString().slice(0, 10);
const toInt = (v) => Math.max(0, Math.round(Number(v) || 0));

// Devuelve el turno abierto (o null). Helper reutilizable por sales.js.
export async function openShift() {
  return prisma.shift.findFirst({ where: { status: "abierto" }, orderBy: { id: "desc" } });
}

// Garantiza que exista un turno abierto: si no hay, abre uno AUTOMATICO (turnos
// invisibles). Asi el usuario factura sin manejar turnos. `number` es consecutivo
// unico por empresa (reintenta ante choques de unique).
export async function ensureOpenShift({ openedBy = null } = {}) {
  const existing = await openShift();
  if (existing) return existing;
  const businessDate = iso();
  for (let attempt = 0; attempt < 6; attempt++) {
    const last = await prisma.shift.findFirst({ orderBy: { number: "desc" } });
    const number = (last?.number || 0) + 1 + attempt;
    try {
      return await prisma.shift.create({
        data: { businessDate, number, status: "abierto", openingCash: 0, openedBy: openedBy || "automático", note: "Turno automático" }
      });
    } catch (e) {
      if (e?.code !== "P2002") throw e; // choque de unique -> reintenta con el siguiente numero
    }
  }
  // Fallback: si no pudo crear, devuelve cualquier abierto que haya aparecido.
  return openShift();
}

// GET /api/shifts/current -> turno abierto actual (con su cierre calculado en vivo).
router.get("/current", async (_req, res, next) => {
  try {
    const shift = await openShift();
    if (!shift) {
      // Sin turno abierto: se manda el ultimo cerrado para sugerir la base inicial
      // (con cuanto cerro la caja) en el aviso de apertura del frontend.
      const lastClosed = await prisma.shift.findFirst({ where: { status: "cerrado" }, orderBy: { id: "desc" } });
      return res.json({ shift: null, lastClosed });
    }
    const { closing } = await gatherShift(shift.id);
    res.json({ shift, closing });
  } catch (e) {
    next(e);
  }
});

// GET /api/shifts?from=&to= -> historial de turnos.
router.get("/", async (req, res, next) => {
  try {
    const where = {};
    if (req.query.from || req.query.to) where.businessDate = { gte: String(req.query.from || "0000"), lte: String(req.query.to || "9999") };
    if (req.query.status) where.status = String(req.query.status);
    const items = await prisma.shift.findMany({ where, orderBy: { id: "desc" }, take: 500 });
    res.json({ items, count: items.length });
  } catch (e) {
    next(e);
  }
});

// POST /api/shifts/open { openingCash, openedBy, note } -> abre un turno.
// Numero de turno = consecutivo GLOBAL unico (max(number)+1), nunca se repite.
// Reintenta si dos aperturas casi simultaneas chocan con el unique de `number`.
router.post("/open", async (req, res, next) => {
  try {
    const already = await openShift();
    if (already) return res.status(409).json({ error: `Ya hay un turno abierto (#${already.number} del ${already.businessDate}). Ciérralo antes de abrir otro.`, shift: already });
    const businessDate = String(req.body?.businessDate || iso());
    const data = {
      businessDate, status: "abierto",
      openingCash: toInt(req.body?.openingCash),
      openedBy: req.body?.openedBy || null,
      note: req.body?.note || null
    };
    let shift = null;
    for (let attempt = 0; attempt < 5 && !shift; attempt++) {
      const last = await prisma.shift.findFirst({ orderBy: { number: "desc" } });
      const number = (last?.number || 0) + 1 + attempt;
      try {
        shift = await prisma.shift.create({ data: { ...data, number } });
      } catch (e) {
        if (e?.code !== "P2002") throw e; // P2002 = choque de unique, reintenta con el siguiente
      }
    }
    if (!shift) return res.status(409).json({ error: "No se pudo asignar número de turno, reintenta" });
    res.status(201).json({ shift });
  } catch (e) {
    next(e);
  }
});

// POST /api/shifts/:id/close { countedCash, closedBy } -> cierra el turno.
// SOLO hace el arqueo (esperado vs contado) y lo marca cerrado. NO dispersa dinero:
// la dispersion (caja menor + por pagar Supergiros) ocurre en el cierre DIARIO.
router.post("/:id/close", async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const shift = await prisma.shift.findUnique({ where: { id } });
    if (!shift) return res.status(404).json({ error: "No existe el turno" });
    if (shift.status !== "abierto") return res.status(400).json({ error: "El turno ya está cerrado" });

    const { closing } = await gatherShift(id);
    const expectedCash = Math.max(0, Math.round(closing.efectivoEntregar || 0));
    const hasCount = req.body?.countedCash != null && req.body.countedCash !== "";
    const countedCash = hasCount ? toInt(req.body.countedCash) : null;
    const cashDiff = countedCash != null ? countedCash - expectedCash : 0;

    const updated = await prisma.$transaction(async (tx) => {
      // Recarga dentro de la transaccion para evitar doble cierre por doble click.
      const fresh = await tx.shift.findUnique({ where: { id } });
      if (!fresh || fresh.status !== "abierto") throw Object.assign(new Error("El turno ya está cerrado"), { status: 400 });
      return tx.shift.update({
        where: { id },
        data: {
          status: "cerrado",
          expectedCash,
          countedCash,
          cashDiff,
          salesTotal: Math.round(closing.salesTotal || 0),
          jasper: Math.round(closing.jasper || 0),
          provision: Math.round(closing.provision || 0),
          closedBy: req.body?.closedBy || null,
          closedAt: new Date()
        }
      });
    });
    res.json({ shift: updated, closing, arqueo: { expectedCash, countedCash, cashDiff } });
  } catch (e) {
    next(e);
  }
});

// GET /api/shifts/export?from=&to= -> historial de turnos en Excel.
router.get("/export", async (req, res, next) => {
  try {
    const where = {};
    if (req.query.from || req.query.to) where.businessDate = { gte: String(req.query.from || "0000"), lte: String(req.query.to || "9999") };
    const items = await prisma.shift.findMany({ where, orderBy: { id: "desc" }, take: 5000 });
    const rows = items.map((s) => ({
      fecha: s.businessDate, turno: s.number, estado: s.status,
      abrio: s.openedBy || "", baseInicial: s.openingCash,
      esperado: s.expectedCash, contado: s.countedCash ?? "", diferencia: s.cashDiff,
      ventas: s.salesTotal, jasper: s.jasper, cierra: s.closedBy || ""
    }));
    const buf = await toWorkbook({
      sheets: [{
        name: "Turnos", title: "Turnos de caja",
        columns: [
          { header: "Fecha", key: "fecha", width: 12 }, { header: "Turno", key: "turno", width: 8, number: true },
          { header: "Estado", key: "estado", width: 10 }, { header: "Abrió", key: "abrio", width: 18 },
          { header: "Base inicial", key: "baseInicial", width: 14, money: true }, { header: "Esperado", key: "esperado", width: 14, money: true },
          { header: "Contado", key: "contado", width: 14, money: true }, { header: "Diferencia", key: "diferencia", width: 14, money: true },
          { header: "Ventas", key: "ventas", width: 14, money: true }, { header: "Jasper", key: "jasper", width: 14, money: true },
          { header: "Cerró", key: "cierra", width: 18 }
        ],
        rows
      }]
    });
    sendXlsx(res, buf, "turnos.xlsx");
  } catch (e) {
    next(e);
  }
});

export default router;
