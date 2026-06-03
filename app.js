const currency = new Intl.NumberFormat("es-CO", {
  style: "currency",
  currency: "COP",
  maximumFractionDigits: 0
});

const products = [
  { code: "5", name: "SERVICIO MOTOCICLETAS", price: 187053, tax: 19 },
  { code: "8", name: "RUNT MOTOCICLETAS", price: 5600, tax: 0 },
  { code: "9", name: "SICOV MOTOCICLETAS", price: 35492, tax: 19 },
  { code: "29", name: "RECAUDO MOTOCICLETAS", price: 10345, tax: 19 },
  { code: "1", name: "ANSV MOTOCICLETAS 2009-ANTES", price: 8800, tax: 0 },
  { code: "2", name: "ANSV MOTOCICLETAS 2010-2018", price: 9100, tax: 0 },
  { code: "3", name: "ANSV MOTOCICLETAS 2019-2023", price: 8800, tax: 0 },
  { code: "4", name: "ANSV MOTOCICLETAS 2024-2026", price: 8500, tax: 0 }
];

const bundleMap = {
  "MOTOCICLETAS 2009-ANTES": ["5", "8", "9", "29", "1"],
  "MOTOCICLETAS 2010-2018": ["5", "8", "9", "29", "2"],
  "MOTOCICLETAS 2019-2023": ["5", "8", "9", "29", "3"],
  "MOTOCICLETAS 2024-2026": ["5", "8", "9", "29", "4"]
};

const store = {
  get clients() {
    return JSON.parse(localStorage.getItem("motopos.clients") || "[]");
  },
  set clients(value) {
    localStorage.setItem("motopos.clients", JSON.stringify(value));
  },
  get invoices() {
    return JSON.parse(localStorage.getItem("motopos.invoices") || "[]");
  },
  set invoices(value) {
    localStorage.setItem("motopos.invoices", JSON.stringify(value));
  }
};

const state = {
  lines: [],
  selectedBundle: "MOTOCICLETAS 2024-2026"
};

const els = {};

function $(id) {
  return document.getElementById(id);
}

function money(value) {
  return currency.format(Math.round(Number(value) || 0));
}

