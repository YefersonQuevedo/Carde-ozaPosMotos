// Costos operativos por venta — replica EXACTA del "FORMATO CIERRE 2.3 2026.xlsx"
// (hoja "Planilla Cierre Diario", columnas N..W).
//
// Reglas del Excel:
//   SICOV (N)  = pin>0 ? 29825 : 0      ; IVA SICOV (O)  = SICOV * 0.19
//   RECAUDO(P) = pin>0 ? 8693  : 0      ; IVA RECAUDO(Q) = RECAUDO * 0.19
//   ANSV (R)   = por anio del MODELO (no depende del pin)
//   FUPA (S)   = pin>0 ? 5600  : 0      (tarifa RUNT por RTM)
//   SUSTRATOS(V)= pin>0 ? 800  : 0
//   IVA de FACT(U)= facturada ? 37185 : 0
//   COSTE TRANSACCION (T) = por metodo de pago (sumado en pagos mixtos)
//   COSTOS TOTAL (W) = suma de N..V

export const SICOV_BASE = 29825;
export const RECAUDO_BASE = 8693;
export const FUPA_FEE = 5600;
export const SUSTRATOS_FEE = 800;
export const IVA_FACT_FEE = 37185;
export const IVA_RATE = 0.19;

const round = (n) => Math.round(Number(n) || 0);

/// ANSV segun anio del modelo (formula R del Excel).
export function ansvCost(modelYear) {
  const year = Number(modelYear) || 0;
  if (!year) return 0;
  if (year >= 2024) return 8500;
  if (year >= 2019) return 8800; // 2019-2023
  if (year >= 2010) return 9100; // 2010-2018
  return 8800; // <= 2009
}

/// Costo de transaccion de UN pago, segun la regla del metodo (catalogo).
/// Devuelve la comision (costAmount) y su IVA (costTax) por separado para
/// dejarlos congelados en sale_payments. El coste total es costAmount+costTax.
export function paymentCost(method, amount) {
  const value = Number(amount) || 0;
  const type = method?.costType || "none";
  if (value <= 0 || type === "none") return { costType: type, costAmount: 0, costTax: 0 };

  if (type === "percent") {
    return { costType: type, costAmount: round(value * (method.costRate || 0)), costTax: 0 };
  }
  if (type === "fixed") {
    return { costType: type, costAmount: round(method.costAmount || 0), costTax: 0 };
  }
  if (type === "percent_plus_tax") {
    const commission = value * (method.costRate || 0);
    return {
      costType: type,
      costAmount: round(commission),
      costTax: round(commission * (method.costTaxRate || IVA_RATE))
    };
  }
  return { costType: type, costAmount: 0, costTax: 0 };
}

/// Costos congelados de la venta. `payments` ya trae costAmount/costTax por pago.
export function computeSaleCosts({ pinAdquirido = 0, modelYear = 0, facturada = false, payments = [] }) {
  const rtmDone = Number(pinAdquirido) > 0;

  const sicov = rtmDone ? SICOV_BASE : 0;
  const ivaSicov = round(sicov * IVA_RATE);
  const recaudo = rtmDone ? RECAUDO_BASE : 0;
  const ivaRecaudo = round(recaudo * IVA_RATE);
  const ansv = ansvCost(modelYear);
  const fupa = rtmDone ? FUPA_FEE : 0;
  const sustratos = rtmDone ? SUSTRATOS_FEE : 0;
  const ivaFact = facturada ? IVA_FACT_FEE : 0;

  const costeTransaccion = payments.reduce(
    (sum, p) => sum + (Number(p.costAmount) || 0) + (Number(p.costTax) || 0),
    0
  );

  const costosTotal =
    sicov + ivaSicov + recaudo + ivaRecaudo + ansv + fupa + sustratos + ivaFact + costeTransaccion;

  return {
    sicov,
    ivaSicov,
    recaudo,
    ivaRecaudo,
    ansv,
    fupa,
    sustratos,
    ivaFact,
    costeTransaccion,
    costosTotal
  };
}
