import { Router } from "express";
import { prisma } from "../db.js";
import { computeClosing } from "../services/closing.js";
import { toWorkbook, sendXlsx } from "../services/excel.js";

const router = Router();

async function gatherDay(date, gastos = 0) {
  const sales = await prisma.sale.findMany({ where: { saleDate: date, status: "activa" } });
  const ids = sales.map((s) => s.id);
  const payments = ids.length ? await prisma.salePayment.findMany({ where: { saleId: { in: ids } } }) : [];
  const receivables = ids.length ? await prisma.receivable.findMany({ where: { saleId: { in: ids } } }) : [];
  const closing = computeClosing({ sales, payments, receivables, gastos });
  return { sales, payments, receivables, closing };
}

// GET /api/closings?date=YYYY-MM-DD  -> calcula el cierre al vuelo.
router.get("/", async (req, res, next) => {
  try {
    const date = String(req.query.date || new Date().toISOString().slice(0, 10));
    const gastos = Number(req.query.gastos) || 0;
    const { sales, closing } = await gatherDay(date, gastos);
    res.json({ date, closing, detail: sales });
  } catch (e) {
    next(e);
  }
});

// GET /api/closings/export?date=&gastos=  -> descarga el cierre del dia en Excel (formato del cliente).
router.get("/export", async (req, res, next) => {
  try {
    const date = String(req.query.date || new Date().toISOString().slice(0, 10));
    const gastos = Number(req.query.gastos) || 0;
    const { sales, closing: c } = await gatherDay(date, gastos);

    const resumen = [
      { concepto: "Ventas del dia", valor: c.salesTotal },
      { concepto: "Ingresos totales", valor: c.ingresosTotal },
      { concepto: "Subtotal Supergiros (SG)", valor: c.subtotalSG },
      { concepto: "Subtotal Certimotos (CM)", valor: c.subtotalCM },
      { concepto: "Provision (RTM pendientes)", valor: c.provision },
      { concepto: "JASPER (gira Supergiros)", valor: c.jasper },
      { concepto: "Fidelizacion (descuentos usuarios)", valor: c.fidelizacion },
      { concepto: "Referidos", valor: c.referidos },
      { concepto: "Gastos", valor: c.gastos },
      { concepto: "Efectivo recibido", valor: c.efectivo },
      { concepto: "Efectivo a entregar", valor: c.efectivoEntregar },
      { concepto: "DIFERENCIA JASPER (= comisiones)", valor: c.diferenciaJasper },
      { concepto: "Cartera abierta", valor: c.receivableOpen },
      { concepto: "RTM realizadas", valor: c.rtmRealizadas },
      { concepto: "RTM facturadas", valor: c.rtmFacturadas }
    ];
    const ingresos = Object.entries(c.byMethod).map(([metodo, valor]) => ({ metodo, valor }));
    const detalle = sales.map((s) => ({
      venta: s.saleNumber, cliente: s.clientName, placa: s.plate || "", tipo: s.allyType,
      rtm: s.rtmStatus, factura: s.invoiceNumber || "", total: s.total
    }));

    const buf = await toWorkbook({
      sheets: [
        { name: "Resumen", title: `Cierre del dia ${date}`,
          columns: [{ header: "Concepto", key: "concepto", width: 38 }, { header: "Valor", key: "valor", width: 16, money: true }],
          rows: resumen },
        { name: "Ingresos por metodo",
          columns: [{ header: "Metodo", key: "metodo", width: 28 }, { header: "Valor", key: "valor", width: 16, money: true }],
          rows: ingresos, totals: { valor: c.ingresosTotal } },
        { name: "Detalle",
          columns: [
            { header: "Venta", key: "venta", width: 14 }, { header: "Cliente", key: "cliente", width: 28 },
            { header: "Placa", key: "placa", width: 10 }, { header: "Tipo", key: "tipo", width: 10 },
            { header: "RTM", key: "rtm", width: 14 }, { header: "Factura", key: "factura", width: 14 },
            { header: "Total", key: "total", width: 14, money: true }
          ],
          rows: detalle, totals: { total: c.salesTotal } }
      ]
    });
    sendXlsx(res, buf, `cierre-${date}.xlsx`);
  } catch (e) {
    next(e);
  }
});

