import { prisma } from "../db.js";
import { computeClosing } from "./closing.js";

export const money = (v) => Math.round(Number(v) || 0);
// Costos/dispersion: 3 decimales (no se redondean a peso entero).
export const dec3 = (v) => Math.round((Number(v) || 0) * 1000) / 1000;

export function paymentBucket(payment = {}) {
  const raw = `${payment.groupCode || ""} ${payment.methodCode || ""} ${payment.methodName || ""}`.toUpperCase();
  if (raw.includes("EFECT")) return "Efectivo";
  if (raw.includes("GORA") || raw.includes("ADDI") || raw.includes("CRED")) return "Cartera";
  if (raw.includes("QR")) return "Bancos/QR";
  if (raw.includes("TARJ") || raw.includes("DATA") || raw.includes("BANCO") || raw.includes("NEQUI") || raw.includes("DAVIPLATA")) return "Bancos/Tarjeta";
  return payment.groupCode || payment.methodName || "Otro";
}

export function effectivePaymentsForSale(sale, payments = []) {
  const change = money(sale.changeAmount);
  let remainingChange = change;
  return payments.map((p) => {
    let effectiveAmount = money(p.amount);
    if (remainingChange > 0 && String(p.methodCode || "").toUpperCase() === "EFECTIVO") {
      const usedChange = Math.min(remainingChange, effectiveAmount);
      effectiveAmount -= usedChange;
      remainingChange -= usedChange;
    }
    return { ...p, effectiveAmount: Math.max(0, effectiveAmount), bucket: paymentBucket(p) };
  });
}

export function splitCostsByPayment(sale, cost, effectivePayments = []) {
  const base = money(sale.total) || effectivePayments.reduce((a, p) => a + p.effectiveAmount, 0) || 1;
  const fixedCostKeys = ["sicov", "ivaSicov", "recaudo", "ivaRecaudo", "ansv", "fupa", "sustratos", "ivaFact"];
  return effectivePayments.map((p) => {
    const ratio = Math.max(0, p.effectiveAmount) / base;
    const row = {
      saleId: sale.id,
      venta: sale.saleNumber,
      factura: sale.invoiceNumber || "",
      fecha: sale.saleDate,
      cliente: sale.clientName,
      documento: sale.clientDoc,
      placa: sale.plate || "",
      metodo: p.methodName,
      metodoCodigo: p.methodCode,
      grupo: p.bucket,
      recaudoBruto: p.effectiveAmount,
      costoTransaccion: dec3((Number(p.costAmount) || 0) + (Number(p.costTax) || 0)),
      netoEstimado: 0
    };
    for (const key of fixedCostKeys) row[key] = dec3((cost?.[key] || 0) * ratio);
    row.deduccionesOperativas = dec3(fixedCostKeys.reduce((a, key) => a + (Number(row[key]) || 0), 0) + row.costoTransaccion);
    row.netoEstimado = dec3(row.recaudoBruto - row.deduccionesOperativas);
    return row;
  });
}

export function compactPaymentSummary(effectivePayments = []) {
  const byMethod = {};
  const byBucket = {};
  for (const p of effectivePayments) {
    byMethod[p.methodName] = (byMethod[p.methodName] || 0) + money(p.effectiveAmount);
    byBucket[p.bucket] = (byBucket[p.bucket] || 0) + money(p.effectiveAmount);
  }
  return {
    metodos: Object.entries(byMethod).map(([k, v]) => `${k}: ${v}`).join(" | "),
    efectivo: byBucket.Efectivo || 0,
    bancos: Object.entries(byBucket).filter(([k]) => k !== "Efectivo" && k !== "Cartera").reduce((a, [, v]) => a + v, 0),
    cartera: byBucket.Cartera || 0
  };
}

export function summarizeDispersion(dispersionRows = []) {
  return Object.values(dispersionRows.reduce((acc, r) => {
    const key = r.grupo;
    acc[key] ||= {
      grupo: key,
      recaudoBruto: 0,
      servicioRecaudo: 0,
      ivaServicio: 0,
      servicioHomologado: 0,
      ivaHomologado: 0,
      ansv: 0,
      adqTransaccion: 0,
      ica: 0,
      netoEstimado: 0,
      cantidad: 0
    };
    acc[key].recaudoBruto += r.recaudoBruto;
    acc[key].servicioRecaudo += r.recaudo;
    acc[key].ivaServicio += r.ivaRecaudo;
    acc[key].servicioHomologado += r.sicov;
    acc[key].ivaHomologado += r.ivaSicov;
    acc[key].ansv += r.ansv;
    acc[key].adqTransaccion += r.costoTransaccion;
    acc[key].netoEstimado += r.netoEstimado;
    acc[key].cantidad += r.recaudoBruto > 0 ? 1 : 0;
    return acc;
  }, {}));
}