function receiptMoney(value) {
  return new Intl.NumberFormat("es-CO", { maximumFractionDigits: 0 }).format(Math.round(Number(value) || 0));
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function compactInvoiceId(id) {
  return String(id || "").replace("-", "");
}

function normalizePlate(value) {
  return String(value || "").trim().toUpperCase().replace(/\s+/g, "");
}

function todayIso(offsetDays = 0) {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  return date.toISOString().slice(0, 10);
}

function seedData() {
  if (!store.clients.length) {
    store.clients = [
      {
        doc: "222222222222",
        name: "Consumidor final",
        plate: "",
        range: "MOTOCICLETAS 2024-2026",
        phone: "",
        email: "",
        address: "",
        status: "ACTIVO"
      },
      {
        doc: "10101010",
        name: "Carlos Ramirez",
        plate: "ABC123",
        range: "MOTOCICLETAS 2019-2023",
        phone: "3001234567",
        email: "carlos@correo.com",
        address: "Girardot",
        status: "ACTIVO"
      }
    ];
  }
}

function boot() {
  [
    "invoiceNumber",
    "clientDoc",
    "clientName",
    "vehiclePlate",
    "vehicleRange",
    "clientPhone",
    "clientEmail",
    "invoiceDate",
    "renewalDate",
    "serviceLine",
    "paymentMethod",
    "productCode",
    "productName",
    "productQty",
    "productTax",
    "productPrice",
    "cartBody",
    "cartTotalTop",
    "grossTotal",
    "taxTotal",
    "grandTotal",
    "finalTotal",
    "cashPaid",
    "cardPaid",
    "otherPaid",
    "paidTotal",
    "changeDue",
    "notes",
    "clientsBody",
    "invoicesBody",
    "analysisSearch",
    "kpiInvoices",
    "kpiRevenue",
    "kpiVehicles",
    "rangeBars",
    "analysisBody",
    "recurringDialog",
    "bundleList",
    "bundleProductsBody",
    "bundleTotal",
    "clientDialog",
    "modalIdType",
    "modalPersonType",
    "modalDoc",
    "modalName",
    "modalPlate",
    "modalRange",
    "modalAddress",
    "modalEmail",
    "modalPhone",
    "modalStatus",
    "receiptDialog",
    "receiptContent"
  ].forEach((id) => {
    els[id] = $(id);
  });

  seedData();
  els.invoiceDate.value = todayIso();
  els.renewalDate.value = todayIso(365);
  bindEvents();
  renderDatalists();
  renderInvoiceNumber();
  loadClientFromDoc();
  renderCart();
  renderClients();
  renderInvoices();
  renderAnalysis();
  renderBundleList();
}

function bindEvents() {
  document.querySelectorAll(".nav-item").forEach((button) => {
    button.addEventListener("click", () => switchView(button.dataset.view));
  });

  $("newInvoiceBtn").addEventListener("click", resetInvoice);
  $("findClientBtn").addEventListener("click", loadClientFromDoc);
  $("openClientBtn").addEventListener("click", openClientDialog);
  $("newClientFromListBtn").addEventListener("click", openClientDialog);
  $("openRecurringBtn").addEventListener("click", () => els.recurringDialog.showModal());
  $("addBundleBtn").addEventListener("click", (event) => {
    event.preventDefault();
    addBundleToCart(state.selectedBundle);
    els.recurringDialog.close();
  });
  $("addLineBtn").addEventListener("click", addManualLine);
  $("clearBtn").addEventListener("click", resetInvoice);
  $("finalizeBtn").addEventListener("click", finalizeInvoice);
  $("saveClientBtn").addEventListener("click", saveClientFromDialog);
  $("printBtn").addEventListener("click", (event) => {
    event.preventDefault();
    window.print();
  });
  $("exportBtn").addEventListener("click", exportInvoicesCsv);
  $("quickProductBtn").addEventListener("click", () => els.productCode.focus());
  $("openProductsBtn").addEventListener("click", fillFirstProduct);

  els.clientDoc.addEventListener("change", loadClientFromDoc);
  els.vehicleRange.addEventListener("change", () => {
    state.selectedBundle = els.vehicleRange.value;
    renderBundleList();
  });
  els.productCode.addEventListener("change", fillProductFromCode);
  [els.cashPaid, els.cardPaid, els.otherPaid].forEach((input) => input.addEventListener("input", renderTotals));
  els.analysisSearch.addEventListener("input", renderAnalysis);
}

function switchView(view) {
  document.querySelectorAll(".nav-item").forEach((button) => {
    button.classList.toggle("active", button.dataset.view === view);
  });
  document.querySelectorAll(".view").forEach((section) => {
    section.classList.toggle("active", section.id === `view-${view}`);
  });
  if (view === "clientes") renderClients();
  if (view === "facturas") renderInvoices();
  if (view === "analisis") renderAnalysis();
}

function renderDatalists() {
  $("clientDocs").innerHTML = store.clients
    .map((client) => `<option value="${client.doc}">${client.name}</option>`)
    .join("");
  $("productCodes").innerHTML = products
    .map((product) => `<option value="${product.code}">${product.name}</option>`)
    .join("");
}

function nextInvoiceNumber() {
  return `PCDA-${String(store.invoices.length + 1).padStart(4, "0")}`;
}

function renderInvoiceNumber() {
  els.invoiceNumber.textContent = nextInvoiceNumber();
}

function loadClientFromDoc() {
  const client = store.clients.find((item) => item.doc === els.clientDoc.value.trim());
  if (!client) return;
  els.clientName.value = client.name;
  els.vehiclePlate.value = client.plate || "";
  els.vehicleRange.value = client.range || "MOTOCICLETAS 2024-2026";
  els.clientPhone.value = client.phone || "";
  els.clientEmail.value = client.email || "";
  state.selectedBundle = els.vehicleRange.value;
  renderBundleList();
}

function currentClientPayload() {
  return {
    doc: els.clientDoc.value.trim() || "222222222222",
    name: els.clientName.value.trim() || "Consumidor final",
    plate: normalizePlate(els.vehiclePlate.value),
    range: els.vehicleRange.value,
    phone: els.clientPhone.value.trim(),
    email: els.clientEmail.value.trim(),
    address: "",
    status: "ACTIVO"
  };
}

function upsertClient(client) {
  const clients = store.clients;
  const index = clients.findIndex((item) => item.doc === client.doc);
  if (index >= 0) {
    clients[index] = { ...clients[index], ...client };
  } else {
    clients.push(client);
  }
  store.clients = clients;
  renderDatalists();
  renderClients();
}

function fillProductFromCode() {
  const product = products.find((item) => item.code === els.productCode.value.trim());
  if (!product) return;
  els.productName.value = product.name;
  els.productTax.value = String(product.tax);
  els.productPrice.value = product.price;
}

function fillFirstProduct() {
  els.productCode.value = products[0].code;
  fillProductFromCode();
}

function addManualLine() {
  const qty = Number(els.productQty.value) || 1;
  const price = Number(els.productPrice.value) || 0;
  const tax = Number(els.productTax.value) || 0;
  const name = els.productName.value.trim();
  if (!name || price <= 0) return;
  state.lines.push({
    code: els.productCode.value.trim() || "-",
    name,
    qty,
    price,
    tax
  });
  clearProductEntry();
  renderCart();
}

function addBundleToCart(range) {
  const codes = bundleMap[range] || [];
  codes.forEach((code) => {
    const product = products.find((item) => item.code === code);
    if (!product) return;
    state.lines.push({
      code: product.code,
      name: product.name,
      qty: 1,
      price: product.price,
      tax: product.tax
    });
  });
  renderCart();
}

function clearProductEntry() {
  els.productCode.value = "";
  els.productName.value = "";
  els.productQty.value = 1;
  els.productTax.value = "19";
  els.productPrice.value = "";
}

function lineNet(line) {
  return line.qty * line.price;
}

function lineTax(line) {
  return lineNet(line) * (line.tax / (100 + line.tax || 1));
}

function totals() {
  const total = state.lines.reduce((sum, line) => sum + lineNet(line), 0);
  const tax = state.lines.reduce((sum, line) => sum + lineTax(line), 0);
  return {
    gross: total - tax,
    tax,
    total
  };
}

function renderCart() {
  if (!state.lines.length) {
    els.cartBody.innerHTML = `<tr><td class="empty-row" colspan="8">No hay productos registrados</td></tr>`;
  } else {
    els.cartBody.innerHTML = state.lines
      .map(
        (line, index) => `
          <tr>
            <td>${line.code}</td>
            <td>${line.name}</td>
            <td class="number">${line.qty}</td>
            <td class="number">${line.tax}%</td>
            <td class="number">${money(line.price)}</td>
            <td class="number">${money(lineNet(line))}</td>
            <td><button class="link-button" data-remove="${index}">Quitar</button></td>
          </tr>
        `
      )
      .join("");
  }

  els.cartBody.querySelectorAll("[data-remove]").forEach((button) => {
    button.addEventListener("click", () => {
      state.lines.splice(Number(button.dataset.remove), 1);
      renderCart();
    });
  });

  renderTotals();
}

function renderTotals() {
  const result = totals();
  const paid = Number(els.cashPaid.value || 0) + Number(els.cardPaid.value || 0) + Number(els.otherPaid.value || 0);
  els.cartTotalTop.textContent = money(result.total);
  els.grossTotal.textContent = money(result.gross);
  els.taxTotal.textContent = money(result.tax);
  els.grandTotal.textContent = money(result.total);
  els.finalTotal.textContent = money(result.total);
  els.paidTotal.textContent = money(paid);
  els.changeDue.textContent = money(Math.max(0, paid - result.total));
}

function renderBundleList() {
  const ranges = Object.keys(bundleMap);
  els.bundleList.innerHTML = ranges
    .map(
      (range) => `<button class="bundle-option ${range === state.selectedBundle ? "active" : ""}" data-range="${range}">${range}</button>`
    )
    .join("");
  els.bundleList.querySelectorAll("[data-range]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.preventDefault();
      state.selectedBundle = button.dataset.range;
      els.vehicleRange.value = state.selectedBundle;
      renderBundleList();
    });
  });
  renderBundleProducts();
}

