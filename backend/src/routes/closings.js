import { Router } from "express";
import { prisma } from "../db.js";
import { computeClosing } from "../services/closing.js";
import { gatherDay, gatherDayAudit, money } from "../services/dayAudit.js";
import { applyDailyDispersion } from "../services/dispersion.js";
import { toWorkbook, sendXlsx } from "../services/excel.js";

const router = Router();

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

// GET /api/closings/day?date= -> tablero del dia: turnos + cierre calculado en vivo +
// estado de la dispersion (snapshot DailyClosing y cuenta por pagar Supergiros del dia).
// Es la vista para CUADRAR: suma de turnos vs consolidado del dia vs deuda Jasper.
router.get("/day", async (req, res, next) => {
  try {
    const date = String(req.query.date || new Date().toISOString().slice(0, 10));
    const { closing } = await gatherDay(date, 0);
    const shifts = await prisma.shift.findMany({ where: { businessDate: date }, orderBy: { id: "asc" } });
    const snapshot = await prisma.dailyClosing.findUnique({ where: { closingDate: date } });
    const payable = snapshot
      ? await prisma.payable.findFirst({ where: { refType: "closing", refId: snapshot.id } })
      : null;
    res.json({
      date, closing, shifts, snapshot,
      payable: payable ? { ...payable, pending: Math.max(0, payable.totalAmount - payable.paidAmount) } : null
    });
  } catch (e) {
    next(e);
  }
});

const auditDetailColumns = [
  { header: "Item", key: "item", width: 7, number: true },
  { header: "Fecha", key: "fecha", width: 12 },
  { header: "Hora", key: "hora", width: 10 },
  { header: "Venta interna", key: "ventaInterna", width: 16 },
  { header: "Factura POS/DIAN", key: "facturaPosDian", width: 18 },
  { header: "Estado factura", key: "estadoFactura", width: 14 },
  { header: "Cliente", key: "cliente", width: 30 },
  { header: "Documento", key: "documento", width: 16 },
  { header: "Placa", key: "placa", width: 10 },
  { header: "Modelo", key: "modelo", width: 10, number: true },
  { header: "Rango", key: "rango", width: 24 },
  { header: "Paquete", key: "paquete", width: 16 },
  { header: "Productos", key: "productos", width: 38 },
  { header: "Tipo cliente", key: "tipoCliente", width: 14 },
  { header: "Referido/convenio", key: "referido", width: 24 },
  { header: "Fidelizado", key: "fidelizado", width: 12 },
  { header: "Debito comision", key: "comisionDebitada", width: 14 },
  { header: "Valor comision", key: "valorComision", width: 15, money: true },
  { header: "Estado RTM", key: "rtmEstado", width: 14 },
  { header: "RTM realizada", key: "rtmRealizada", width: 13 },
  { header: "PIN registrado", key: "pinRegistrado", width: 22 },
  { header: "Provision", key: "provision", width: 14, money: true },
  { header: "Provision consumida", key: "provisionConsumida", width: 18 },
  { header: "Placa provision", key: "provisionPlaca", width: 14 },
  { header: "Metodos pago", key: "metodosPago", width: 38 },
  { header: "Efectivo real", key: "efectivoReal", width: 14, money: true },
  { header: "Bancos/Tarjeta/QR", key: "bancosTarjetaQr", width: 18, money: true },
  { header: "Cartera/Credito", key: "carteraCredito", width: 16, money: true },
  { header: "Bruto", key: "bruto", width: 14, money: true },
  { header: "Base", key: "base", width: 14, money: true },
  { header: "IVA", key: "iva", width: 14, money: true },
  { header: "Pagado", key: "pagado", width: 14, money: true },
  { header: "Cambio", key: "cambio", width: 14, money: true },
  { header: "SICOV", key: "sicov", width: 14, money: true },
  { header: "IVA SICOV", key: "ivaSicov", width: 14, money: true },
  { header: "Recaudo", key: "recaudo", width: 14, money: true },
  { header: "IVA recaudo", key: "ivaRecaudo", width: 14, money: true },
  { header: "ANSV/FNSV", key: "ansv", width: 14, money: true },
  { header: "FUPA", key: "fupa", width: 14, money: true },
  { header: "Sustratos", key: "sustratos", width: 14, money: true },
  { header: "IVA facturacion", key: "ivaFacturacion", width: 16, money: true },
  { header: "Costo transaccion", key: "costeTransaccion", width: 18, money: true },
  { header: "Costos total", key: "costosTotal", width: 16, money: true },
  { header: "Utilidad aprox.", key: "utilidadOperacion", width: 16, money: true },
  { header: "Cartera proveedor", key: "carteraProveedor", width: 18 },
  { header: "Cartera factura", key: "carteraFactura", width: 18 },
  { header: "Observaciones", key: "observaciones", width: 36 },
  { header: "Estado", key: "estado", width: 12 }
];

