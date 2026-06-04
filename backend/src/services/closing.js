// Cierre diario — replica el resumen del Excel (hoja "Planilla Cierre Diario",
// bloques INGRESOS / ENTREGAS / RESUMEN / EGRESOS Y CREDITO).
//
//   Subtotal SG    = DATAFONO SG + QR SG
//   Subtotal CM    = total ingresos - Subtotal SG
//   provision      = Σ provisionAmount de RTM pendientes (pendientes de transito)
//   JASPER         = Subtotal CM - provision           (lo que gira Supergiros)
//   EFECTIVO entreg= efectivo - fidelizados - gastos - referidos
//   DIFERENCIA     = JASPER - EFECTIVO entregado
//   fidelizacion   = Σ deduccion donde allyType = "usuario"
//   referidos      = Σ deduccion - fidelizacion

const SG_CODES = new Set(["DATAFONO SG", "QR SG"]);

export function computeClosing({ sales = [], payments = [], receivables = [], gastos = 0 } = {}) {
  // Ingresos por metodo (soporta pagos mixtos: se agrupa por pago, no por venta).
  const byMethod = {};
  for (const p of payments) {
    byMethod[p.methodCode] = (byMethod[p.methodCode] || 0) + (Number(p.amount) || 0);
  }

  const salesTotal = sales.reduce((s, v) => s + (Number(v.total) || 0), 0);
  const ingresosTotal = Object.values(byMethod).reduce((s, v) => s + v, 0);
  const subtotalSG = Object.entries(byMethod)
    .filter(([code]) => SG_CODES.has(code))
    .reduce((s, [, v]) => s + v, 0);
  const subtotalCM = ingresosTotal - subtotalSG;

  // Provision = dinero de RTM pendientes (no se consigna a Supergiros aun).
  const provision = sales
    .filter((v) => v.rtmStatus === "pending")
    .reduce((s, v) => s + (Number(v.provisionAmount) || Number(v.total) || 0), 0);

  // Deducciones de convenios.
  const deducciones = sales.reduce((s, v) => s + (Number(v.deduction) || 0), 0);
  const fidelizacion = sales
    .filter((v) => (v.allyType || "usuario") === "usuario")
    .reduce((s, v) => s + (Number(v.deduction) || 0), 0);
  const referidos = deducciones - fidelizacion;

  const efectivo = byMethod["EFECTIVO"] || 0;
  const gastosNum = Number(gastos) || 0;

  const jasper = subtotalCM - provision;
  const efectivoEntregar = efectivo - fidelizacion - gastosNum - referidos;
  const diferenciaJasper = jasper - efectivoEntregar;

  // RTM facturadas / realizadas / pendientes.
  const rtmFacturadas = sales.length;
  const rtmRealizadas = sales.reduce((s, v) => s + (Number(v.pinAdquirido) > 0 ? 1 : 0), 0);
  const rtmPendientes = rtmFacturadas - rtmRealizadas;

  // Cartera abierta (ADDI / GORA / credito propio / saldos).
  const receivableOpen = receivables
    .filter((r) => r.status !== "pagada")
    .reduce((s, r) => s + (Number(r.pending) || 0), 0);

  // Egresos y credito.
  const gora = byMethod["ALIADOS DE INV. GORA SAS"] || 0;
  const addi = byMethod["ADDI"] || 0;

  return {
    salesTotal,
    ingresosTotal,
    byMethod,
    subtotalSG,
    subtotalCM,
    provision,
    jasper,
    deducciones,
    fidelizacion,
    referidos,
    gastos: gastosNum,
    efectivo,
    efectivoEntregar,
    cajaEfectivo: efectivoEntregar,
    diferenciaJasper,
    rtmFacturadas,
    rtmRealizadas,
    rtmPendientes,
    receivableOpen,
    egresos: { referidos, gora, addi, fidelizados: fidelizacion },
    totalEgresosCredito: referidos + gora + addi + fidelizacion
  };
}