function renderBundleProducts() {
  const items = (bundleMap[state.selectedBundle] || [])
    .map((code) => products.find((product) => product.code === code))
    .filter(Boolean);
  els.bundleProductsBody.innerHTML = items
    .map(
      (product) => `
        <tr>
          <td>${product.name}</td>
          <td class="number">1</td>
          <td class="number">${money(product.price)}</td>
        </tr>
      `
    )
    .join("");
  els.bundleTotal.textContent = money(items.reduce((sum, product) => sum + product.price, 0));
}

function openClientDialog() {
  const client = currentClientPayload();
  els.modalDoc.value = client.doc;
  els.modalName.value = client.name;
  els.modalPlate.value = client.plate;
  els.modalRange.value = client.range;
  els.modalEmail.value = client.email;
  els.modalPhone.value = client.phone;
  els.modalAddress.value = client.address;
  els.modalStatus.value = client.status;
  els.clientDialog.showModal();
}

function saveClientFromDialog(event) {
  event.preventDefault();
  const client = {
    doc: els.modalDoc.value.trim(),
    name: els.modalName.value.trim(),
    plate: normalizePlate(els.modalPlate.value),
    range: els.modalRange.value,
    address: els.modalAddress.value.trim(),
    email: els.modalEmail.value.trim(),
    phone: els.modalPhone.value.trim(),
    status: els.modalStatus.value
  };
  if (!client.doc || !client.name) return;
  upsertClient(client);
  els.clientDoc.value = client.doc;
  loadClientFromDoc();
  els.clientDialog.close();
}

