// Reportes gerenciales: mapa de calor de horas/dias pico (de las ventas/RTM).
import { Router } from "express";
import { prisma } from "../db.js";

const router = Router();
const DAYS = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];

// GET /api/reports/heatmap?from=&to=  -> intensidad de ventas por dia de semana y hora.
router.get("/heatmap", async (req, res, next) => {
  try {
    const month = new Date().toISOString().slice(0, 7);
    const from = String(req.query.from || `${month}-01`);
    const to = String(req.query.to || `${month}-31`);
    const sales = await prisma.sale.findMany({
      where: { saleDate: { gte: from, lte: to }, status: "activa" },
      select: { saleDate: true, saleTime: true }
    });

    // grid[dowIndex(0=Lun..6=Dom)][hour] = conteo
    const grid = Array.from({ length: 7 }, () => ({}));
    const byDay = Array(7).fill(0);
    const byHour = {};
    let hourMin = 23, hourMax = 0, max = 0;

    for (const s of sales) {
      const d = new Date(s.saleDate + "T00:00:00");
      const dow = (d.getDay() + 6) % 7; // JS: 0=Dom -> queremos 0=Lun
      const hour = Number(String(s.saleTime || "12:00:00").slice(0, 2)) || 12;
      grid[dow][hour] = (grid[dow][hour] || 0) + 1;
      byDay[dow] += 1;
      byHour[hour] = (byHour[hour] || 0) + 1;
      if (hour < hourMin) hourMin = hour;
      if (hour > hourMax) hourMax = hour;
      if (grid[dow][hour] > max) max = grid[dow][hour];
    }
    if (hourMin > hourMax) { hourMin = 7; hourMax = 19; } // sin datos: rango por defecto

    const rows = DAYS.map((day, i) => ({ day, total: byDay[i], hours: grid[i] }));
    const peakDayIdx = byDay.indexOf(Math.max(...byDay));
    const hourEntries = Object.entries(byHour).map(([h, c]) => [Number(h), c]);
    const peakHour = hourEntries.length ? hourEntries.sort((a, b) => b[1] - a[1])[0][0] : null;

    res.json({
      from, to, hourMin, hourMax, max,
      rows, byHour,
      peakDay: byDay[peakDayIdx] ? DAYS[peakDayIdx] : null,
      peakHour: peakHour != null ? `${String(peakHour).padStart(2, "0")}:00` : null,
      total: sales.length
    });
  } catch (e) {
    next(e);
  }
});

export default router;
