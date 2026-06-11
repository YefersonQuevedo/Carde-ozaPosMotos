// Cierre diario — replica el resumen del Excel (hoja "Planilla Cierre Diario",
// bloques INGRESOS / ENTREGAS / RESUMEN / EGRESOS Y CREDITO).
//
//   Subtotal SG    = DATAFONO SG + QR SG
//   descuentoFenix = cupon/descuento al usuario (NO es dinero real, no va a Supergiros)
//   Subtotal CM    = total ingresos - Subtotal SG - descuentoFenix
//   provision      = Σ provisionAmount de RTM pendientes (pendientes de transito)
//   JASPER         = valor de las RTM - Subtotal SG - provision   (lo que se gira a Supergiros;
//                    es el valor de las tecnomecanicas, NO incluye comisiones ni descuentos)
//   EFECTIVO entreg= efectivo - fidelizados - referidos   (las comisiones/descuentos NO van a
//                    caja menor: se apartan en provisiones para pagar a los referidos)
//   DIFERENCIA     = JASPER - EFECTIVO entregado  (= comisiones/descuentos que el CDA cubre)
//   fidelizacion   = Σ deduccion (usuario) + descuento Fenix/cupon
//   referidos      = comisiones a convenios (Σ deduccion de referidos)

const SG_CODES = new Set(["DATAFONO SG", "QR SG"]);

export function computeClosing({ sales = [], payments = [], receivables = [], gastos = 0 } = {}) {
  // Ingresos por metodo (soporta pagos mixtos: se agrupa por pago, no por venta).
  // countByMethod = cuantos pagos (operaciones) se hicieron por cada metodo.
  const byMethod = {};
  const countByMethod = {};
  for (const p of payments) {
    byMethod[p.methodCode] = (byMethod[p.methodCode] || 0) + (Number(p.amount) || 0);
    countByMethod[p.methodCode] = (countByMethod[p.methodCode] || 0) + 1;
  }

  const salesTotal = sales.reduce((s, v) => s + (Number(v.total) || 0), 0);
  const ingresosTotal = Object.values(byMethod).reduce((s, v) => s + v, 0);
  const subtotalSG = Object.entries(byMethod)
    .filter(([code]) => SG_CODES.has(code))
    .reduce((s, [, v]) => s + v, 0);
  // El descuento Fenix/cupon NO es dinero real ni se gira a Supergiros: es una
  // comision/descuento que se aparta en provisiones. Se excluye del subtotal CM.
  const descuentoFenix = byMethod["DESCUENTO_FENIX"] || 0;
  const subtotalCM = ingresosTotal - subtotalSG - descuentoFenix;

  // Provision = dinero de RTM pendientes (no se consigna a Supergiros aun).
  const provision = sales
    .filter((v) => v.rtmStatus === "pending")
    .reduce((s, v) => s + (Number(v.provisionAmount) || Number(v.total) || 0), 0);

  // Deducciones (comisiones a referidos + descuentos/cupones a usuarios). Van a provisiones.
  const deduccionesSales = sales.reduce((s, v) => s + (Number(v.deduction) || 0), 0);
  const fidelizacionSales = sales
    .filter((v) => (v.allyType || "usuario") === "usuario")
    .reduce((s, v) => s + (Number(v.deduction) || 0), 0);
  const fidelizacion = fidelizacionSales + descuentoFenix; // el cupon/descuento cuenta como deduccion a usuario
  const deducciones = deduccionesSales + descuentoFenix;
  const referidos = deducciones - fidelizacion;

  const efectivo = byMethod["EFECTIVO"] || 0;
  const gastosNum = Number(gastos) || 0;

  // JASPER = lo que se gira a Supergiros = valor de las RTM (no SG, no pendientes).
  // NO incluye comisiones/descuentos: esos los cubre el CDA (diferencia Jasper).
  const jasper = salesTotal - subtotalSG - provision;
  // Los gastos ya NO restan del efectivo a entregar: el efectivo entra completo a
  // caja menor y los gastos se descuentan despues como egreso de caja menor.
  const efectivoEntregar = efectivo - fidelizacion - referidos;
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
    countByMethod,
    subtotalSG,
    subtotalCM,
    provision,
    jasper,
    deducciones,
    descuentoFenix,
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