// Filtro por METODOS DE PAGO (prorrateo). Si methodCodes es null/vacio devuelve todo
// sin tocar. Si trae codigos: incluye solo ventas con al menos un pago de esos metodos;
// `salesScaled` lleva los montos prorrateados (para los KPIs/resumen) y `sales` lleva
// las ventas originales (para la dispersion, que necesita el total real para repartir
// los costos) + solo los pagos de los metodos elegidos.
export function filterByMethods(sales = [], payments = [], receivables = [], methodCodes = null) {
  if (!methodCodes || !methodCodes.length) return { sales, salesScaled: sales, payments, receivables };
  const set = new Set(methodCodes);
  const bySale = {};
  for (const p of payments) (bySale[p.saleId] ||= []).push(p);
  const kept = [], scaled = [], keptPayments = [], keepIds = new Set();
  for (const s of sales) {
    const ps = bySale[s.id] || [];
    const eff = effectivePaymentsForSale(s, ps);
    const totalEff = eff.reduce((a, p) => a + p.effectiveAmount, 0);
    const selEff = eff.filter((p) => set.has(p.methodCode)).reduce((a, p) => a + p.effectiveAmount, 0);
    const ratio = totalEff > 0 ? selEff / totalEff : 0;
    if (ratio <= 0) continue;
    keepIds.add(s.id);
    kept.push(s);
    scaled.push({
      ...s,
      total: Math.round((s.total || 0) * ratio),
      totalBase: Math.round((s.totalBase || 0) * ratio),
      totalIva: Math.round((s.totalIva || 0) * ratio),
      provisionAmount: Math.round((s.provisionAmount || 0) * ratio),
      deduction: Math.round((s.deduction || 0) * ratio)
    });
    for (const p of ps) if (set.has(p.methodCode)) keptPayments.push(p);
  }
  return { sales: kept, salesScaled: scaled, payments: keptPayments, receivables: receivables.filter((r) => keepIds.has(r.saleId)) };
}

export async function gatherDay(date, gastosManual = 0, methodCodes = null) {
  const salesAll = await prisma.sale.findMany({ where: { saleDate: date, status: "activa" } });
  const idsAll = salesAll.map((s) => s.id);
  const paymentsAll = idsAll.length ? await prisma.salePayment.findMany({ where: { saleId: { in: idsAll } } }) : [];
  const receivablesAll = idsAll.length ? await prisma.receivable.findMany({ where: { saleId: { in: idsAll } } }) : [];
  const { sales, salesScaled, payments, receivables } = filterByMethods(salesAll, paymentsAll, receivablesAll, methodCodes);
  const dayExpenses = await prisma.expense.findMany({ where: { date, status: "activa" } });
  const gastosRegistrados = dayExpenses.reduce((a, e) => a + e.amount, 0);
  // KPIs/resumen: ventas prorrateadas. Dispersion/detalle: ventas originales (`sales`).
  const closing = computeClosing({ sales: salesScaled, payments, receivables, gastos: gastosRegistrados + Number(gastosManual || 0) });
  closing.gastosRegistrados = gastosRegistrados;
  closing.gastosManual = Number(gastosManual || 0);
  return { sales, payments, receivables, closing, expenses: dayExpenses };
}

// Cierre calculado sobre las ventas de UN turno (no de todo el dia).
export async function gatherShift(shiftId) {
  const sales = await prisma.sale.findMany({ where: { shiftId, status: "activa" } });
  const ids = sales.map((s) => s.id);
  const payments = ids.length ? await prisma.salePayment.findMany({ where: { saleId: { in: ids } } }) : [];
  const receivables = ids.length ? await prisma.receivable.findMany({ where: { saleId: { in: ids } } }) : [];
  const closing = computeClosing({ sales, payments, receivables });
  return { sales, payments, receivables, closing };
}

export async function buildDispersionForSales(sales = [], payments = [], costs = []) {
  const paymentsBySale = {};
  for (const p of payments) (paymentsBySale[p.saleId] ||= []).push(p);
  const costBySale = Object.fromEntries(costs.map((c) => [c.saleId, c]));
  return sales.flatMap((s) => splitCostsByPayment(s, costBySale[s.id] || {}, effectivePaymentsForSale(s, paymentsBySale[s.id] || [])));
}

