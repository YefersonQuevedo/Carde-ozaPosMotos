// Integracion con apidian (servicio UBL 2.1 que arma el XML, calcula el CUFE,
// firma y envia a la DIAN). Igual que el programa C#: aqui solo se arma el JSON
// y se hace POST {apidianUrl}/invoice con Bearer {apidianToken}; la respuesta
// (cufe, dian_is_valid, track id, mensajes) se guarda como trazabilidad.
//
// NOTA: apidian debe estar levantado y la empresa/resolucion/software ya
// configurados en el. Aqui se mandan los datos de la factura.

// CC=3, NIT=6, CE=5, PAS=7, TI=2 (catalogo DIAN type_document_identification_id).
const DOC_TYPE_MAP = { CC: 3, NIT: 6, CE: 5, PAS: 7, TI: 2, RC: 11 };

function customerFromClient(client) {
  const docType = (client?.docType || "CC").toUpperCase();
  const isNit = docType === "NIT";
  return {
    identification_number: Number(String(client?.docNumber || "222222222222").replace(/\D/g, "")) || 222222222222,
    dv: client?.dv || undefined,
    name: client?.name || "Consumidor final",
    phone: client?.phone || "0000000",
    address: client?.address || "N/A",
    email: client?.email || "no@email.com",
    merchant_registration: "0000000-00",
    type_document_identification_id: DOC_TYPE_MAP[docType] || 3,
    type_organization_id: isNit ? 1 : 2, // 1 juridica, 2 natural
    type_liability_id: 117, // No responsable
    type_regime_id: 2, // No responsable de IVA
    municipality_id: client?.municipalityId || 822 // Girardot (ajustable)
  };
}

// Arma el payload apidian a partir de la factura + venta + lineas + cliente + config.
export function buildApidianPayload({ invoice, sale, lines, client, config }) {
  const base = Number(invoice.base) || 0;
  const iva = Number(invoice.iva) || 0;
  const total = Number(invoice.total) || base + iva;
  const number = Number(String(invoice.number).replace(/\D/g, "")) || invoice.id;

  const invoice_lines = (lines || []).map((l, i) => {
    const lBase = Number(l.base) || 0;
    const lTax = Number(l.tax) || 0;
    const rate = lBase > 0 ? Math.round((lTax / lBase) * 100) : 0;
    return {
      unit_measure_id: 70,
      invoiced_quantity: String(l.quantity || 1),
      line_extension_amount: lBase.toFixed(2),
      free_of_charge_indicator: false,
      tax_totals: lTax > 0 ? [{ tax_id: 1, tax_amount: lTax.toFixed(2), taxable_amount: lBase.toFixed(2), percent: String(rate) }] : [],
      description: l.description || `Item ${i + 1}`,
      notes: "",
      code: l.productCode || String(i + 1),
      type_item_identification_id: 4,
      price_amount: lBase.toFixed(2),
      base_quantity: String(l.quantity || 1)
    };
  });

  return {
    number,
    type_document_id: 1, // 1 = factura de venta
    date: sale?.saleDate || invoice.issuedAt?.toISOString?.().slice(0, 10),
    time: sale?.saleTime || "12:00:00",
    resolution_number: config?.resolution || undefined,
    prefix: config?.prefix || undefined,
    notes: "",
    head_note: "",
    foot_note: "",
    establishment_name: config?.companyName || undefined,
    customer: customerFromClient(client),
    payment_form: {
      payment_form_id: 1, // 1 contado, 2 credito
      payment_method_id: 10,
      payment_due_date: sale?.saleDate || undefined,
      duration_measure: "0"
    },
    legal_monetary_totals: {
      line_extension_amount: base.toFixed(2),
      tax_exclusive_amount: base.toFixed(2),
      tax_inclusive_amount: total.toFixed(2),
      payable_amount: total.toFixed(2)
    },
    tax_totals: iva > 0 ? [{ tax_id: 1, tax_amount: iva.toFixed(2), percent: "19", taxable_amount: base.toFixed(2) }] : [],
    invoice_lines
  };
}

// Envia la factura a apidian. Devuelve { ok, cufe, sendStatus, dianIsValid, trackId, messages, raw }.
export async function sendInvoiceToApidian({ invoice, sale, lines, client, config }) {
  if (!config?.active) throw Object.assign(new Error("La API DIAN no esta activa. Configurala primero."), { status: 400 });
  if (!config.apidianUrl || !config.apidianToken) throw Object.assign(new Error("Falta apidianUrl o apidianToken en la configuracion DIAN."), { status: 400 });

  const payload = buildApidianPayload({ invoice, sale, lines, client, config });
  let url = config.apidianUrl.replace(/\/$/, "") + "/invoice";
  if (Number(config.environment) === 2 && config.testSetId) url += `/${config.testSetId}`;

  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json", Authorization: `Bearer ${config.apidianToken}` },
    body: JSON.stringify(payload)
  });
  const raw = await resp.text();
  let j = {};
  try { j = JSON.parse(raw); } catch { /* respuesta no-JSON */ }

  // apidian devuelve cufe/cude, ResponseDian con IsValid y mensajes.
  const cufe = j.cufe || j.cude || null;
  const respDian = j.ResponseDian?.Envelope?.Body?.SendBillSyncResponse?.SendBillSyncResult || j.ResponseDian || {};
  const isValid = respDian?.IsValid === "true" || respDian?.IsValid === true || j.is_valid === true || null;
  const statusMessage = respDian?.StatusMessage || respDian?.ErrorMessage?.string || j.message || (resp.ok ? "" : `HTTP ${resp.status}`);
  const trackId = j.urlinvoicexml || respDian?.XmlDocumentKey || j.zip_key || null;

  let sendStatus = "ENVIADA";
  if (isValid === true) sendStatus = "ACEPTADA";
  else if (isValid === false) sendStatus = "RECHAZADA";
  else if (!resp.ok) sendStatus = "RECHAZADA";

  return {
    ok: resp.ok,
    cufe,
    sendStatus,
    dianIsValid: isValid,
    trackId,
    qrUrl: j.QRStr || j.qr || null,
    messages: typeof statusMessage === "object" ? JSON.stringify(statusMessage) : String(statusMessage || ""),
    raw
  };
}
