import { Router } from "express";
import { prisma } from "../db.js";
import { computeClosing } from "../services/closing.js";
import { buildDispersionForSales, money, summarizeDispersion } from "../services/dayAudit.js";
import { sendXlsx, toWorkbook } from "../services/excel.js";

const router = Router();

const iso = (d) => d.toISOString().slice(0, 10);
const monthStart = () => iso(new Date()).slice(0, 8) + "01";
const monthEnd = () => {
  const now = new Date();
  return iso(new Date(now.getFullYear(), now.getMonth() + 1, 0));
};
function shiftYear(date, delta) {
  const d = new Date(`${date}T00:00:00`);
  d.setFullYear(d.getFullYear() + delta);
  return iso(d);
}

function groupSales(sales, keyFn) {
  const map = {};
  for (const sale of sales) {
    const key = keyFn(sale) || "Sin clasificar";
    const row = (map[key] ||= { key, count: 0, total: 0, realized: 0, pending: 0 });
    row.count += 1;
    row.total += money(sale.total);
    if (money(sale.pinAdquirido) > 0) row.realized += 1;
    else row.pending += 1;
  }
  return Object.values(map).sort((a, b) => b.count - a.count);
}

function hourHeatmap(sales = []) {
  const dayNames = ["Domingo", "Lunes", "Martes", "Miercoles", "Jueves", "Viernes", "Sabado"];
  const map = {};
  for (const sale of sales) {
    const hour = Number(String(sale.saleTime || "00:00").slice(0, 2));
    const safeHour = Number.isFinite(hour) && hour >= 0 && hour <= 23 ? hour : 0;
    const dayIndex = new Date(`${sale.saleDate}T12:00:00`).getDay();
    const key = `${dayIndex}-${safeHour}`;
    const row = (map[key] ||= { dayIndex, day: dayNames[dayIndex], hour: safeHour, label: `${String(safeHour).padStart(2, "0")}:00`, count: 0, total: 0 });
    row.count += 1;
    row.total += money(sale.total);
  }
  return Object.values(map).sort((a, b) => b.count - a.count || b.total - a.total);
}

