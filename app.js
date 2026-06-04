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

const paymentMethods = [
  { id: "EFECTIVO", label: "Efectivo", group: "CM", input: "payCash" },
  { id: "DATAFONO SG", label: "Datafono Supergiros", group: "SG", input: "payDatafonoSg" },
  { id: "QR SG", label: "QR Supergiros", group: "SG", input: "payQrSg" },
  { id: "QR CM", label: "QR empresarial", group: "CM", input: "payQrCm" },
  { id: "DATAFONO CM", label: "Datafono Certimotos", group: "CM", input: "payDatafonoCm" },
  { id: "TRANSFERENCIA DIRECTA", label: "Transferencia directa", group: "CM", input: "payTransfer" },
  { id: "ADDI", label: "ADDI", group: "CREDITO", input: "payAddi", credit: true },
  { id: "ALIADOS DE INV. GORA SAS", label: "GORA", group: "CREDITO", input: "payGora", credit: true },
  { id: "CREDITO PROPIO", label: "Credito propio", group: "CREDITO", input: "payCredito", credit: true }
];

const defaultAllies = [
  { name: "USUARIO", phone: "", company: "DIRECTO", paymentMethod: "", account: "", enrolled: true, notes: "Usuario directo / fidelizado" },
  { name: "NANCY CERTIMOTOS", phone: "", company: "CONVENIO", paymentMethod: "NEQUI", account: "", enrolled: true, notes: "Aliado ejemplo del cierre" },
  { name: "ALIADOS DE INV. GORA SAS", phone: "", company: "FINANCIACION", paymentMethod: "CUENTA", account: "", enrolled: true, notes: "Cartera GORA" },
  { name: "ALDEMAR CASTRO", phone: "3102533439", company: "DRIVERCAR", paymentMethod: "NEQUI", account: "3102533439", enrolled: true, notes: "Convenio inscrito" },
  { name: "ANDERSON - DONCEL", phone: "3145223461", company: "CONVENIO", paymentMethod: "NEQUI", account: "3145223461", enrolled: true, notes: "Referido frecuente" },
  { name: "ANDRES PARRA", phone: "3228890812", company: "PARQUEADERO", paymentMethod: "NEQUI", account: "3228890812", enrolled: false, notes: "Aliado por parqueadero" },
  { name: "DANIEL GOMEZ", phone: "3028418666", company: "CONVENIO", paymentMethod: "NEQUI", account: "3028418666", enrolled: true, notes: "Mensaje WhatsApp" }
];

const storageKeys = {
  clients: "motopos.clients",
  invoices: "motopos.invoices",
  allies: "motopos.allies"
};

const state = {
  lines: [],
  selectedBundle: "MOTOCICLETAS 2024-2026"
};

const els = {};

function $(id) {
  return document.getElementById(id);
}

function readJson(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key) || JSON.stringify(fallback));
  } catch {
    return fallback;
  }
}

