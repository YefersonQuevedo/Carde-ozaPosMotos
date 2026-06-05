// Control de FUPA/PIN (inventario de pines prepagados de Supergiros).
//
// El cliente compra pines en lote y le preocupa que Supergiros "queme" pines sin
// que el se de cuenta. Por eso:
//   - Las COMPRAS y los AJUSTES (conteo fisico) se guardan en fupa_movements.
//   - El CONSUMO se deriva de las RTM realizadas (sale.pinAdquirido > 0).
//   - stock teorico = compras + ajustes - RTM realizadas.
// Si al hacer conteo fisico el numero real difiere del teorico, el ajuste revela
// la diferencia (pines quemados sin registro).
import { Router } from "express";
import { prisma } from "../db.js";
import { toWorkbook, sendXlsx } from "../services/excel.js";

const router = Router();
const iso = () => new Date().toISOString().slice(0, 10);

// Reune compras/ajustes (movimientos) y consumo (RTM realizadas) por fecha.
async function gatherFupa() {
  const [movements, rtmSales] = await Promise.all([
    prisma.fupaMovement.findMany({ orderBy: [{ date: "asc" }, { id: "asc" }] }),
    prisma.sale.findMany({ where: { status: "activa", pinAdquirido: { gt: 0 } }, select: { saleDate: true } })
  ]);
  const compras = {}, ajustes = {}, consumo = {};
  for (const m of movements) {
    if (m.type === "compra") compras[m.date] = (compras[m.date] || 0) + m.quantity;
    else ajustes[m.date] = (ajustes[m.date] || 0) + m.quantity;
  }
  for (const s of rtmSales) consumo[s.saleDate] = (consumo[s.saleDate] || 0) + 1;
  return { movements, compras, ajustes, consumo };
}

function totals({ compras, ajustes, consumo }) {
  const sum = (o) => Object.values(o).reduce((a, b) => a + b, 0);
  const totalComprado = sum(compras), totalAjustes = sum(ajustes), totalRtm = sum(consumo);
  return { totalComprado, totalAjustes, totalRtm, stock: totalComprado + totalAjustes - totalRtm };
}

// Filas por dia entre from..to (inicio / compras / ajustes / consumo / fin).
function dailyRows({ compras, ajustes, consumo }, from, to) {
  const allDates = new Set([...Object.keys(compras), ...Object.keys(ajustes), ...Object.keys(consumo)]);
  let stockBefore = 0;
  for (const d of allDates) if (d < from) stockBefore += (compras[d] || 0) + (ajustes[d] || 0) - (consumo[d] || 0);
  const inRange = [...allDates].filter((d) => d >= from && d <= to).sort();
  let running = stockBefore;
  return inRange.map((d) => {
    const inicio = running;
    const c = compras[d] || 0, a = ajustes[d] || 0, k = consumo[d] || 0;
    const fin = inicio + c + a - k;
    running = fin;
    return { date: d, inicio, compras: c, ajustes: a, consumo: k, fin };
  });
}

// GET /api/fupa/summary -> stock teorico actual + totales
router.get("/summary", async (_req, res, next) => {
  try {
    const data = await gatherFupa();
    res.json(totals(data));
  } catch (e) {
    next(e);
  }
});

// GET /api/fupa?from=&to= -> desglose diario + movimientos + totales
router.get("/", async (req, res, next) => {
  try {
    const month = iso().slice(0, 7);
    const from = String(req.query.from || `${month}-01`);
    const to = String(req.query.to || iso());
    const data = await gatherFupa();
    const rows = dailyRows(data, from, to);
    const movements = data.movements.filter((m) => m.date >= from && m.date <= to).reverse();
    res.json({ from, to, rows, movements, ...totals(data) });
  } catch (e) {
    next(e);
  }
});

// POST /api/fupa/purchase { date, quantity, unitCost, note } -> registra compra de pines
router.post("/purchase", async (req, res, next) => {
  try {
    const b = req.body || {};
    const quantity = Math.round(Number(b.quantity) || 0);
    if (quantity <= 0) return res.status(400).json({ error: "cantidad > 0 obligatoria" });
    const mv = await prisma.fupaMovement.create({
      data: { date: b.date || iso(), type: "compra", quantity, unitCost: Math.round(Number(b.unitCost) || 0), note: b.note || null }
    });
    res.status(201).json(mv);
  } catch (e) {
    next(e);
  }
});

// POST /api/fupa/count { physicalCount, date, note } -> conteo fisico: crea ajuste = real - teorico
router.post("/count", async (req, res, next) => {
  try {
    const b = req.body || {};
    const physical = Math.round(Number(b.physicalCount));
    if (!Number.isFinite(physical)) return res.status(400).json({ error: "physicalCount obligatorio" });
    const data = await gatherFupa();
    const { stock } = totals(data);
    const delta = physical - stock;
    const mv = await prisma.fupaMovement.create({
      data: { date: b.date || iso(), type: "ajuste", quantity: delta, note: b.note || `Conteo fisico: ${physical} (teorico ${stock}, dif ${delta})` }
    });
    res.json({ movement: mv, teorico: stock, fisico: physical, diferencia: delta });
  } catch (e) {
    next(e);
  }
});

// GET /api/fupa/export?from=&to= -> Excel del desglose diario
router.get("/export", async (req, res, next) => {
  try {
    const month = iso().slice(0, 7);
    const from = String(req.query.from || `${month}-01`);
    const to = String(req.query.to || iso());
    const data = await gatherFupa();
    const rows = dailyRows(data, from, to);
    const buf = await toWorkbook({
      sheets: [{
        name: "FUPA-Pines", title: `Control de pines ${from} a ${to}`,
        columns: [
          { header: "Dia", key: "date", width: 12 },
          { header: "Inicio", key: "inicio", width: 10, number: true },
          { header: "Compras", key: "compras", width: 10, number: true },
          { header: "Ajustes", key: "ajustes", width: 10, number: true },
          { header: "Consumo (RTM)", key: "consumo", width: 14, number: true },
          { header: "Fin", key: "fin", width: 10, number: true }
        ],
        rows
      }]
    });
    sendXlsx(res, buf, `pines-${from}_${to}.xlsx`);
  } catch (e) {
    next(e);
  }
});

export default router;