async function rangeReport(from, to) {
  const sales = await prisma.sale.findMany({
    where: { status: "activa", saleDate: { gte: from, lte: to } },
    orderBy: [{ saleDate: "asc" }, { id: "asc" }]
  });
  const ids = sales.map((s) => s.id);
  const [payments, receivables, costs, payablesFijos, employees] = await Promise.all([
    ids.length ? prisma.salePayment.findMany({ where: { saleId: { in: ids } } }) : [],
    ids.length ? prisma.receivable.findMany({ where: { saleId: { in: ids } } }) : [],
    ids.length ? prisma.saleCost.findMany({ where: { saleId: { in: ids } } }) : [],
    prisma.payable.findMany({ where: { frequency: "mensual" } }),
    prisma.employee.findMany({ where: { active: true } })
  ]);

  const closing = computeClosing({ sales, payments, receivables });
  const dispersionRows = await buildDispersionForSales(sales, payments, costs);
  const dispersion = summarizeDispersion(dispersionRows);
  const dispersionTotals = dispersion.reduce((acc, row) => {
    acc.recaudoBruto += money(row.recaudoBruto);
    acc.netoEstimado += money(row.netoEstimado);
    acc.deducciones += money(row.recaudoBruto) - money(row.netoEstimado);
    if (row.grupo === "Efectivo") acc.efectivoNeto += money(row.netoEstimado);
    else if (row.grupo === "Cartera") acc.carteraNeto += money(row.netoEstimado);
    else acc.bancosNeto += money(row.netoEstimado);
    return acc;
  }, { recaudoBruto: 0, netoEstimado: 0, deducciones: 0, efectivoNeto: 0, bancosNeto: 0, carteraNeto: 0 });
  const costsTotal = costs.reduce((s, c) => s + money(c.costosTotal), 0);
  const transactionCosts = costs.reduce((s, c) => s + money(c.costeTransaccion), 0);
  const ivaFacturacion = costs.reduce((s, c) => s + money(c.ivaFact), 0);
  const ivaVentas = sales
    .filter((s) => s.dianStatus === "facturada")
    .reduce((sum, s) => sum + money(s.totalIva), 0);
  const directSales = sales.filter((s) => (s.allyType || "usuario") === "usuario").length;
  const referredSales = sales.length - directSales;
  const ticketPromedio = sales.length ? Math.round(closing.salesTotal / sales.length) : 0;
  const utilidadBruta = closing.salesTotal - costsTotal - closing.deducciones;

  // KPIs gerenciales (referencia MENSUAL, independiente del rango):
  // costos fijos = obligaciones mensuales + nomina mensual (salario + auxilios de activos).
  const nominaMensual = employees.reduce((s, e) => s + money(e.salaryBase) + money(e.auxTransporte) + money(e.auxAlimentacion), 0);
  const obligacionesMensual = payablesFijos.reduce((s, p) => s + money(p.totalAmount), 0);
  const costosFijosMensuales = nominaMensual + obligacionesMensual;
  const margen = closing.salesTotal ? Math.round((utilidadBruta / closing.salesTotal) * 1000) / 10 : 0;
  // Punto de equilibrio: RTMs/mes necesarias para cubrir los costos fijos al ticket promedio.
  const puntoEquilibrio = ticketPromedio ? Math.ceil(costosFijosMensuales / ticketPromedio) : 0;

  const byDay = {};
  for (const s of sales) {
    const row = (byDay[s.saleDate] ||= { date: s.saleDate, count: 0, total: 0, realized: 0, pending: 0 });
    row.count += 1;
    row.total += money(s.total);
    if (money(s.pinAdquirido) > 0) row.realized += 1;
    else row.pending += 1;
  }

  return {
    from,
    to,
    kpis: {
      salesCount: sales.length,
      salesTotal: closing.salesTotal,
      ticketPromedio,
      rtmRealizadas: closing.rtmRealizadas,
      rtmFacturadas: closing.rtmFacturadas,
      rtmPendientes: closing.rtmPendientes,
      directSales,
      referredSales,
      directPct: sales.length ? Math.round((directSales / sales.length) * 100) : 0,
      referredPct: sales.length ? Math.round((referredSales / sales.length) * 100) : 0,
      jasper: closing.jasper,
      provision: closing.provision,
      descuentosUsuarios: closing.fidelizacion,
      comisionesReferidos: closing.referidos,
      deducciones: closing.deducciones,
      receivableOpen: closing.receivableOpen,
      costosOperativos: costsTotal,
      costosTransaccion: transactionCosts,
      ivaFacturacion,
      ivaVentas,
      // IVA facturado = IVA cobrado al cliente en las facturas emitidas (lo que se le debe a
      // la DIAN). NO se suma el IVA de facturacion (ivaFacturacion), que es un costo aparte.
      ivaProvision: ivaVentas,
      nominaMensual,
      obligacionesMensual,
      costosFijosMensuales,
      margen,
      puntoEquilibrio,
      dispersionBruta: dispersionTotals.recaudoBruto,
      dispersionNeta: dispersionTotals.netoEstimado,
      dispersionDeducciones: dispersionTotals.deducciones,
      dispersionEfectivoNeto: dispersionTotals.efectivoNeto,
      dispersionBancosNeto: dispersionTotals.bancosNeto,
      dispersionCarteraNeto: dispersionTotals.carteraNeto,
      utilidadBruta
    },
    byRange: groupSales(sales, (s) => s.rangeName),
    byVehicleType: groupSales(sales, (s) => s.vehicleType),
    byAllyType: groupSales(sales, (s) => s.allyType),
    byDay: Object.values(byDay).sort((a, b) => a.date.localeCompare(b.date)),
    byHourHeatmap: hourHeatmap(sales),
    byMethod: Object.entries(closing.byMethod).map(([method, value]) => ({
      method,
      count: closing.countByMethod?.[method] || 0,
      value
    })),
    byDispersion: dispersion
  };
}

async function dashboardPayload(query = {}) {
  const from = String(query.from || monthStart());
  const to = String(query.to || monthEnd());
  const previousFrom = shiftYear(from, -1);
  const previousTo = shiftYear(to, -1);
  const [current, previous] = await Promise.all([
    rangeReport(from, to),
    rangeReport(previousFrom, previousTo)
  ]);
  return { current, previous };
}

router.get("/", async (req, res, next) => {
  try {
    res.json(await dashboardPayload(req.query));
  } catch (e) {
    next(e);
  }
});