const paymentColumns = [
  { header: "Venta", key: "venta", width: 16 }, { header: "Factura", key: "factura", width: 16 },
  { header: "Fecha", key: "fecha", width: 12 }, { header: "Cliente", key: "cliente", width: 28 },
  { header: "Placa", key: "placa", width: 10 }, { header: "Metodo", key: "metodo", width: 24 },
  { header: "Codigo", key: "codigo", width: 14 }, { header: "Grupo dispersion", key: "grupo", width: 18 },
  { header: "Valor ingresado", key: "valorIngresado", width: 16, money: true },
  { header: "Valor efectivo venta", key: "valorEfectivoVenta", width: 18, money: true },
  { header: "Vuelto", key: "vuelto", width: 14, money: true },
  { header: "Costo metodo", key: "costoMetodo", width: 15, money: true },
  { header: "IVA costo metodo", key: "ivaCostoMetodo", width: 18, money: true }
];

const dispersionColumns = [
  { header: "Grupo", key: "grupo", width: 18 },
  { header: "Recaudo bruto", key: "recaudoBruto", width: 16, money: true },
  { header: "Servicio recaudo", key: "servicioRecaudo", width: 18, money: true },
  { header: "IVA servicio", key: "ivaServicio", width: 16, money: true },
  { header: "Servicio homologado", key: "servicioHomologado", width: 20, money: true },
  { header: "IVA homologado", key: "ivaHomologado", width: 18, money: true },
  { header: "ANSV/FNSV", key: "ansv", width: 14, money: true },
  { header: "ADQ/transaccion", key: "adqTransaccion", width: 18, money: true },
  { header: "ICA", key: "ica", width: 12, money: true },
  { header: "Neto estimado", key: "netoEstimado", width: 16, money: true },
  { header: "Cantidad", key: "cantidad", width: 10, number: true }
];

const dispersionDetailColumns = [
  { header: "Fecha", key: "fecha", width: 12 },
  { header: "Venta", key: "venta", width: 16 },
  { header: "Factura", key: "factura", width: 16 },
  { header: "Cliente", key: "cliente", width: 28 },
  { header: "Documento", key: "documento", width: 16 },
  { header: "Placa", key: "placa", width: 10 },
  { header: "Metodo", key: "metodo", width: 24 },
  { header: "Codigo metodo", key: "metodoCodigo", width: 14 },
  { header: "Grupo dispersion", key: "grupo", width: 18 },
  { header: "Recaudo bruto", key: "recaudoBruto", width: 16, money: true },
  { header: "SICOV/Homologado", key: "sicov", width: 18, money: true },
  { header: "IVA SICOV", key: "ivaSicov", width: 14, money: true },
  { header: "Servicio recaudo", key: "recaudo", width: 18, money: true },
  { header: "IVA recaudo", key: "ivaRecaudo", width: 14, money: true },
  { header: "ANSV/FNSV", key: "ansv", width: 14, money: true },
  { header: "FUPA", key: "fupa", width: 12, money: true },
  { header: "Sustratos", key: "sustratos", width: 14, money: true },
  { header: "IVA facturacion", key: "ivaFact", width: 16, money: true },
  { header: "Costo transaccion", key: "costoTransaccion", width: 18, money: true },
  { header: "Deducciones operativas", key: "deduccionesOperativas", width: 22, money: true },
  { header: "Neto estimado", key: "netoEstimado", width: 16, money: true }
];