export async function gatherDayAudit(date, gastosManual = 0, methodCodes = null) {
  const day = await gatherDay(date, gastosManual, methodCodes);
  const ids = day.sales.map((s) => s.id);
  const [lines, costs, movements] = await Promise.all([
    ids.length ? prisma.saleLine.findMany({ where: { saleId: { in: ids } }, orderBy: { id: "asc" } }) : [],
    ids.length ? prisma.saleCost.findMany({ where: { saleId: { in: ids } } }) : [],
    prisma.cashMovement.findMany({ where: { date }, orderBy: { id: "asc" } })
  ]);
  const paymentsBySale = {};
  for (const p of day.payments) (paymentsBySale[p.saleId] ||= []).push(p);
  const linesBySale = {};
  for (const l of lines) (linesBySale[l.saleId] ||= []).push(l);
  const receivablesBySale = {};
  for (const r of day.receivables) (receivablesBySale[r.saleId] ||= []).push(r);
  const costBySale = Object.fromEntries(costs.map((c) => [c.saleId, c]));

  const detailRows = [];
  const paymentRows = [];
  const dispersionRows = [];

  day.sales.sort((a, b) => String(a.saleNumber).localeCompare(String(b.saleNumber))).forEach((s, idx) => {
    const salePayments = effectivePaymentsForSale(s, paymentsBySale[s.id] || []);
    const cost = costBySale[s.id] || {};
    const summary = compactPaymentSummary(salePayments);
    const saleLines = linesBySale[s.id] || [];
    const saleReceivables = receivablesBySale[s.id] || [];
    const itemNames = saleLines.map((l) => l.description).join(" | ");
    detailRows.push({
      item: idx + 1,
      id: s.id,
      fecha: s.saleDate,
      hora: s.saleTime || "",
      ventaInterna: s.saleNumber,
      facturaPosDian: s.invoiceNumber || "",
      estadoFactura: s.dianStatus,
      cliente: s.clientName,
      documento: s.clientDoc,
      placa: s.plate || "",
      modelo: s.modelYear || "",
      rango: s.rangeName || "",
      paquete: s.packageCode || "",
      productos: itemNames,
      tipoCliente: s.allyType,
      referido: s.allyName || "",
      fidelizado: s.allyType === "usuario" ? "Si" : "No",
      comisionDebitada: money(s.deduction) > 0 ? "Si" : "No",
      valorComision: money(s.deduction),
      rtmEstado: s.rtmStatus,
      rtmRealizada: money(s.pinAdquirido) > 0 ? "Si" : "No",
      pinRegistrado: s.pinNumber || (money(s.pinAdquirido) > 0 ? "SIN PIN REGISTRADO" : ""),
      provision: money(s.provisionAmount),
      provisionConsumida: s.provisionConsumed ? "Si" : "No",
      provisionPlaca: s.provisionSourcePlate || "",
      metodosPago: summary.metodos,
      // Detalle por pago (para el export: una fila por método con su valor en columna aparte).
      pagosDetalle: salePayments.map((p) => ({ metodo: p.methodName, valor: money(p.effectiveAmount) })),
      efectivoReal: summary.efectivo,
      bancosTarjetaQr: summary.bancos,
      carteraCredito: summary.cartera,
      bruto: money(s.total),
      base: money(s.totalBase),
      iva: money(s.totalIva),
      pagado: money(s.paidAmount),
      cambio: money(s.changeAmount),
      sicov: dec3(cost.sicov),
      ivaSicov: dec3(cost.ivaSicov),
      recaudo: dec3(cost.recaudo),
      ivaRecaudo: dec3(cost.ivaRecaudo),
      ansv: dec3(cost.ansv),
      fupa: dec3(cost.fupa),
      sustratos: dec3(cost.sustratos),
      ivaFacturacion: dec3(cost.ivaFact),
      costeTransaccion: dec3(cost.costeTransaccion),
      costosTotal: dec3(cost.costosTotal),
      utilidadOperacion: dec3(money(s.total) - (Number(cost.costosTotal) || 0) - money(s.deduction)),
      carteraProveedor: saleReceivables.map((r) => r.provider).join(" | "),
      carteraFactura: saleReceivables.map((r) => r.invoiceNumber || s.invoiceNumber || "").filter(Boolean).join(" | "),
      observaciones: s.observaciones || "",
      estado: s.status
    });
    for (const p of salePayments) {
      paymentRows.push({
        venta: s.saleNumber,
        factura: s.invoiceNumber || "",
        fecha: s.saleDate,
        cliente: s.clientName,
        placa: s.plate || "",
        metodo: p.methodName,
        codigo: p.methodCode,
        grupo: p.bucket,
        valorIngresado: money(p.amount),
        valorEfectivoVenta: money(p.effectiveAmount),
        vuelto: String(p.methodCode || "").toUpperCase() === "EFECTIVO" ? money(s.changeAmount) : 0,
        costoMetodo: dec3(p.costAmount),
        ivaCostoMetodo: dec3(p.costTax)
      });
    }
    dispersionRows.push(...splitCostsByPayment(s, cost, salePayments));
  });

  const movementRows = movements.map((m) => ({
    fecha: m.date,
    caja: m.boxCode,
    tipo: m.type,
    valor: m.type === "egreso" ? -money(m.amount) : money(m.amount),
    refTipo: m.refType || "",
    refId: m.refId || "",
    nota: m.note || ""
  }));
  const expenseRows = day.expenses.map((e) => ({
    fecha: e.date,
    concepto: e.concept,
    categoria: e.category || "",
    caja: e.boxCode,
    valor: money(e.amount),
    nota: e.note || "",
    estado: e.status
  }));

  return {
    ...day,
    detailRows,
    paymentRows,
    dispersionRows,
    dispersionSummary: summarizeDispersion(dispersionRows),
    movementRows,
    expenseRows
  };
}