function writeJson(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

const store = {
  get clients() {
    return readJson(storageKeys.clients, []);
  },
  set clients(value) {
    writeJson(storageKeys.clients, value);
  },
  get invoices() {
    return readJson(storageKeys.invoices, []);
  },
  set invoices(value) {
    writeJson(storageKeys.invoices, value);
  },
  get allies() {
    return readJson(storageKeys.allies, []);
  },
  set allies(value) {
    writeJson(storageKeys.allies, value);
  }
};

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

function todayIso(offsetDays = 0) {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  return date.toISOString().slice(0, 10);
}

function normalizePlate(value) {
  return String(value || "").trim().toUpperCase().replace(/\s+/g, "");
}

function compactInvoiceId(id) {
  return String(id || "").replace("-", "");
}

function methodLabel(id) {
  return paymentMethods.find((method) => method.id === id)?.label || id || "-";
}

function methodById(id) {
  return paymentMethods.find((method) => method.id === id);
}

function rangeFromModel(model) {
  const year = Number(model) || 0;
  if (year >= 2024) return "MOTOCICLETAS 2024-2026";
  if (year >= 2019) return "MOTOCICLETAS 2019-2023";
  if (year >= 2010) return "MOTOCICLETAS 2010-2018";
  return "MOTOCICLETAS 2009-ANTES";
}

function modelFromRange(range) {
  if (range === "MOTOCICLETAS 2024-2026") return 2026;
  if (range === "MOTOCICLETAS 2019-2023") return 2023;
  if (range === "MOTOCICLETAS 2010-2018") return 2018;
  return 2009;
}

function ansvCost(model) {
  const year = Number(model) || 0;
  if (!year) return 0;
  if (year >= 2024) return 8500;
  if (year >= 2019) return 8800;
  if (year >= 2010) return 9100;
  return 8800;
}

function seedData() {
  if (!store.clients.length) {
    store.clients = [
      {
        doc: "222222222222",
        name: "Consumidor final",
        plate: "",
        model: 2026,
        range: "MOTOCICLETAS 2024-2026",
        phone: "",
        email: "",
        address: "",
        status: "ACTIVO"
      },
      {
        doc: "900975741",
        name: "INVERSIONES GORA SAS",
        plate: "",
        model: 2023,
        range: "MOTOCICLETAS 2019-2023",
        phone: "",
        email: "",
        address: "Girardot",
        status: "ACTIVO"
      }
    ];
  }

  if (!store.allies.length) {
    store.allies = defaultAllies;
  }
}

function boot() {
  [
    "invoiceNumber",
    "clientDoc",
    "clientName",
    "vehiclePlate",
    "vehicleModel",
    "vehicleRange",
    "clientPhone",
    "clientEmail",
    "clientAddress",
    "clientSummary",
    "invoiceDate",
    "renewalDate",
    "serviceLine",
    "dianStatus",
    "rtmAlreadyPaid",
    "saleOrigin",
    "referralName",
    "commissionValue",
    "creditProvider",
    "paymentMethod",
    "rtmToday",
    "pinNumber",
    "flowHint",
    "productSearch",
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
    "operatingCost",
    "estimatedMargin",
    "finalTotal",
    "paidTotal",
    "receivableTotal",
    "provisionTotal",
    "changeDue",
    "notes",
    "clientsBody",
    "invoicesBody",
    "analysisSearch",
    "kpiInvoices",
    "kpiRevenue",
    "kpiVehicles",
    "rangeBars",
    "methodBars",
    "analysisBody",
    "closingDate",
    "closingSales",
    "closingDone",
    "closingPending",
    "closingReceivable",
    "closingPaymentsBody",
    "closingSummary",
    "closingCostsBody",
    "closingDetailBody",
    "arPending",
    "arPaid",
    "arOpenCount",
    "receivablesBody",
    "allySearch",
    "allyName",
    "allyPhone",
    "allyCompany",
    "allyPayment",
    "allyAccount",
    "alliesBody",
    "productDialog",
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
    "modalModel",
    "modalRange",
    "modalAddress",
    "modalEmail",
    "modalPhone",
    "modalStatus",
    "receiptDialog",
    "receiptContent",
    ...paymentMethods.map((method) => method.input)
  ].forEach((id) => {
    els[id] = $(id);
  });

  seedData();
  renderPaymentOptions();
  els.invoiceDate.value = todayIso();
  els.closingDate.value = todayIso();
  els.renewalDate.value = todayIso(365);
  bindEvents();
  renderDatalists();
  renderInvoiceNumber();
  loadClientFromDoc();
  renderBundleList();
  renderCart();
  renderAllViews();
  renderFlowHint();
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
    fillSelectedPaymentIfEmpty();
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
  $("exportClosingBtn").addEventListener("click", exportClosingCsv);
  $("todayClosingBtn").addEventListener("click", () => {
    els.closingDate.value = todayIso();
    renderClosing();
  });
  $("quickProductBtn").addEventListener("click", quickAddProductFromSearch);
  $("openProductDialogBtn").addEventListener("click", openProductDialog);
  $("openProductsBtn").addEventListener("click", openProductDialog);
  $("addAllyBtn").addEventListener("click", addAlly);

  els.clientDoc.addEventListener("change", loadClientFromDoc);
  els.vehicleModel.addEventListener("input", syncRangeFromModel);
  els.vehicleRange.addEventListener("change", () => {
    state.selectedBundle = els.vehicleRange.value;
    if (!Number(els.vehicleModel.value)) els.vehicleModel.value = modelFromRange(els.vehicleRange.value);
    renderBundleList();
    renderTotals();
  });
  els.productCode.addEventListener("change", fillProductFromCode);
  els.productSearch.addEventListener("change", previewProductFromSearch);
  els.paymentMethod.addEventListener("change", () => {
    syncCreditFromMethod();
    fillSelectedPayment();
    renderTotals();
  });
  els.creditProvider.addEventListener("change", () => {
    syncCreditProvider();
    renderTotals();
  });
  els.saleOrigin.addEventListener("change", () => {
    syncReferralDefaults();
    renderTotals();
  });
  els.referralName.addEventListener("change", renderTotals);
  [els.clientName, els.vehiclePlate, els.vehicleModel, els.vehicleRange, els.clientPhone, els.clientEmail].forEach((input) => {
    input.addEventListener("input", renderClientSummary);
    input.addEventListener("change", renderClientSummary);
  });
  [
    els.rtmAlreadyPaid,
    els.rtmToday,
    els.pinNumber,
    els.dianStatus,
    els.commissionValue,
    els.closingDate,
    els.analysisSearch,
    els.allySearch
  ].forEach((input) => input.addEventListener("input", renderAllViews));
  paymentMethods.forEach((method) => {
    els[method.input].addEventListener("input", renderTotals);
  });
  els.receivablesBody.addEventListener("click", handleReceivableAction);
}

function switchView(view) {
  document.querySelectorAll(".nav-item").forEach((button) => {
    button.classList.toggle("active", button.dataset.view === view);
  });
  document.querySelectorAll(".view").forEach((section) => {
    section.classList.toggle("active", section.id === `view-${view}`);
  });
  renderAllViews();
}

function renderAllViews() {
  renderTotals();
  renderClients();
  renderInvoices();
  renderAnalysis();
  renderClosing();
  renderReceivables();
  renderAllies();
}

function renderPaymentOptions() {
  els.paymentMethod.innerHTML = paymentMethods
    .map((method) => `<option value="${method.id}">${method.label}</option>`)
    .join("");
}

function renderDatalists() {
  $("clientDocs").innerHTML = store.clients
    .map((client) => `<option value="${escapeHtml(client.doc)}">${escapeHtml(client.name)}</option>`)
    .join("");
  $("productCodes").innerHTML = products
    .map((product) => `<option value="${escapeHtml(product.code)}">${escapeHtml(product.name)}</option>`)
    .join("");
  $("alliesList").innerHTML = store.allies
    .map((ally) => `<option value="${escapeHtml(ally.name)}">${escapeHtml(ally.company || "")}</option>`)
    .join("");
}

function nextInvoiceNumber() {
  return `PCDA-${String(store.invoices.length + 1).padStart(4, "0")}`;
}

function renderInvoiceNumber() {
  els.invoiceNumber.textContent = nextInvoiceNumber();
}

function loadClientFromDoc() {
  const client = resolveClient(els.clientDoc.value);
  if (!client) {
    renderClientSummary();
    return;
  }
  els.clientDoc.value = client.doc;
  els.clientName.value = client.name || "";
  els.vehiclePlate.value = client.plate || "";
  els.vehicleModel.value = client.model || modelFromRange(client.range || "MOTOCICLETAS 2024-2026");
  els.vehicleRange.value = client.range || rangeFromModel(els.vehicleModel.value);
  els.clientPhone.value = client.phone || "";
  els.clientEmail.value = client.email || "";
  els.clientAddress.value = client.address || "";
  state.selectedBundle = els.vehicleRange.value;
  renderBundleList();
  renderTotals();
  renderClientSummary();
}

function resolveClient(value) {
  const term = String(value || "").trim().toUpperCase();
  if (!term) return null;
  return (
    store.clients.find((item) => String(item.doc || "").toUpperCase() === term) ||
    store.clients.find((item) => String(item.plate || "").toUpperCase() === term) ||
    store.clients.find((item) => String(item.name || "").toUpperCase().includes(term))
  );
}

function renderClientSummary() {
  if (!els.clientSummary) return;
  const client = currentClientPayload();
  const plate = client.plate || "sin placa";
  const phone = client.phone || "sin telefono";
  els.clientSummary.innerHTML = `
    <div>
      <strong>${escapeHtml(client.name)}</strong>
      <span>${escapeHtml(client.doc)} | ${escapeHtml(plate)} | ${escapeHtml(client.range)}</span>
      <small>${escapeHtml(phone)}</small>
    </div>
  `;
}

function currentClientPayload() {
  const model = Number(els.vehicleModel.value) || modelFromRange(els.vehicleRange.value);
  return {
    doc: els.clientDoc.value.trim() || "222222222222",
    name: els.clientName.value.trim() || "Consumidor final",
    plate: normalizePlate(els.vehiclePlate.value),
    model,
    range: els.vehicleRange.value || rangeFromModel(model),
    phone: els.clientPhone.value.trim(),
    email: els.clientEmail.value.trim(),
    address: els.clientAddress.value.trim(),
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
}

function syncRangeFromModel() {
  const range = rangeFromModel(els.vehicleModel.value);
  els.vehicleRange.value = range;
  state.selectedBundle = range;
  renderBundleList();
  renderTotals();
}

function syncReferralDefaults() {
  if (els.saleOrigin.value === "directo") {
    els.referralName.value = "USUARIO";
    els.commissionValue.value = 20000;
  } else {
    if (!els.referralName.value || els.referralName.value === "USUARIO") {
      els.referralName.value = "NANCY CERTIMOTOS";
    }
    els.commissionValue.value = 40000;
  }
}

function syncCreditProvider() {
  const provider = els.creditProvider.value;
  if (provider !== "no") {
    els.paymentMethod.value = provider;
    els.dianStatus.value = "enviada";
    fillSelectedPayment();
    return;
  }
  if (methodById(els.paymentMethod.value)?.credit) {
    els.paymentMethod.value = "EFECTIVO";
    fillSelectedPayment();
  }
}

function syncCreditFromMethod() {
  const method = methodById(els.paymentMethod.value);
  if (method?.credit) {
    els.creditProvider.value = method.id;
    els.dianStatus.value = "enviada";
  } else {
    els.creditProvider.value = "no";
  }
}

function fillProductFromCode() {
  const product = resolveProduct(els.productCode.value);
  if (!product) return;
  els.productName.value = product.name;
  els.productTax.value = String(product.tax);
  els.productPrice.value = product.price;
}

function fillFirstProduct() {
  els.productCode.value = products[0].code;
  fillProductFromCode();
}

function resolveProduct(value) {
  const term = String(value || "").trim().toUpperCase();
  if (!term) return null;
  return (
    products.find((item) => item.code.toUpperCase() === term) ||
    products.find((item) => item.name.toUpperCase() === term) ||
    products.find((item) => item.name.toUpperCase().includes(term))
  );
}

function previewProductFromSearch() {
  const product = resolveProduct(els.productSearch.value);
  if (product) els.productSearch.value = product.code;
}

function openProductDialog(event) {
  event?.preventDefault?.();
  const product = resolveProduct(els.productSearch.value) || resolveProduct(els.productCode.value);
  if (product) {
    els.productCode.value = product.code;
    fillProductFromCode();
  } else if (!els.productCode.value) {
    clearProductEntry();
  }
  els.productDialog.showModal();
}

function quickAddProductFromSearch(event) {
  event.preventDefault();
  const product = resolveProduct(els.productSearch.value);
  if (!product) {
    openProductDialog(event);
    return;
  }
  state.lines.push({
    code: product.code,
    name: product.name,
    qty: 1,
    price: product.price,
    tax: product.tax
  });
  els.productSearch.value = "";
  fillSelectedPaymentIfEmpty();
  renderCart();
}

function addManualLine(event) {
  event?.preventDefault?.();
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
  els.productSearch.value = "";
  if (els.productDialog.open) els.productDialog.close();
  fillSelectedPaymentIfEmpty();
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
  return Number(line.qty || 0) * Number(line.price || 0);
}

function lineTax(line) {
  const rate = Number(line.tax) || 0;
  return lineNet(line) * (rate / (100 + rate || 1));
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

function getPaymentBreakdown() {
  return Object.fromEntries(
    paymentMethods.map((method) => [method.id, Number(els[method.input].value || 0)])
  );
}

function totalPayments(payments = getPaymentBreakdown()) {
  return Object.values(payments).reduce((sum, value) => sum + Number(value || 0), 0);
}

function clearPaymentInputs() {
  paymentMethods.forEach((method) => {
    els[method.input].value = 0;
  });
}

function fillSelectedPayment() {
  const total = totals().total;
  clearPaymentInputs();
  const method = methodById(els.paymentMethod.value) || paymentMethods[0];
  els[method.input].value = Math.round(total);
}

function fillSelectedPaymentIfEmpty() {
  if (totalPayments() === 0 && totals().total > 0) {
    fillSelectedPayment();
  }
}

function transactionCostFor(methodId, amount) {
  const value = Number(amount) || 0;
  if (value <= 0) return 0;
  if (methodId === "DATAFONO SG") return value * 0.0079;
  if (methodId === "QR SG") return 1000;
  if (methodId === "CREDITO PROPIO") return 1000;
  if (methodId === "ADDI") return value * 0.09 * 1.19;
  if (methodId === "DATAFONO CM") return value * 0.04;
  return 0;
}

function transactionCostForPayments(payments) {
  return paymentMethods.reduce((sum, method) => sum + transactionCostFor(method.id, payments[method.id]), 0);
}

function currentFlowPayload(result = totals(), payments = getPaymentBreakdown()) {
  const creditProvider = els.creditProvider.value;
  const creditAmount = paymentMethods
    .filter((method) => method.credit)
    .reduce((sum, method) => sum + Number(payments[method.id] || 0), 0);
  const missingPayment = Math.max(0, result.total - totalPayments(payments));
  const receivableAmount = creditProvider !== "no" ? Math.max(creditAmount, result.total) : missingPayment;
  const rtmPending = els.rtmToday.value === "no" && els.rtmAlreadyPaid.value === "no";

  return {
    rtmAlreadyPaid: els.rtmAlreadyPaid.value,
    saleOrigin: els.saleOrigin.value,
    referralName: els.referralName.value.trim() || "USUARIO",
    commission: Number(els.commissionValue.value || 0),
    creditProvider,
    paymentMethod: els.paymentMethod.value,
    rtmToday: els.rtmToday.value,
    pinNumber: els.pinNumber.value.trim(),
    dianStatus: els.dianStatus.value,
    rtmStatus: els.rtmAlreadyPaid.value === "si" ? "Ya pagada" : els.rtmToday.value === "si" ? "Realizada hoy" : "Pendiente",
    receivableAmount,
    receivableProvider: receivableAmount > 0 ? (creditProvider !== "no" ? creditProvider : "SALDO PENDIENTE") : "",
    provisionAmount: rtmPending ? result.total : 0
  };
}

function buildCostBreakdown(flow, payments) {
  const model = Number(els.vehicleModel.value) || modelFromRange(els.vehicleRange.value);
  const hasPin = Boolean(flow.pinNumber) || flow.rtmToday === "si";
  const sicov = hasPin ? 29825 : 0;
  const ivaSicov = sicov * 0.19;
  const recaudo = hasPin ? 8693 : 0;
  const ivaRecaudo = recaudo * 0.19;
  const ansv = model ? ansvCost(model) : 0;
  const fupa = hasPin ? 5600 : 0;
  const ivaFact = flow.dianStatus === "enviada" ? 37185 : 0;
  const sustratos = hasPin ? 800 : 0;
  const transaction = transactionCostForPayments(payments);
  const total = sicov + ivaSicov + recaudo + ivaRecaudo + ansv + fupa + ivaFact + sustratos + transaction;

  return {
    sicov,
    ivaSicov,
    recaudo,
    ivaRecaudo,
    ansv,
    fupa,
    ivaFact,
    sustratos,
    transaction,
    total
  };
}

function currentSaleSnapshot() {
  const result = totals();
  const payments = getPaymentBreakdown();
  const flow = currentFlowPayload(result, payments);
  const costs = buildCostBreakdown(flow, payments);
  return { result, payments, flow, costs };
}

function renderCart() {
  if (!state.lines.length) {
    els.cartBody.innerHTML = `<tr><td class="empty-row" colspan="7">No hay productos registrados</td></tr>`;
  } else {
    els.cartBody.innerHTML = state.lines
      .map(
        (line, index) => `
          <tr>
            <td>${escapeHtml(line.code)}</td>
            <td>${escapeHtml(line.name)}</td>
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
  const { result, payments, flow, costs } = currentSaleSnapshot();
  const paid = totalPayments(payments);
  const margin = result.total - costs.total - flow.commission;

  els.cartTotalTop.textContent = money(result.total);
  els.grossTotal.textContent = money(result.gross);
  els.taxTotal.textContent = money(result.tax);
  els.grandTotal.textContent = money(result.total);
  els.operatingCost.textContent = money(costs.total + flow.commission);
  els.estimatedMargin.textContent = money(margin);
  els.finalTotal.textContent = money(result.total);
  els.paidTotal.textContent = money(paid);
  els.receivableTotal.textContent = money(flow.receivableAmount);
  els.provisionTotal.textContent = money(flow.provisionAmount);
  els.changeDue.textContent = money(Math.max(0, paid - result.total));
  renderFlowHint();
}

function renderFlowHint() {
  if (!els.flowHint) return;
  const { result, payments, flow } = currentSaleSnapshot();
  const parts = [
    flow.saleOrigin === "directo" ? "Directo" : `Referido: ${flow.referralName}`,
    flow.creditProvider === "no" ? methodLabel(flow.paymentMethod) : `Cartera ${methodLabel(flow.creditProvider)}`,
    flow.rtmStatus,
    flow.dianStatus === "enviada" ? "DIAN" : "Sin envio DIAN"
  ];
  if (flow.provisionAmount > 0) parts.push(`Provision ${money(flow.provisionAmount)}`);
  if (flow.receivableAmount > 0 && totalPayments(payments) < result.total) parts.push(`Saldo ${money(flow.receivableAmount)}`);
  els.flowHint.textContent = parts.join(" | ");
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
      els.vehicleModel.value = modelFromRange(state.selectedBundle);
      renderBundleList();
      renderTotals();
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
          <td>${escapeHtml(product.name)}</td>
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
  els.modalModel.value = client.model;
  els.modalRange.value = client.range;
  els.modalEmail.value = client.email;
  els.modalPhone.value = client.phone;
  els.modalAddress.value = client.address;
  els.modalStatus.value = client.status;
  els.clientDialog.showModal();
}

function saveClientFromDialog(event) {
  event.preventDefault();
  const model = Number(els.modalModel.value) || modelFromRange(els.modalRange.value);
  const client = {
    doc: els.modalDoc.value.trim(),
    name: els.modalName.value.trim(),
    plate: normalizePlate(els.modalPlate.value),
    model,
    range: els.modalRange.value || rangeFromModel(model),
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
  renderAllViews();
}

function finalizeInvoice() {
  if (!state.lines.length) return;
  const client = currentClientPayload();
  upsertClient(client);
  const { result, payments, flow, costs } = currentSaleSnapshot();
  const generatedAt = new Date();
  const invoice = {
    id: nextInvoiceNumber(),
    date: els.invoiceDate.value,
    time: generatedAt.toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }),
    renewalDate: els.renewalDate.value,
    client,
    serviceLine: els.serviceLine.value,
    paymentMethod: flow.paymentMethod,
    payments,
    flow,
    notes: els.notes.value.trim(),
    lines: state.lines.map((line) => ({ ...line })),
    totals: result,
    costs,
    dianStatus: flow.dianStatus === "enviada" ? "Enviada" : flow.dianStatus === "pendiente" ? "Pendiente" : "No enviada",
    cufe: `CUFE-${Date.now().toString(36).toUpperCase()}`,
    provision: flow.provisionAmount,
    receivable: {
      provider: flow.receivableProvider,
      amount: flow.receivableAmount,
      pending: flow.receivableAmount,
      status: flow.receivableAmount > 0 ? "pendiente" : "sin_cartera"
    },
    createdAt: generatedAt.toISOString()
  };
  store.invoices = [invoice, ...store.invoices];
  showReceipt(invoice);
  resetInvoice();
  renderAllViews();
}

function paymentReceiptBuckets(payments) {
  const cash = Number(payments.EFECTIVO || 0);
  const card = Number(payments["DATAFONO SG"] || 0) + Number(payments["DATAFONO CM"] || 0);
  const total = totalPayments(payments);
  return {
    cash,
    card,
    other: Math.max(0, total - cash - card),
    total
  };
}

function showReceipt(invoice) {
  const taxRows = buildTaxSummary(invoice.lines);
  const ticketId = compactInvoiceId(invoice.id);
  const receiptPayments = paymentReceiptBuckets(invoice.payments || {});
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
        <span>Efectivo:</span><strong>${receiptMoney(receiptPayments.cash)}</strong>
        <span>Tarjeta:</span><strong>${receiptMoney(receiptPayments.card)}</strong>
        <span>Otros:</span><strong>${receiptMoney(receiptPayments.other)}</strong>
        <span>Recibido:</span><strong>${receiptMoney(receiptPayments.total)}</strong>
        <span>Cambio:</span><strong>${receiptMoney(Math.max(0, receiptPayments.total - invoice.totals.total))}</strong>
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
      <small class="ticket-foot">RTM: ${escapeHtml(invoice.flow?.rtmStatus || "-")} | ${escapeHtml(methodLabel(invoice.paymentMethod))}</small>
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
  els.rtmAlreadyPaid.value = "no";
  els.saleOrigin.value = "directo";
  els.referralName.value = "USUARIO";
  els.commissionValue.value = 20000;
  els.creditProvider.value = "no";
  els.paymentMethod.value = "EFECTIVO";
  els.rtmToday.value = "si";
  els.pinNumber.value = "";
  els.dianStatus.value = "enviada";
  clearPaymentInputs();
  els.notes.value = "";
  clearProductEntry();
  els.productSearch.value = "";
  renderInvoiceNumber();
  renderClientSummary();
  renderCart();
  renderAllViews();
}

function renderClients() {
  els.clientsBody.innerHTML = store.clients.length
    ? store.clients
        .map(
          (client) => `
            <tr>
              <td>${escapeHtml(client.doc)}</td>
              <td>${escapeHtml(client.name)}</td>
              <td>${escapeHtml(client.plate || "-")}</td>
              <td>${escapeHtml(client.model || "-")}</td>
              <td>${escapeHtml(client.range || "-")}</td>
              <td>${escapeHtml(client.phone || "-")}</td>
              <td>${escapeHtml(client.email || "-")}</td>
            </tr>
          `
        )
        .join("")
    : `<tr><td class="empty-row" colspan="7">Sin clientes</td></tr>`;
}

function renderInvoices() {
  const rows = store.invoices.map(
    (invoice) => `
      <tr>
        <td>${escapeHtml(invoice.id)}</td>
        <td>${escapeHtml(invoice.date)}</td>
        <td>${escapeHtml(invoice.client?.name || "-")}</td>
        <td>${escapeHtml(invoice.client?.plate || "-")}</td>
        <td>${escapeHtml(methodLabel(invoice.paymentMethod))}</td>
        <td>${escapeHtml(invoice.flow?.rtmStatus || "-")}</td>
        <td>${escapeHtml(invoice.dianStatus || "-")}</td>
        <td class="number">${money(invoice.totals?.total || 0)}</td>
      </tr>
    `
  );
  els.invoicesBody.innerHTML = rows.length ? rows.join("") : `<tr><td class="empty-row" colspan="8">Sin facturas emitidas</td></tr>`;
}

function invoiceMatchesSearch(invoice, term) {
  const haystack = `${invoice.client?.name || ""} ${invoice.client?.doc || ""} ${invoice.client?.plate || ""} ${invoice.paymentMethod || ""}`.toUpperCase();
  return !term || haystack.includes(term);
}

function paymentSum(invoice, methodId) {
  if (invoice.payments) return Number(invoice.payments[methodId] || 0);
  return invoice.paymentMethod === methodId ? Number(invoice.totals?.total || 0) : 0;
}

function primaryMethod(invoice) {
  if (!invoice.payments) return invoice.paymentMethod || "-";
  const found = paymentMethods.find((method) => Number(invoice.payments[method.id] || 0) > 0);
  return found?.id || invoice.paymentMethod || "-";
}

function renderAnalysis() {
  const term = els.analysisSearch.value.trim().toUpperCase();
  const invoices = store.invoices.filter((invoice) => invoiceMatchesSearch(invoice, term));
  const revenue = invoices.reduce((sum, invoice) => sum + Number(invoice.totals?.total || 0), 0);
  const plates = new Set(invoices.map((invoice) => invoice.client?.plate).filter(Boolean));
  els.kpiInvoices.textContent = invoices.length;
  els.kpiRevenue.textContent = money(revenue);
  els.kpiVehicles.textContent = plates.size;

  renderBars(
    els.rangeBars,
    invoices.reduce((acc, invoice) => {
      const range = invoice.client?.range || "SIN RANGO";
      acc[range] = (acc[range] || 0) + Number(invoice.totals?.total || 0);
      return acc;
    }, {})
  );

  renderBars(
    els.methodBars,
    invoices.reduce((acc, invoice) => {
      const label = methodLabel(primaryMethod(invoice));
      acc[label] = (acc[label] || 0) + Number(invoice.totals?.total || 0);
      return acc;
    }, {})
  );

  els.analysisBody.innerHTML = invoices.length
    ? invoices
        .map(
          (invoice) => `
            <tr>
              <td>${escapeHtml(invoice.date)}</td>
              <td>${escapeHtml(invoice.client?.plate || "-")}</td>
              <td>${escapeHtml(invoice.client?.range || "-")}</td>
              <td>${escapeHtml(methodLabel(primaryMethod(invoice)))}</td>
              <td class="number">${money(invoice.totals?.total || 0)}</td>
            </tr>
          `
        )
        .join("")
    : `<tr><td class="empty-row" colspan="5">Sin datos para analizar</td></tr>`;
}

function renderBars(container, values) {
  const entries = Object.entries(values);
  const maxValue = Math.max(...entries.map(([, value]) => value), 1);
  container.innerHTML = entries.length
    ? entries
        .map(
          ([label, value]) => `
            <div class="bar-row">
              <div class="amount-row"><span>${escapeHtml(label)}</span><strong>${money(value)}</strong></div>
              <div class="bar-track"><div class="bar-fill" style="width:${Math.max(8, (value / maxValue) * 100)}%"></div></div>
            </div>
          `
        )
        .join("")
    : `<p class="muted">Sin datos todavia</p>`;
}

function summarizeClosing(date) {
  const invoices = store.invoices.filter((invoice) => invoice.date === date);
  const paymentTotals = Object.fromEntries(paymentMethods.map((method) => [method.id, 0]));
  invoices.forEach((invoice) => {
    paymentMethods.forEach((method) => {
      paymentTotals[method.id] += paymentSum(invoice, method.id);
    });
  });

  const total = invoices.reduce((sum, invoice) => sum + Number(invoice.totals?.total || 0), 0);
  const provision = invoices.reduce((sum, invoice) => sum + Number(invoice.provision || 0), 0);
  const receivable = invoices.reduce((sum, invoice) => {
    if (invoice.receivable?.status === "pagado") return sum;
    return sum + Number(invoice.receivable?.pending || 0);
  }, 0);
  const commissionDirect = invoices
    .filter((invoice) => (invoice.flow?.referralName || "").toUpperCase() === "USUARIO")
    .reduce((sum, invoice) => sum + Number(invoice.flow?.commission || 0), 0);
  const commissionRef = invoices
    .filter((invoice) => (invoice.flow?.referralName || "").toUpperCase() !== "USUARIO")
    .reduce((sum, invoice) => sum + Number(invoice.flow?.commission || 0), 0);
  const costs = invoices.reduce(
    (acc, invoice) => {
      const invoiceCosts = invoice.costs || {};
      Object.keys(acc).forEach((key) => {
        acc[key] += Number(invoiceCosts[key] || 0);
      });
      return acc;
    },
    { sicov: 0, ivaSicov: 0, recaudo: 0, ivaRecaudo: 0, ansv: 0, fupa: 0, ivaFact: 0, sustratos: 0, transaction: 0, total: 0 }
  );
  const sgSubtotal = paymentTotals["DATAFONO SG"] + paymentTotals["QR SG"];
  const companySubtotal = totalPayments(paymentTotals) - sgSubtotal;
  const cashDelivery = paymentTotals.EFECTIVO - commissionDirect - commissionRef;
  const jasper = companySubtotal - provision;

  return {
    invoices,
    paymentTotals,
    total,
    provision,
    receivable,
    commissionDirect,
    commissionRef,
    costs,
    sgSubtotal,
    companySubtotal,
    cashDelivery,
    jasper,
    rtmDone: invoices.filter((invoice) => invoice.flow?.rtmToday === "si").length,
    rtmPending: invoices.filter((invoice) => invoice.flow?.rtmToday === "no").length
  };
}

function renderClosing() {
  const summary = summarizeClosing(els.closingDate.value);
  els.closingSales.textContent = money(summary.total);
  els.closingDone.textContent = summary.rtmDone;
  els.closingPending.textContent = summary.rtmPending;
  els.closingReceivable.textContent = money(summary.receivable);

  els.closingPaymentsBody.innerHTML = paymentMethods
    .map(
      (method) => `
        <tr>
          <td>${escapeHtml(method.label)}</td>
          <td class="number">${money(summary.paymentTotals[method.id])}</td>
        </tr>
      `
    )
    .join("");

  const summaryRows = [
    ["Subtotal Supergiros", summary.sgSubtotal],
    ["Subtotal Certimotos", summary.companySubtotal],
    ["A provision", summary.provision],
    ["Jasper estimado", summary.jasper],
    ["Caja menor / efectivo neto", summary.cashDelivery],
    ["Cartera abierta", summary.receivable]
  ];
  els.closingSummary.innerHTML = summaryRows
    .map(([label, value]) => `<div class="amount-row"><span>${escapeHtml(label)}</span><strong>${money(value)}</strong></div>`)
    .join("");

  const costRows = [
    ["SICOV SERV HOM", summary.costs.sicov],
    ["IVA SICOV", summary.costs.ivaSicov],
    ["RECAUDO", summary.costs.recaudo],
    ["IVA RECAUDO", summary.costs.ivaRecaudo],
    ["ANSV", summary.costs.ansv],
    ["FUPA", summary.costs.fupa],
    ["IVA de FACT", summary.costs.ivaFact],
    ["Sustratos", summary.costs.sustratos],
    ["Coste transaccion", summary.costs.transaction],
    ["Fidelizados", summary.commissionDirect],
    ["Referidos", summary.commissionRef],
    ["Total egresos", summary.costs.total + summary.commissionDirect + summary.commissionRef]
  ];
  els.closingCostsBody.innerHTML = costRows
    .map(([label, value]) => `<tr><td>${escapeHtml(label)}</td><td class="number">${money(value)}</td></tr>`)
    .join("");

  els.closingDetailBody.innerHTML = summary.invoices.length
    ? summary.invoices
        .map(
          (invoice) => `
            <tr>
              <td>${escapeHtml(invoice.id)}</td>
              <td>${escapeHtml(invoice.client?.name || "-")}</td>
              <td>${escapeHtml(invoice.client?.plate || "-")}</td>
              <td>${escapeHtml(methodLabel(primaryMethod(invoice)))}</td>
              <td>${escapeHtml(invoice.flow?.rtmStatus || "-")}</td>
              <td>${escapeHtml(invoice.flow?.referralName || "-")}</td>
              <td class="number">${money(invoice.totals?.total || 0)}</td>
            </tr>
          `
        )
        .join("")
    : `<tr><td class="empty-row" colspan="7">Sin ventas para esta fecha</td></tr>`;
}

function renderReceivables() {
  const receivableInvoices = store.invoices.filter((invoice) => Number(invoice.receivable?.amount || 0) > 0);
  const pending = receivableInvoices
    .filter((invoice) => invoice.receivable.status !== "pagado")
    .reduce((sum, invoice) => sum + Number(invoice.receivable.pending || invoice.receivable.amount || 0), 0);
  const paid = receivableInvoices
    .filter((invoice) => invoice.receivable.status === "pagado")
    .reduce((sum, invoice) => sum + Number(invoice.receivable.amount || 0), 0);
  els.arPending.textContent = money(pending);
  els.arPaid.textContent = money(paid);
  els.arOpenCount.textContent = receivableInvoices.filter((invoice) => invoice.receivable.status !== "pagado").length;

  els.receivablesBody.innerHTML = receivableInvoices.length
    ? receivableInvoices
        .map((invoice) => {
          const isPaid = invoice.receivable.status === "pagado";
          return `
            <tr>
              <td>${escapeHtml(invoice.id)}</td>
              <td>${escapeHtml(invoice.date)}</td>
              <td>${escapeHtml(methodLabel(invoice.receivable.provider))}</td>
              <td>${escapeHtml(invoice.client?.name || "-")}</td>
              <td>${escapeHtml(invoice.client?.plate || "-")}</td>
              <td class="number">${money(invoice.receivable.amount)}</td>
              <td><span class="state-pill ${isPaid ? "ok" : "warn"}">${isPaid ? "Pagado" : "Pendiente"}</span></td>
              <td>${isPaid ? "-" : `<button class="link-button" data-pay-receivable="${escapeHtml(invoice.id)}">Marcar pagado</button>`}</td>
            </tr>
          `;
        })
        .join("")
    : `<tr><td class="empty-row" colspan="8">Sin cuentas por cobrar</td></tr>`;
}

function handleReceivableAction(event) {
  const id = event.target?.dataset?.payReceivable;
  if (!id) return;
  store.invoices = store.invoices.map((invoice) => {
    if (invoice.id !== id) return invoice;
    return {
      ...invoice,
      receivable: {
        ...invoice.receivable,
        pending: 0,
        status: "pagado",
        paidAt: new Date().toISOString()
      }
    };
  });
  renderAllViews();
}

function renderAllies() {
  const term = els.allySearch.value.trim().toUpperCase();
  const allies = store.allies.filter((ally) => {
    const haystack = `${ally.name} ${ally.phone} ${ally.company} ${ally.paymentMethod} ${ally.account}`.toUpperCase();
    return !term || haystack.includes(term);
  });
  els.alliesBody.innerHTML = allies.length
    ? allies
        .map(
          (ally) => `
            <tr>
              <td>${escapeHtml(ally.name)}</td>
              <td>${escapeHtml(ally.phone || "-")}</td>
              <td>${escapeHtml(ally.company || "-")}</td>
              <td>${escapeHtml(ally.paymentMethod || "-")}</td>
              <td>${escapeHtml(ally.account || "-")}</td>
              <td>${ally.enrolled ? "Si" : "No"}</td>
              <td>${escapeHtml(ally.notes || "-")}</td>
            </tr>
          `
        )
        .join("")
    : `<tr><td class="empty-row" colspan="7">Sin aliados</td></tr>`;
}

function addAlly(event) {
  event.preventDefault();
  const ally = {
    name: els.allyName.value.trim().toUpperCase(),
    phone: els.allyPhone.value.trim(),
    company: els.allyCompany.value.trim().toUpperCase(),
    paymentMethod: els.allyPayment.value.trim().toUpperCase(),
    account: els.allyAccount.value.trim(),
    enrolled: true,
    notes: "Creado desde prototipo"
  };
  if (!ally.name) return;
  store.allies = [...store.allies, ally];
  els.allyName.value = "";
  els.allyPhone.value = "";
  els.allyCompany.value = "";
  els.allyPayment.value = "";
  els.allyAccount.value = "";
  renderDatalists();
  renderAllies();
}

function exportInvoicesCsv() {
  const rows = [
    ["factura", "fecha", "cliente", "documento", "placa", "modelo", "rango", "metodo", "rtm", "referido", "estado_dian", "total", "cartera", "provision"],
    ...store.invoices.map((invoice) => [
      invoice.id,
      invoice.date,
      invoice.client?.name,
      invoice.client?.doc,
      invoice.client?.plate,
      invoice.client?.model,
      invoice.client?.range,
      methodLabel(primaryMethod(invoice)),
      invoice.flow?.rtmStatus,
      invoice.flow?.referralName,
      invoice.dianStatus,
      Math.round(invoice.totals?.total || 0),
      Math.round(invoice.receivable?.amount || 0),
      Math.round(invoice.provision || 0)
    ])
  ];
  downloadCsv("facturas-motopos-v2.csv", rows);
}

function exportClosingCsv() {
  const summary = summarizeClosing(els.closingDate.value);
  const rows = [
    ["fecha", els.closingDate.value],
    ["total", Math.round(summary.total)],
    ["rtm_realizadas", summary.rtmDone],
    ["rtm_pendientes", summary.rtmPending],
    ["cartera", Math.round(summary.receivable)],
    [],
    ["metodo", "valor"],
    ...paymentMethods.map((method) => [method.label, Math.round(summary.paymentTotals[method.id])]),
    [],
    ["factura", "cliente", "placa", "metodo", "rtm", "referido", "total"],
    ...summary.invoices.map((invoice) => [
      invoice.id,
      invoice.client?.name,
      invoice.client?.plate,
      methodLabel(primaryMethod(invoice)),
      invoice.flow?.rtmStatus,
      invoice.flow?.referralName,
      Math.round(invoice.totals?.total || 0)
    ])
  ];
  downloadCsv(`cierre-${els.closingDate.value}.csv`, rows);
}

function downloadCsv(filename, rows) {
  const csv = rows.map((row) => row.map((cell) => `"${String(cell ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

document.addEventListener("DOMContentLoaded", boot);