function finalizeInvoice() {
  if (!state.lines.length) return;
  const client = currentClientPayload();
  upsertClient(client);
  const result = totals();
  const generatedAt = new Date();
  const invoice = {
    id: nextInvoiceNumber(),
    date: els.invoiceDate.value,
    time: generatedAt.toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }),
    renewalDate: els.renewalDate.value,
    client,
    serviceLine: els.serviceLine.value,
    paymentMethod: els.paymentMethod.value,
    notes: els.notes.value.trim(),
    lines: state.lines.map((line) => ({ ...line })),
    totals: result,
    dianStatus: "Enviada",
    cufe: `CUFE-${Date.now().toString(36).toUpperCase()}`
  };
  store.invoices = [invoice, ...store.invoices];
  showReceipt(invoice);
  resetInvoice();
  renderInvoices();
  renderAnalysis();
}

function showReceipt(invoice) {
  const totalPaid = Number(els.cashPaid.value || 0) + Number(els.cardPaid.value || 0) + Number(els.otherPaid.value || 0);
  const taxRows = buildTaxSummary(invoice.lines);
  const ticketId = compactInvoiceId(invoice.id);
  const qrSeed = `${ticketId}|${invoice.client.doc}|${invoice.client.plate}|${Math.round(invoice.totals.total)}`;

  els.receiptContent.innerHTML = `
    <article class="ticket">
      <header class="ticket-header">
        <strong>CENTRO DE DIAGNOSTICO<br>AUTOMOTOR CERTIMOTOSGIR<br>S.A.S.</strong>
        <span>900814092 - 6</span>
        <span>CR 7 A 29 10 BRR LA MAGDALENA</span>
        <span>Tel: 3166341293</span>
        <span>Girardot - Cundinamarca</span>
      </header>

      <div class="ticket-rule"></div>
      <div class="ticket-meta">
        <span>Fecha:</span><strong>${escapeHtml(invoice.date)}</strong>
        <span>Hora:</span><strong>${escapeHtml(invoice.time)}</strong>
        <span>Fact:</span><strong>${escapeHtml(ticketId)}</strong>
        <span>Cliente:</span><strong>${escapeHtml(invoice.client.name)}</strong>
        <span>Nit/CC:</span><strong>${escapeHtml(invoice.client.doc)}</strong>
        <span>Placa:</span><strong>${escapeHtml(invoice.client.plate || "SIN PLACA")}</strong>
      </div>

      <div class="ticket-rule"></div>
      <table class="ticket-items">
        <thead>
          <tr>
            <th>Cant</th>
            <th>Descripcion</th>
            <th>Vr Total</th>
          </tr>
        </thead>
        <tbody>
          ${invoice.lines
            .map(
              (line) => `
                <tr>
                  <td>${line.qty}</td>
                  <td>${escapeHtml(line.name)}</td>
                  <td>${receiptMoney(lineNet(line))}${line.tax ? " B" : " A"}</td>
                </tr>
              `
            )
            .join("")}
        </tbody>
      </table>

      <div class="ticket-rule"></div>
      <div class="ticket-totals">
        <span>Base:</span><strong>${receiptMoney(invoice.totals.gross)}</strong>
        <span>Impuesto:</span><strong>${receiptMoney(invoice.totals.tax)}</strong>
        <span>Total:</span><strong>${receiptMoney(invoice.totals.total)}</strong>
        <span>Efectivo:</span><strong>${receiptMoney(Number(els.cashPaid.value || 0))}</strong>
        <span>Tarjeta:</span><strong>${receiptMoney(Number(els.cardPaid.value || 0))}</strong>
        <span>Otros:</span><strong>${receiptMoney(Number(els.otherPaid.value || 0))}</strong>
        <span>Recibido:</span><strong>${receiptMoney(totalPaid)}</strong>
        <span>Cambio:</span><strong>${receiptMoney(Math.max(0, totalPaid - invoice.totals.total))}</strong>
      </div>

      <div class="ticket-rule strong"></div>
      <h3>RESUMEN IVA</h3>
      <table class="ticket-tax">
        <thead>
          <tr>
            <th>Tipo</th>
            <th>Compra</th>
            <th>Base/Imp</th>
            <th>IVA</th>
          </tr>
        </thead>
        <tbody>
          ${taxRows
            .map(
              (row) => `
                <tr>
                  <td>${row.label}</td>
                  <td>${receiptMoney(row.total)}</td>
                  <td>${receiptMoney(row.base)}</td>
                  <td>${receiptMoney(row.tax)}</td>
                </tr>
              `
            )
            .join("")}
        </tbody>
      </table>

      <div class="ticket-rule"></div>
      <div class="ticket-resolution">
        <strong>RESOLUCION</strong>
        <span>18764071400376 DEL 2024-05-27</span>
        <span>DESDE 1 HASTA 10000</span>
      </div>
      <div class="ticket-rule"></div>
      <strong class="ticket-pos">POS - Factura No. ${escapeHtml(ticketId)}</strong>
      <div class="ticket-qr" aria-label="QR DIAN simulado">${buildQrPattern(qrSeed)}</div>
      <small class="ticket-foot">CUFE: ${escapeHtml(invoice.cufe)}</small>
      <small class="ticket-foot">Rango moto: ${escapeHtml(invoice.client.range)}</small>
    </article>
  `;
  els.receiptDialog.showModal();
}