// POST /api/closings -> congela el cierre del dia como snapshot.
router.post("/", async (req, res, next) => {
  try {
    const date = String(req.body?.date || new Date().toISOString().slice(0, 10));
    const gastos = Number(req.body?.gastos) || 0;
    const { closing } = await gatherDay(date, gastos);
    const data = {
      closingDate: date,
      salesTotal: closing.salesTotal,
      byMethod: closing.byMethod,
      provision: closing.provision,
      receivableOpen: closing.receivableOpen,
      jasperEstimado: closing.jasper,
      deducciones: closing.deducciones,
      cajaEfectivo: closing.cajaEfectivo,
      responsable: req.body?.responsable || null,
      recibe: req.body?.recibe || null
    };
    const snapshot = await prisma.dailyClosing.upsert({
      where: { closingDate: date },
      update: data,
      create: data
    });
    res.json({ snapshot, closing });
  } catch (e) {
    next(e);
  }
});

// GET /api/closings/report?from=&to=  -> consolidado calculado desde las ventas (no requiere congelar).
router.get("/report", async (req, res, next) => {
  try {
    const month = new Date().toISOString().slice(0, 7);
    const from = String(req.query.from || `${month}-01`);
    const to = String(req.query.to || `${month}-31`);
    const sales = await prisma.sale.findMany({ where: { saleDate: { gte: from, lte: to }, status: "activa" }, orderBy: { saleDate: "asc" } });
    const ids = sales.map((s) => s.id);
    const payments = ids.length ? await prisma.salePayment.findMany({ where: { saleId: { in: ids } } }) : [];
    const receivables = ids.length ? await prisma.receivable.findMany({ where: { saleId: { in: ids } } }) : [];

    const byDay = {};
    for (const s of sales) (byDay[s.saleDate] ||= []).push(s);

    const days = Object.keys(byDay).sort().map((date) => {
      const daySales = byDay[date];
      const dayIds = new Set(daySales.map((s) => s.id));
      const c = computeClosing({
        sales: daySales,
        payments: payments.filter((p) => dayIds.has(p.saleId)),
        receivables: receivables.filter((r) => dayIds.has(r.saleId))
      });
      return {
        date,
        salesTotal: c.salesTotal,
        jasper: c.jasper,
        provision: c.provision,
        deducciones: c.deducciones,
        efectivoEntregar: c.efectivoEntregar,
        receivableOpen: c.receivableOpen,
        rtmRealizadas: c.rtmRealizadas,
        rtmFacturadas: c.rtmFacturadas
      };
    });
    const totals = computeClosing({ sales, payments, receivables });
    res.json({ from, to, days, totals });
  } catch (e) {
    next(e);
  }
});

// GET /api/closings/consolidado?from=&to=  -> suma de cierres congelados.
router.get("/consolidado", async (req, res, next) => {
  try {
    const { from, to } = req.query;
    const where = {};
    if (from || to) where.closingDate = { gte: from || "0000", lte: to || "9999" };
    const items = await prisma.dailyClosing.findMany({ where, orderBy: { closingDate: "asc" } });
    const totals = items.reduce(
      (acc, it) => {
        acc.salesTotal += it.salesTotal;
        acc.provision += it.provision;
        acc.jasperEstimado += it.jasperEstimado;
        acc.deducciones += it.deducciones;
        acc.cajaEfectivo += it.cajaEfectivo;
        return acc;
      },
      { salesTotal: 0, provision: 0, jasperEstimado: 0, deducciones: 0, cajaEfectivo: 0 }
    );
    res.json({ items, totals });
  } catch (e) {
    next(e);
  }
});

export default router;
