import { prisma } from "../db.js";
import { computeClosing } from "./closing.js";

export const money = (v) => Math.round(Number(v) || 0);

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
      costoTransaccion: money(p.costAmount) + money(p.costTax),
      netoEstimado: p.effectiveAmount - (money(p.costAmount) + money(p.costTax))
    };
    for (const key of fixedCostKeys) row[key] = money((cost?.[key] || 0) * ratio);
    row.deduccionesOperativas = fixedCostKeys.reduce((a, key) => a + money(row[key]), 0) + row.costoTransaccion;
    row.netoEstimado = row.recaudoBruto - row.deduccionesOperativas;
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

export async function gatherDay(date, gastosManual = 0) {
  const sales = await prisma.sale.findMany({ where: { saleDate: date, status: "activa" } });
  const ids = sales.map((s) => s.id);
  const payments = ids.length ? await prisma.salePayment.findMany({ where: { saleId: { in: ids } } }) : [];
  const receivables = ids.length ? await prisma.receivable.findMany({ where: { saleId: { in: ids } } }) : [];
  const dayExpenses = await prisma.expense.findMany({ where: { date, status: "activa" } });
  const gastosRegistrados = dayExpenses.reduce((a, e) => a + e.amount, 0);
  const closing = computeClosing({ sales, payments, receivables, gastos: gastosRegistrados + Number(gastosManual || 0) });
  closing.gastosRegistrados = gastosRegistrados;
  closing.gastosManual = Number(gastosManual || 0);
  return { sales, payments, receivables, closing, expenses: dayExpenses };
}

export async function buildDispersionForSales(sales = [], payments = [], costs = []) {
  const paymentsBySale = {};
  for (const p of payments) (paymentsBySale[p.saleId] ||= []).push(p);
  const costBySale = Object.fromEntries(costs.map((c) => [c.saleId, c]));
  return sales.flatMap((s) => splitCostsByPayment(s, costBySale[s.id] || {}, effectivePaymentsForSale(s, paymentsBySale[s.id] || [])));
}

export async function gatherDayAudit(date, gastosManual = 0) {
  const day = await gatherDay(date, gastosManual);
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
      efectivoReal: summary.efectivo,
      bancosTarjetaQr: summary.bancos,
      carteraCredito: summary.cartera,
      bruto: money(s.total),
      base: money(s.totalBase),
      iva: money(s.totalIva),
      pagado: money(s.paidAmount),
      cambio: money(s.changeAmount),
      sicov: money(cost.sicov),
      ivaSicov: money(cost.ivaSicov),
      recaudo: money(cost.recaudo),
      ivaRecaudo: money(cost.ivaRecaudo),
      ansv: money(cost.ansv),
      fupa: money(cost.fupa),
      sustratos: money(cost.sustratos),
      ivaFacturacion: money(cost.ivaFact),
      costeTransaccion: money(cost.costeTransaccion),
      costosTotal: money(cost.costosTotal),
      utilidadOperacion: money(s.total) - money(cost.costosTotal) - money(s.deduction),
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
        costoMetodo: money(p.costAmount),
        ivaCostoMetodo: money(p.costTax)
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
