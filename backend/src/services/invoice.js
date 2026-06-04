// Emision de factura "local" (sin DIAN real todavia).
// Asigna numero secuencial y arma el documento con el IVA discriminado.
// La integracion real con un proveedor DIAN (CUFE, envio, notas) es fase aparte.

const PREFIX = "PCDA";

/// Siguiente numero de factura segun cuantas ya estan emitidas.
export async function nextInvoiceNumber(prisma) {
  const count = await prisma.sale.count({ where: { dianStatus: "facturada" } });
  return `${PREFIX}-${String(count + 1).padStart(4, "0")}`;
}

/// Discrimina el IVA a partir de las lineas (precios IVA-incluido).
export function discriminateTax(lines = []) {
  let base = 0;
  let iva = 0;
  const byRate = {};
  for (const l of lines) {
    base += Number(l.base) || 0;
    iva += Number(l.tax) || 0;
    const rate = Number(l.taxRate) || 0;
    byRate[rate] = byRate[rate] || { base: 0, tax: 0 };
    byRate[rate].base += Number(l.base) || 0;
    byRate[rate].tax += Number(l.tax) || 0;
  }
  return { base, iva, total: base + iva, byRate };
}

/// Arma el documento de factura a partir de la venta y sus lineas.
export function buildInvoiceDoc(sale, lines, invoiceNumber) {
  const tax = discriminateTax(lines);
  return {
    invoiceNumber,
    dianStatus: "facturada",
    issuedAt: new Date().toISOString(),
    client: { doc: sale.clientDoc, name: sale.clientName },
    vehicle: { plate: sale.plate, modelYear: sale.modelYear },
    lines: lines.map((l) => ({
      code: l.productCode,
      description: l.description,
      quantity: l.quantity,
      unitPrice: l.unitPrice,
      taxRate: l.taxRate,
      base: l.base,
      tax: l.tax,
      total: l.total
    })),
    totals: tax
  };
}