function buildTaxSummary(lines) {
  const grouped = lines.reduce((acc, line) => {
    const key = String(line.tax);
    const total = lineNet(line);
    const tax = lineTax(line);
    if (!acc[key]) {
      acc[key] = { rate: line.tax, total: 0, base: 0, tax: 0 };
    }
    acc[key].total += total;
    acc[key].tax += tax;
    acc[key].base += total - tax;
    return acc;
  }, {});

  return Object.values(grouped)
    .sort((a, b) => a.rate - b.rate)
    .map((row) => ({
      ...row,
      label: row.rate ? `B = ${row.rate}%` : "A = 0%"
    }));
}

function buildQrPattern(seed) {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }

  const cells = [];
  for (let i = 0; i < 625; i += 1) {
    hash ^= hash << 13;
    hash ^= hash >>> 17;
    hash ^= hash << 5;
    cells.push(`<span class="${hash & 1 ? "on" : ""}"></span>`);
  }
  return cells.join("");
}

function resetInvoice() {
  state.lines = [];
  els.invoiceDate.value = todayIso();
  els.renewalDate.value = todayIso(365);
  els.cashPaid.value = 0;
  els.cardPaid.value = 0;
  els.otherPaid.value = 0;
  els.notes.value = "";
  renderInvoiceNumber();
  renderCart();
}