router.get("/export", async (req, res, next) => {
  try {
    const { current, previous } = await dashboardPayload(req.query);
    const k = current.kpis;
    const p = previous.kpis;
    const rows = [
      { metric: "RTM facturadas", actual: k.rtmFacturadas, anterior: p.rtmFacturadas, diff: k.rtmFacturadas - p.rtmFacturadas },
      { metric: "RTM realizadas", actual: k.rtmRealizadas, anterior: p.rtmRealizadas, diff: k.rtmRealizadas - p.rtmRealizadas },
      { metric: "Ventas brutas", actual: k.salesTotal, anterior: p.salesTotal, diff: k.salesTotal - p.salesTotal },
      { metric: "Ticket promedio", actual: k.ticketPromedio, anterior: p.ticketPromedio, diff: k.ticketPromedio - p.ticketPromedio },
      { metric: "Jasper estimado", actual: k.jasper, anterior: p.jasper, diff: k.jasper - p.jasper },
      { metric: "Deducciones", actual: k.deducciones, anterior: p.deducciones, diff: k.deducciones - p.deducciones },
      { metric: "Dispersion neta esperada", actual: k.dispersionNeta, anterior: p.dispersionNeta, diff: k.dispersionNeta - p.dispersionNeta },
      { metric: "Dispersion efectivo", actual: k.dispersionEfectivoNeto, anterior: p.dispersionEfectivoNeto, diff: k.dispersionEfectivoNeto - p.dispersionEfectivoNeto },
      { metric: "Dispersion bancos/QR/tarjeta", actual: k.dispersionBancosNeto, anterior: p.dispersionBancosNeto, diff: k.dispersionBancosNeto - p.dispersionBancosNeto },
      { metric: "IVA provisionado", actual: k.ivaProvision, anterior: p.ivaProvision, diff: k.ivaProvision - p.ivaProvision },
      { metric: "Utilidad bruta aprox.", actual: k.utilidadBruta, anterior: p.utilidadBruta, diff: k.utilidadBruta - p.utilidadBruta }
    ];
    const buffer = await toWorkbook({
      sheets: [
        {
          name: "KPIs",
          title: `Dashboard ${current.from} a ${current.to}`,
          columns: [
            { header: "Metrica", key: "metric", width: 28 },
            { header: "Actual", key: "actual", width: 16, money: true },
            { header: "Año anterior", key: "anterior", width: 16, money: true },
            { header: "Diferencia", key: "diff", width: 16, money: true }
          ],
          rows
        },
        {
          name: "Motos",
          columns: [
            { header: "Rango", key: "key", width: 28 },
            { header: "Cantidad", key: "count", width: 12, number: true },
            { header: "Realizadas", key: "realized", width: 12, number: true },
            { header: "Pendientes", key: "pending", width: 12, number: true },
            { header: "Ventas", key: "total", width: 16, money: true }
          ],
          rows: current.byRange
        },
        {
          name: "Dias",
          columns: [
            { header: "Dia", key: "date", width: 12 },
            { header: "Cantidad", key: "count", width: 12, number: true },
            { header: "Realizadas", key: "realized", width: 12, number: true },
            { header: "Pendientes", key: "pending", width: 12, number: true },
            { header: "Ventas", key: "total", width: 16, money: true }
          ],
          rows: current.byDay
        },
        {
          name: "Horas pico",
          columns: [
            { header: "Dia", key: "day", width: 14 },
            { header: "Hora", key: "label", width: 10 },
            { header: "RTM/Ventas", key: "count", width: 12, number: true },
            { header: "Ventas", key: "total", width: 16, money: true }
          ],
          rows: current.byHourHeatmap,
          totals: {
            count: current.byHourHeatmap.reduce((a, r) => a + money(r.count), 0),
            total: current.byHourHeatmap.reduce((a, r) => a + money(r.total), 0)
          }
        },
        {
          name: "Metodos",
          columns: [
            { header: "Metodo", key: "method", width: 28 },
            { header: "Cantidad", key: "count", width: 12, number: true },
            { header: "Valor", key: "value", width: 16, money: true }
          ],
          rows: current.byMethod
        },
        {
          name: "Dispersion",
          columns: [
            { header: "Grupo", key: "grupo", width: 18 },
            { header: "Cantidad", key: "cantidad", width: 12, number: true },
            { header: "Recaudo bruto", key: "recaudoBruto", width: 16, money: true },
            { header: "Servicio recaudo", key: "servicioRecaudo", width: 18, money: true },
            { header: "IVA servicio", key: "ivaServicio", width: 16, money: true },
            { header: "Servicio homologado", key: "servicioHomologado", width: 20, money: true },
            { header: "IVA homologado", key: "ivaHomologado", width: 18, money: true },
            { header: "ANSV/FNSV", key: "ansv", width: 14, money: true },
            { header: "ADQ/transaccion", key: "adqTransaccion", width: 18, money: true },
            { header: "Neto estimado", key: "netoEstimado", width: 16, money: true }
          ],
          rows: current.byDispersion,
          totals: {
            cantidad: current.byDispersion.reduce((a, r) => a + money(r.cantidad), 0),
            recaudoBruto: current.byDispersion.reduce((a, r) => a + money(r.recaudoBruto), 0),
            servicioRecaudo: current.byDispersion.reduce((a, r) => a + money(r.servicioRecaudo), 0),
            ivaServicio: current.byDispersion.reduce((a, r) => a + money(r.ivaServicio), 0),
            servicioHomologado: current.byDispersion.reduce((a, r) => a + money(r.servicioHomologado), 0),
            ivaHomologado: current.byDispersion.reduce((a, r) => a + money(r.ivaHomologado), 0),
            ansv: current.byDispersion.reduce((a, r) => a + money(r.ansv), 0),
            adqTransaccion: current.byDispersion.reduce((a, r) => a + money(r.adqTransaccion), 0),
            netoEstimado: current.byDispersion.reduce((a, r) => a + money(r.netoEstimado), 0)
          }
        }
      ]
    });
    sendXlsx(res, buffer, `dashboard-${current.from}_${current.to}.xlsx`);
  } catch (e) {
    next(e);
  }
});

export default router;
