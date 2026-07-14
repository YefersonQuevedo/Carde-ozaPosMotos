// Costos operativos por venta. Las tarifas (SICOV, RECAUDO, ANSV, FUPA, SUSTRATOS,
// IVA_FACT, IVA_RATE) viven en la tabla `tariffs` por tipo de vehiculo y vigencia,
// para escalar a otros vehiculos (carros, etc.) y soportar cambios anuales sin tocar codigo.

const round = (n) => Math.round(Number(n) || 0);
// Costos con 3 decimales (IVA, costos de transaccion): no se redondean a peso entero.
const dec3 = (n) => Math.round((Number(n) || 0) * 1000) / 1000;

/// Construye el lookup de tarifas vigentes a una fecha, eligiendo la ultima vigencia.
/// `rows` = filas de Tariff (ya filtradas por vehicleType o no).
export function buildTariffLookup(rows = [], date = "9999-12-31") {
  const valid = rows.filter((r) => r.active !== false && String(r.validFrom) <= date);
  const byConcept = {};
  for (const r of valid) (byConcept[r.concept] ||= []).push(r);

  const fixed = {};
  let ivaRate = 0.19;
  let ansv = [];
  for (const [concept, list] of Object.entries(byConcept)) {
    const maxV = list.reduce((m, r) => (String(r.validFrom) > m ? String(r.validFrom) : m), "");
    const latest = list.filter((r) => String(r.validFrom) === maxV);
    if (concept === "ANSV") ansv = latest;
    else if (concept === "IVA_RATE") ivaRate = (latest[0].value || 0) / 100;
    else fixed[concept] = latest[0].value || 0;
  }
  return { fixed, ivaRate, ansv };
}

/// ANSV segun anio del modelo, desde las tarifas (rango yearFrom..yearTo).
export function ansvFromTariffs(ansvRows, modelYear) {
  const year = Number(modelYear) || 0;
  if (!year) return 0;
  const row = ansvRows.find((r) => year >= (r.yearFrom ?? 0) && year <= (r.yearTo ?? 9999));
  return row ? row.value : 0;
}

/// Costo de transaccion de UN pago (regla del metodo, congelada).
export function paymentCost(method, amount) {
  const value = Number(amount) || 0;
  const type = method?.costType || "none";
  if (value <= 0 || type === "none") return { costType: type, costAmount: 0, costTax: 0 };
  if (type === "percent") return { costType: type, costAmount: dec3(value * (method.costRate || 0)), costTax: 0 };
  if (type === "fixed") return { costType: type, costAmount: dec3(method.costAmount || 0), costTax: 0 };
  if (type === "percent_plus_tax") {
    const commission = value * (method.costRate || 0);
    return { costType: type, costAmount: dec3(commission), costTax: dec3(commission * (method.costTaxRate || 0.19)) };
  }
  return { costType: type, costAmount: 0, costTax: 0 };
}

/// Costos congelados de la venta, usando el lookup de tarifas.
export function computeSaleCosts({ tariffs, pinAdquirido = 0, modelYear = 0, facturada = false, payments = [] }) {
  const t = tariffs || { fixed: {}, ivaRate: 0.19, ansv: [] };
  const rtmDone = Number(pinAdquirido) > 0;
  const f = t.fixed || {};

  const sicov = rtmDone ? f.SICOV || 0 : 0;
  const ivaSicov = dec3(sicov * t.ivaRate);
  const recaudo = rtmDone ? f.RECAUDO || 0 : 0;
  const ivaRecaudo = dec3(recaudo * t.ivaRate);
  const ansv = ansvFromTariffs(t.ansv || [], modelYear);
  const fupa = rtmDone ? f.FUPA || 0 : 0;
  const sustratos = rtmDone ? f.SUSTRATOS || 0 : 0;
  const ivaFact = facturada ? f.IVA_FACT || 0 : 0;

  const costeTransaccion = dec3(payments.reduce((s, p) => s + (Number(p.costAmount) || 0) + (Number(p.costTax) || 0), 0));
  const costosTotal = dec3(sicov + ivaSicov + recaudo + ivaRecaudo + ansv + fupa + sustratos + ivaFact + costeTransaccion);

  return { sicov, ivaSicov, recaudo, ivaRecaudo, ansv, fupa, sustratos, ivaFact, costeTransaccion, costosTotal };
}