// GET /api/closings/detail?date=&gastos= -> planilla auditable del dia.
router.get("/detail", async (req, res, next) => {
  try {
    const date = String(req.query.date || new Date().toISOString().slice(0, 10));
    const gastos = Number(req.query.gastos) || 0;
    const audit = await gatherDayAudit(date, gastos);
    res.json({
      date,
      closing: audit.closing,
      detail: audit.detailRows,
      payments: audit.paymentRows,
      dispersion: audit.dispersionSummary,
      dispersionDetail: audit.dispersionRows,
      movements: audit.movementRows,
      expenses: audit.expenseRows
    });
  } catch (e) {
    next(e);
  }
});

// GET /api/closings/detail/export?date=&gastos= -> Excel transaccion por transaccion.
router.get("/detail/export", async (req, res, next) => {
  try {
    const date = String(req.query.date || new Date().toISOString().slice(0, 10));
    const gastos = Number(req.query.gastos) || 0;
    const audit = await gatherDayAudit(date, gastos);
    const total = (key, rows = audit.detailRows) => rows.reduce((a, r) => a + money(r[key]), 0);
    const buf = await toWorkbook({
      sheets: [
        {
          name: "Detalle dia",
          title: `Detalle auditable del dia ${date}`,
          columns: auditDetailColumns,
          rows: audit.detailRows,
          totals: {
            valorComision: total("valorComision"),
            provision: total("provision"),
            efectivoReal: total("efectivoReal"),
            bancosTarjetaQr: total("bancosTarjetaQr"),
            carteraCredito: total("carteraCredito"),
            bruto: total("bruto"),
            base: total("base"),
            iva: total("iva"),
            pagado: total("pagado"),
            cambio: total("cambio"),
            sicov: total("sicov"),
            ivaSicov: total("ivaSicov"),
            recaudo: total("recaudo"),
            ivaRecaudo: total("ivaRecaudo"),
            ansv: total("ansv"),
            fupa: total("fupa"),
            sustratos: total("sustratos"),
            ivaFacturacion: total("ivaFacturacion"),
            costeTransaccion: total("costeTransaccion"),
            costosTotal: total("costosTotal"),
            utilidadOperacion: total("utilidadOperacion")
          }
        },
        { name: "Pagos", title: `Pagos del dia ${date}`, columns: paymentColumns, rows: audit.paymentRows },
        {
          name: "Dispersion por venta",
          title: `Costos de dispersion por venta/pago ${date}`,
          columns: dispersionDetailColumns,
          rows: audit.dispersionRows,
          totals: {
            recaudoBruto: total("recaudoBruto", audit.dispersionRows),
            sicov: total("sicov", audit.dispersionRows),
            ivaSicov: total("ivaSicov", audit.dispersionRows),
            recaudo: total("recaudo", audit.dispersionRows),
            ivaRecaudo: total("ivaRecaudo", audit.dispersionRows),
            ansv: total("ansv", audit.dispersionRows),
            fupa: total("fupa", audit.dispersionRows),
            sustratos: total("sustratos", audit.dispersionRows),
            ivaFact: total("ivaFact", audit.dispersionRows),
            costoTransaccion: total("costoTransaccion", audit.dispersionRows),
            deduccionesOperativas: total("deduccionesOperativas", audit.dispersionRows),
            netoEstimado: total("netoEstimado", audit.dispersionRows)
          }
        },
        {
          name: "Dispersion estimada",
          title: `Estimado Supergiros por grupo ${date}`,
          columns: dispersionColumns,
          rows: audit.dispersionSummary,
          totals: {
            recaudoBruto: total("recaudoBruto", audit.dispersionSummary),
            servicioRecaudo: total("servicioRecaudo", audit.dispersionSummary),
            ivaServicio: total("ivaServicio", audit.dispersionSummary),
            servicioHomologado: total("servicioHomologado", audit.dispersionSummary),
            ivaHomologado: total("ivaHomologado", audit.dispersionSummary),
            ansv: total("ansv", audit.dispersionSummary),
            adqTransaccion: total("adqTransaccion", audit.dispersionSummary),
            ica: total("ica", audit.dispersionSummary),
            netoEstimado: total("netoEstimado", audit.dispersionSummary),
            cantidad: total("cantidad", audit.dispersionSummary)
          }
        },
        {
          name: "Movimientos caja",
          title: `Movimientos de caja ${date}`,
          columns: [
            { header: "Fecha", key: "fecha", width: 12 }, { header: "Caja", key: "caja", width: 18 },
            { header: "Tipo", key: "tipo", width: 12 }, { header: "Valor", key: "valor", width: 14, money: true },
            { header: "Referencia", key: "refTipo", width: 14 }, { header: "ID ref", key: "refId", width: 10 },
            { header: "Nota", key: "nota", width: 36 }
          ],
          rows: audit.movementRows,
          totals: { valor: total("valor", audit.movementRows) }
        },
        {
          name: "Gastos",
          title: `Gastos registrados ${date}`,
          columns: [
            { header: "Fecha", key: "fecha", width: 12 }, { header: "Concepto", key: "concepto", width: 30 },
            { header: "Categoria", key: "categoria", width: 18 }, { header: "Caja", key: "caja", width: 18 },
            { header: "Valor", key: "valor", width: 14, money: true }, { header: "Nota", key: "nota", width: 34 },
            { header: "Estado", key: "estado", width: 12 }
          ],
          rows: audit.expenseRows,
          totals: { valor: total("valor", audit.expenseRows) }
        }
      ]
    });
    sendXlsx(res, buf, `detalle-dia-${date}.xlsx`);
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
      { concepto: "Gastos del día (salen de caja menor, no del cierre)", valor: c.gastosRegistrados ?? c.gastos },
      { concepto: "Efectivo recibido", valor: c.efectivo },
      { concepto: "Efectivo a entregar (a caja menor)", valor: c.efectivoEntregar },
      { concepto: "DIFERENCIA JASPER (= comisiones)", valor: c.diferenciaJasper },
      { concepto: "Cartera abierta", valor: c.receivableOpen },
      { concepto: "RTM realizadas", valor: c.rtmRealizadas },
      { concepto: "RTM facturadas", valor: c.rtmFacturadas }
    ];
    const ingresos = Object.entries(c.byMethod).map(([metodo, valor]) => ({ metodo, cantidad: c.countByMethod?.[metodo] || 0, valor }));
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
          columns: [{ header: "Metodo", key: "metodo", width: 28 }, { header: "Cant.", key: "cantidad", width: 8, number: true }, { header: "Valor", key: "valor", width: 16, money: true }],
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

// POST /api/closings -> congela el cierre del DIA (consolidado de los turnos) Y dispersa:
//   - ingresa el efectivo a entregar del dia a CAJA_MENOR
//   - crea/actualiza la cuenta por pagar a Supergiros (Jasper) del dia
// Idempotente: re-cerrar el dia actualiza montos sin duplicar ni perder abonos.
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
    const snapshot = await prisma.$transaction(async (tx) => {
      const snap = await tx.dailyClosing.upsert({ where: { closingDate: date }, update: data, create: data });
      await applyDailyDispersion(tx, { snapshotId: snap.id, closing, date });
      return snap;
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

// GET /api/closings/report/export?from=&to=  -> consolidado por dia en Excel.
router.get("/report/export", async (req, res, next) => {
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
    const rows = Object.keys(byDay).sort().map((date) => {
      const daySales = byDay[date];
      const dayIds = new Set(daySales.map((s) => s.id));
      const c = computeClosing({ sales: daySales, payments: payments.filter((p) => dayIds.has(p.saleId)), receivables: receivables.filter((r) => dayIds.has(r.saleId)) });
      return { fecha: date, ventas: c.salesTotal, jasper: c.jasper, provision: c.provision, deducciones: c.deducciones, efectivo: c.efectivoEntregar, rtm: `${c.rtmRealizadas}/${c.rtmFacturadas}` };
    });
    const t = computeClosing({ sales, payments, receivables });
    const buf = await toWorkbook({
      sheets: [{
        name: "Consolidado", title: `Consolidado ${from} a ${to}`,
        columns: [
          { header: "Dia", key: "fecha", width: 12 }, { header: "Ventas", key: "ventas", width: 14, money: true },
          { header: "Jasper", key: "jasper", width: 14, money: true }, { header: "Provision", key: "provision", width: 14, money: true },
          { header: "Deducciones", key: "deducciones", width: 14, money: true }, { header: "Efectivo", key: "efectivo", width: 14, money: true },
          { header: "RTM", key: "rtm", width: 10 }
        ],
        rows, totals: { ventas: t.salesTotal, jasper: t.jasper, provision: t.provision, deducciones: t.deducciones, efectivo: t.efectivoEntregar }
      }]
    });
    sendXlsx(res, buf, `consolidado-${from}_${to}.xlsx`);
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