function renderClients() {
  els.clientsBody.innerHTML = store.clients
    .map(
      (client) => `
        <tr>
          <td>${client.doc}</td>
          <td>${client.name}</td>
          <td>${client.plate || "-"}</td>
          <td>${client.range || "-"}</td>
          <td>${client.phone || "-"}</td>
          <td>${client.email || "-"}</td>
        </tr>
      `
    )
    .join("");
}

function renderInvoices() {
  const rows = store.invoices.map(
    (invoice) => `
      <tr>
        <td>${invoice.id}</td>
        <td>${invoice.date}</td>
        <td>${invoice.client.name}</td>
        <td>${invoice.client.plate || "-"}</td>
        <td>${invoice.dianStatus}</td>
        <td class="number">${money(invoice.totals.total)}</td>
      </tr>
    `
  );
  els.invoicesBody.innerHTML = rows.length ? rows.join("") : `<tr><td class="empty-row" colspan="6">Sin facturas emitidas</td></tr>`;
}

function renderAnalysis() {
  const term = els.analysisSearch.value.trim().toUpperCase();
  const invoices = store.invoices.filter((invoice) => {
    const haystack = `${invoice.client.name} ${invoice.client.doc} ${invoice.client.plate}`.toUpperCase();
    return !term || haystack.includes(term);
  });
  const revenue = invoices.reduce((sum, invoice) => sum + invoice.totals.total, 0);
  const plates = new Set(invoices.map((invoice) => invoice.client.plate).filter(Boolean));
  els.kpiInvoices.textContent = invoices.length;
  els.kpiRevenue.textContent = money(revenue);
  els.kpiVehicles.textContent = plates.size;

  const byRange = invoices.reduce((acc, invoice) => {
    const range = invoice.client.range || "SIN RANGO";
    acc[range] = (acc[range] || 0) + invoice.totals.total;
    return acc;
  }, {});
  const maxValue = Math.max(...Object.values(byRange), 1);
  els.rangeBars.innerHTML = Object.entries(byRange)
    .map(
      ([range, value]) => `
        <div class="bar-row">
          <div class="amount-row"><span>${range}</span><strong>${money(value)}</strong></div>
          <div class="bar-track"><div class="bar-fill" style="width:${Math.max(8, (value / maxValue) * 100)}%"></div></div>
        </div>
      `
    )
    .join("");

  els.analysisBody.innerHTML = invoices.length
    ? invoices
        .map(
          (invoice) => `
            <tr>
              <td>${invoice.date}</td>
              <td>${invoice.client.plate || "-"}</td>
              <td>${invoice.client.range}</td>
              <td class="number">${money(invoice.totals.total)}</td>
            </tr>
          `
        )
        .join("")
    : `<tr><td class="empty-row" colspan="4">Sin datos para analizar</td></tr>`;
}

function exportInvoicesCsv() {
  const rows = [
    ["factura", "fecha", "cliente", "documento", "placa", "rango", "estado_dian", "total"],
    ...store.invoices.map((invoice) => [
      invoice.id,
      invoice.date,
      invoice.client.name,
      invoice.client.doc,
      invoice.client.plate,
      invoice.client.range,
      invoice.dianStatus,
      Math.round(invoice.totals.total)
    ])
  ];
  const csv = rows.map((row) => row.map((cell) => `"${String(cell || "").replace(/"/g, '""')}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "facturas-motopos.csv";
  link.click();
  URL.revokeObjectURL(url);
}

document.addEventListener("DOMContentLoaded", boot);
