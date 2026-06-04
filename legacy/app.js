const currency = new Intl.NumberFormat("es-CO", {
  style: "currency",
  currency: "COP",
  maximumFractionDigits: 0
});

const baseProducts = [
  { code: "5", name: "SERVICIO MOTOCICLETAS", price: 187053, tax: 19 },
  { code: "8", name: "RUNT MOTOCICLETAS", price: 5600, tax: 0 },
  { code: "9", name: "SICOV MOTOCICLETAS", price: 35492, tax: 19 },
  { code: "29", name: "RECAUDO MOTOCICLETAS", price: 10345, tax: 19 },
  { code: "1", name: "ANSV MOTOCICLETAS 2009-ANTES", price: 8800, tax: 0 },
  { code: "2", name: "ANSV MOTOCICLETAS 2010-2018", price: 9100, tax: 0 },
  { code: "3", name: "ANSV MOTOCICLETAS 2019-2023", price: 8800, tax: 0 },
  { code: "4", name: "ANSV MOTOCICLETAS 2024-2026", price: 8500, tax: 0 }
];

const baseBundleMap = {
  "MOTOCICLETAS 2009-ANTES": ["5", "8", "9", "29", "1"],
  "MOTOCICLETAS 2010-2018": ["5", "8", "9", "29", "2"],
  "MOTOCICLETAS 2019-2023": ["5", "8", "9", "29", "3"],
  "MOTOCICLETAS 2024-2026": ["5", "8", "9", "29", "4"]
};

let products = [...baseProducts];
const bundleMap = { ...baseBundleMap };
let packages = [];

const paymentMethods = [
  { id: "EFECTIVO", label: "Efectivo", group: "CM", input: "payCash", cost: { type: "none" } },
  { id: "DATAFONO SG", label: "Datafono Supergiros", group: "SG", input: "payDatafonoSg", cost: { type: "percent", rate: 0.0079 } },
  { id: "QR SG", label: "QR Supergiros", group: "SG", input: "payQrSg", cost: { type: "fixed", amount: 1000 } },
  { id: "QR CM", label: "QR empresarial", group: "CM", input: "payQrCm", cost: { type: "none" } },
  { id: "DATAFONO CM", label: "Datafono Certimotos", group: "CM", input: "payDatafonoCm", cost: { type: "percent", rate: 0.04 } },
  { id: "TRANSFERENCIA DIRECTA", label: "Transferencia directa", group: "CM", input: "payTransfer", cost: { type: "none" } },
  { id: "ADDI", label: "ADDI", group: "CREDITO", input: "payAddi", credit: true, cost: { type: "percent_plus_tax", rate: 0.09, taxRate: 0.19 } },
  { id: "ALIADOS DE INV. GORA SAS", label: "GORA", group: "CREDITO", input: "payGora", credit: true, cost: { type: "none" } },
  { id: "CREDITO PROPIO", label: "Credito propio", group: "CREDITO", input: "payCredito", credit: true, cost: { type: "fixed", amount: 1000 } }
];

const defaultAllies = [
  { name: "USUARIO", phone: "", company: "DIRECTO", paymentMethod: "", account: "", commission: 20000, enrolled: true, notes: "Usuario directo / fidelizado" },
  { name: "NANCY CERTIMOTOS", phone: "", company: "CONVENIO", paymentMethod: "NEQUI", account: "", commission: 40000, enrolled: true, notes: "Aliado ejemplo del cierre" },
  { name: "ALIADOS DE INV. GORA SAS", phone: "", company: "FINANCIACION", paymentMethod: "CUENTA", account: "", commission: 40000, enrolled: true, notes: "Cartera GORA" },
  { name: "ALDEMAR CASTRO", phone: "3102533439", company: "DRIVERCAR", paymentMethod: "NEQUI", account: "3102533439", commission: 40000, enrolled: true, notes: "Convenio inscrito" },
  { name: "ANDERSON - DONCEL", phone: "3145223461", company: "CONVENIO", paymentMethod: "NEQUI", account: "3145223461", commission: 40000, enrolled: true, notes: "Referido frecuente" },
  { name: "ANDRES PARRA", phone: "3228890812", company: "PARQUEADERO", paymentMethod: "NEQUI", account: "3228890812", commission: 40000, enrolled: false, notes: "Aliado por parqueadero" },
  { name: "DANIEL GOMEZ", phone: "3028418666", company: "CONVENIO", paymentMethod: "NEQUI", account: "3028418666", commission: 40000, enrolled: true, notes: "Mensaje WhatsApp" }
];

const storageKeys = {
  clients: "motopos.clients",
  vehicles: "motopos.vehicles",
  invoices: "motopos.invoices",
  allies: "motopos.allies",
  customProducts: "motopos.customProducts",
  customPackages: "motopos.customPackages"
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
  get vehicles() {
    return readJson(storageKeys.vehicles, []);
  },
  set vehicles(value) {
    writeJson(storageKeys.vehicles, value);
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
  },
  get customProducts() {
    return readJson(storageKeys.customProducts, []);
  },
  set customProducts(value) {
    writeJson(storageKeys.customProducts, value);
  },
  get customPackages() {
    return readJson(storageKeys.customPackages, []);
  },
  set customPackages(value) {
    writeJson(storageKeys.customPackages, value);
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

function formatPercent(value) {
  return `${Number((Number(value) || 0) * 100).toLocaleString("es-CO", { maximumFractionDigits: 2 })}%`;
}

function paymentCostDescription(method) {
  const cost = method?.cost || { type: "none" };
  if (cost.type === "fixed") return `${money(cost.amount)} fijo`;
  if (cost.type === "percent") return `${formatPercent(cost.rate)} del valor`;
  if (cost.type === "percent_plus_tax") return `${formatPercent(cost.rate)} + IVA sobre comision`;
  return "sin costo";
}

function paymentOptionLabel(method) {
  const cost = paymentCostDescription(method);
  return cost === "sin costo" ? method.label : `${method.label} (${cost})`;
}

function rebuildCatalogs() {
  const customProducts = store.customProducts.filter((product) => product.code && product.name);
  const customPackages = store.customPackages.filter((item) => item.code && item.range);
  products = [...baseProducts, ...customProducts];

  Object.keys(bundleMap).forEach((range) => delete bundleMap[range]);
  Object.assign(bundleMap, baseBundleMap);
  customPackages.forEach((item) => {
    bundleMap[item.range] = Array.isArray(item.components) ? item.components : [];
  });

  const baseRanges = Object.keys(baseBundleMap).map((range, index) => ({
    code: `RTM-${index + 1}`,
    name: range,
    range
  }));
  packages = [
    ...baseRanges,
    ...customPackages.map((item) => ({
      code: item.code,
      name: item.name,
      range: item.range,
      custom: true
    }))
  ];
}

function allyByName(name) {
  const term = String(name || "").trim().toUpperCase();
  return store.allies.find((ally) => ally.name.toUpperCase() === term) || null;
}

function firstReferredAlly() {
  return store.allies.find((ally) => ally.name !== "USUARIO" && ally.enrolled) || store.allies.find((ally) => ally.name !== "USUARIO");
}

function commissionForReferral(name) {
  const ally = allyByName(name);
  if (ally) return Number(ally.commission || 0);
  return String(name || "").trim().toUpperCase() === "USUARIO" ? 20000 : 40000;
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
        phone: "",
        email: "",
        address: "",
        status: "ACTIVO"
      },
      {
        doc: "900975741",
        name: "INVERSIONES GORA SAS",
        phone: "",
        email: "",
        address: "Girardot",
        status: "ACTIVO"
      }
    ];
  }

  migrateVehiclesFromClients();

  if (!store.vehicles.length) {
    store.vehicles = [
      {
        id: "veh-222222222222-v2t123",
        clientDoc: "222222222222",
        plate: "V2T123",
        model: 2021,
        range: "MOTOCICLETAS 2019-2023"
      },
      {
        id: "veh-900975741-gora01",
        clientDoc: "900975741",
        plate: "GORA01",
        model: 2024,
        range: "MOTOCICLETAS 2024-2026"
      }
    ];
  }

  if (!store.allies.length) {
    store.allies = defaultAllies;
  }
  migrateAllyCommissions();
}

function migrateVehiclesFromClients() {
  const vehicles = store.vehicles;
  let changedVehicles = false;
  const cleanedClients = store.clients.map((client) => {
    const plate = normalizePlate(client.plate);
    if (plate && !vehicles.some((vehicle) => vehicle.clientDoc === client.doc && vehicle.plate === plate)) {
      const model = Number(client.model) || modelFromRange(client.range || "MOTOCICLETAS 2024-2026");
      vehicles.push({
        id: `veh-${client.doc}-${plate}`.toLowerCase(),
        clientDoc: client.doc,
        plate,
        model,
        range: client.range || rangeFromModel(model)
      });
      changedVehicles = true;
    }
    const { plate: _plate, model: _model, range: _range, ...cleanClient } = client;
    return cleanClient;
  });

  store.clients = cleanedClients;
  if (changedVehicles) store.vehicles = vehicles;
}

function migrateAllyCommissions() {
  const allies = store.allies.map((ally) => ({
    ...ally,
    commission: Number(ally.commission ?? (ally.name === "USUARIO" ? 20000 : 40000))
  }));
  store.allies = allies;
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
    "vehicleLookup",
    "vehicleSummary",
    "invoiceDate",
    "renewalDate",
    "serviceLine",
    "dianStatus",
    "rtmAlreadyPaid",
    "rtmState",
    "saleOrigin",
    "referralName",
    "commissionValue",
    "commissionHint",
    "creditProvider",
    "paymentMethod",
    "rtmToday",
    "pinNumber",
    "flowHint",
    "checkoutDialog",
    "checkoutSnapshot",
    "confirmFinalizeBtn",
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
    "allyCommission",
    "alliesBody",
    "packageDialog",
    "packageCode",
    "packageName",
    "packageRange",
    "packageAnsv",
    "savePackageBtn",
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
    "modalAddress",
    "modalEmail",
    "modalPhone",
    "modalStatus",
    "vehicleDialog",
    "modalVehicleOwner",
    "modalVehiclePlate",
    "modalVehicleModel",
    "modalVehicleRange",
    "receiptDialog",
    "receiptContent",
    ...paymentMethods.map((method) => method.input)
  ].forEach((id) => {
    els[id] = $(id);
  });

  seedData();
  rebuildCatalogs();
  renderPaymentOptions();
  els.invoiceDate.value = todayIso();
  els.closingDate.value = todayIso();
  els.renewalDate.value = todayIso(365);
  bindEvents();
  renderDatalists();
  els.rtmState.value = "charge_done";
  syncRtmStateToFields();
  updateCommissionFromReferral();
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
  $("findVehicleBtn").addEventListener("click", loadVehicleFromLookup);
  $("openVehicleBtn").addEventListener("click", openVehicleDialog);
  $("newClientFromListBtn").addEventListener("click", openClientDialog);
  $("openRecurringBtn").addEventListener("click", () => els.recurringDialog.showModal());
  $("openPackageBtn").addEventListener("click", openPackageDialog);
  $("newPackageBtn").addEventListener("click", openPackageDialog);
  $("addBundleBtn").addEventListener("click", (event) => {
    event.preventDefault();
    addBundleToCart(state.selectedBundle);
    fillSelectedPaymentIfEmpty();
    els.recurringDialog.close();
  });
  $("addLineBtn").addEventListener("click", addManualLine);
  $("clearBtn").addEventListener("click", resetInvoice);
  $("finalizeBtn").addEventListener("click", openCheckoutDialog);
  $("confirmFinalizeBtn").addEventListener("click", finalizeInvoice);
  $("saveClientBtn").addEventListener("click", saveClientFromDialog);
  $("saveVehicleBtn").addEventListener("click", saveVehicleFromDialog);
  $("savePackageBtn").addEventListener("click", savePackageFromDialog);
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
  $("quickProductBtn").addEventListener("click", quickAddPackageFromSearch);
  $("addAllyBtn").addEventListener("click", addAlly);

  els.clientDoc.addEventListener("change", loadClientFromDoc);
  els.vehicleLookup.addEventListener("change", loadVehicleFromLookup);
  els.vehicleModel.addEventListener("input", syncRangeFromModel);
  els.modalVehicleModel.addEventListener("input", () => {
    els.modalVehicleRange.value = rangeFromModel(els.modalVehicleModel.value);
  });
  els.vehicleRange.addEventListener("change", () => {
    state.selectedBundle = els.vehicleRange.value;
    if (!Number(els.vehicleModel.value)) els.vehicleModel.value = modelFromRange(els.vehicleRange.value);
    renderBundleList();
    renderTotals();
  });
  els.productCode.addEventListener("change", fillProductFromCode);
  els.productSearch.addEventListener("change", previewPackageFromSearch);
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
  els.referralName.addEventListener("change", () => {
    updateCommissionFromReferral();
    renderTotals();
  });
  els.rtmState.addEventListener("change", () => {
    syncRtmStateToFields();
    renderTotals();
  });
  [els.clientName, els.clientPhone, els.clientEmail].forEach((input) => {
    input.addEventListener("input", renderClientSummary);
    input.addEventListener("change", renderClientSummary);
  });
  [els.vehiclePlate, els.vehicleModel, els.vehicleRange].forEach((input) => {
    input.addEventListener("input", renderVehicleSummary);
    input.addEventListener("change", renderVehicleSummary);
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
    .map((method) => `<option value="${method.id}">${paymentOptionLabel(method)}</option>`)
    .join("");
}

function renderRangeOptions() {
  const options = packages
    .map((item) => `<option value="${escapeHtml(item.range)}">${escapeHtml(item.range)}</option>`)
    .join("");
  [els.vehicleRange, els.modalVehicleRange].forEach((select) => {
    if (!select) return;
    const current = select.value || state.selectedBundle;
    select.innerHTML = options;
    select.value = packages.some((item) => item.range === current) ? current : state.selectedBundle;
  });
}

function renderDatalists() {
  renderRangeOptions();
  $("clientDocs").innerHTML = store.clients
    .map((client) => `<option value="${escapeHtml(client.doc)}">${escapeHtml(client.name)}</option>`)
    .join("");
  $("vehiclePlates").innerHTML = store.vehicles
    .map((vehicle) => {
      const client = store.clients.find((item) => item.doc === vehicle.clientDoc);
      return `<option value="${escapeHtml(vehicle.plate)}">${escapeHtml(client?.name || vehicle.clientDoc)} | ${escapeHtml(vehicle.range)}</option>`;
    })
    .join("");
  $("productCodes").innerHTML = products
    .map((product) => `<option value="${escapeHtml(product.code)}">${escapeHtml(product.name)}</option>`)
    .join("");
  $("packageOptions").innerHTML = packages
    .map((item) => `<option value="${escapeHtml(item.code)}">${escapeHtml(item.name)}</option>`)
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
  setCurrentClient(client);
  const currentVehicle = currentVehiclePayload();
  const vehicleStillBelongs = currentVehicle.plate && currentVehicle.clientDoc === client.doc;
  if (!vehicleStillBelongs) {
    setCurrentVehicle(store.vehicles.find((vehicle) => vehicle.clientDoc === client.doc));
  }
  renderTotals();
  renderClientSummary();
}

function setCurrentClient(client) {
  els.clientDoc.value = client.doc;
  els.clientName.value = client.name || "";
  els.clientPhone.value = client.phone || "";
  els.clientEmail.value = client.email || "";
  els.clientAddress.value = client.address || "";
}

function resolveClient(value) {
  const term = String(value || "").trim().toUpperCase();
  if (!term) return null;
  return (
    store.clients.find((item) => String(item.doc || "").toUpperCase() === term) ||
    store.clients.find((item) => String(item.name || "").toUpperCase().includes(term))
  );
}

function renderClientSummary() {
  if (!els.clientSummary) return;
  const client = currentClientPayload();
  const phone = client.phone || "sin telefono";
  els.clientSummary.innerHTML = `
    <div>
      <strong>${escapeHtml(client.name)}</strong>
      <span>${escapeHtml(client.doc)} | ${escapeHtml(client.email || "sin correo")}</span>
      <small>${escapeHtml(phone)}</small>
    </div>
  `;
}

function currentClientPayload() {
  return {
    doc: els.clientDoc.value.trim() || "222222222222",
    name: els.clientName.value.trim() || "Consumidor final",
    phone: els.clientPhone.value.trim(),
    email: els.clientEmail.value.trim(),
    address: els.clientAddress.value.trim(),
    status: "ACTIVO"
  };
}

function currentVehiclePayload() {
  const model = Number(els.vehicleModel.value) || modelFromRange(els.vehicleRange.value);
  return {
    id: `veh-${els.clientDoc.value.trim() || "222222222222"}-${normalizePlate(els.vehiclePlate.value)}`.toLowerCase(),
    clientDoc: els.clientDoc.value.trim() || "222222222222",
    plate: normalizePlate(els.vehiclePlate.value),
    model,
    range: els.vehicleRange.value || rangeFromModel(model)
  };
}

function invoiceVehicle(invoice) {
  return invoice.vehicle || {
    plate: invoice.client?.plate || "",
    model: invoice.client?.model || "",
    range: invoice.client?.range || "SIN RANGO",
    clientDoc: invoice.client?.doc || ""
  };
}

function resolveVehicle(value) {
  const term = String(value || "").trim().toUpperCase();
  if (!term) return null;
  const currentDoc = els.clientDoc.value.trim();
  return (
    store.vehicles.find((vehicle) => vehicle.clientDoc === currentDoc && vehicle.plate.toUpperCase() === term) ||
    store.vehicles.find((vehicle) => vehicle.plate.toUpperCase() === term) ||
    store.vehicles.find((vehicle) => vehicle.clientDoc === currentDoc && String(vehicle.model).includes(term)) ||
    store.vehicles.find((vehicle) => vehicle.plate.toUpperCase().includes(term))
  );
}

function setCurrentVehicle(vehicle) {
  if (!vehicle) {
    els.vehicleLookup.value = "";
    els.vehiclePlate.value = "";
    els.vehicleModel.value = modelFromRange("MOTOCICLETAS 2024-2026");
    els.vehicleRange.value = "MOTOCICLETAS 2024-2026";
  } else {
    els.vehicleLookup.value = vehicle.plate;
    els.vehiclePlate.value = vehicle.plate;
    els.vehicleModel.value = vehicle.model || modelFromRange(vehicle.range);
    els.vehicleRange.value = vehicle.range || rangeFromModel(vehicle.model);
  }
  state.selectedBundle = els.vehicleRange.value;
  renderBundleList();
  renderVehicleSummary();
}

function loadVehicleFromLookup() {
  const vehicle = resolveVehicle(els.vehicleLookup.value);
  if (vehicle && vehicle.clientDoc !== els.clientDoc.value.trim()) {
    const owner = store.clients.find((client) => client.doc === vehicle.clientDoc);
    if (owner) setCurrentClient(owner);
  }
  setCurrentVehicle(vehicle);
  renderClientSummary();
  renderTotals();
}

function renderVehicleSummary() {
  if (!els.vehicleSummary) return;
  const vehicle = currentVehiclePayload();
  if (!vehicle.plate) {
    els.vehicleSummary.innerHTML = `<div><strong>Sin moto seleccionada</strong><span>Agrega o busca una placa para esta venta</span></div>`;
    return;
  }
  els.vehicleSummary.innerHTML = `
    <div>
      <strong>${escapeHtml(vehicle.plate)}</strong>
      <span>Modelo ${escapeHtml(vehicle.model)} | ${escapeHtml(vehicle.range)}</span>
      <small>Moto usada solo en esta venta</small>
    </div>
  `;
}

function upsertClient(client) {
  const { plate: _plate, model: _model, range: _range, ...cleanClient } = client;
  const clients = store.clients;
  const index = clients.findIndex((item) => item.doc === cleanClient.doc);
  if (index >= 0) {
    clients[index] = { ...clients[index], ...cleanClient };
  } else {
    clients.push(cleanClient);
  }
  store.clients = clients;
  renderDatalists();
}

function upsertVehicle(vehicle) {
  if (!vehicle.plate) return;
  const vehicles = store.vehicles;
  const index = vehicles.findIndex((item) => item.clientDoc === vehicle.clientDoc && item.plate === vehicle.plate);
  if (index >= 0) {
    vehicles[index] = { ...vehicles[index], ...vehicle };
  } else {
    vehicles.push(vehicle);
  }
  store.vehicles = vehicles;
  renderDatalists();
}

function syncRangeFromModel() {
  const range = rangeFromModel(els.vehicleModel.value);
  els.vehicleRange.value = range;
  state.selectedBundle = range;
  renderBundleList();
  renderVehicleSummary();
  renderTotals();
}

function syncReferralDefaults() {
  if (els.saleOrigin.value === "directo") {
    els.referralName.value = "USUARIO";
  } else {
    if (!els.referralName.value || els.referralName.value === "USUARIO") {
      const ally = firstReferredAlly();
      els.referralName.value = ally?.name || "NANCY CERTIMOTOS";
    }
  }
  updateCommissionFromReferral();
}

function updateCommissionFromReferral() {
  const commission = commissionForReferral(els.referralName.value);
  els.commissionValue.value = commission;
  if (els.commissionHint) {
    const ally = allyByName(els.referralName.value);
    els.commissionHint.textContent = ally
      ? `${ally.company || "Aliado"} | ${money(commission)}`
      : `Valor sugerido: ${money(commission)}`;
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

function syncRtmStateToFields() {
  const stateValue = els.rtmState.value;
  const map = {
    charge_done: { paid: "no", today: "si" },
    charge_pending: { paid: "no", today: "no" },
    paid_done: { paid: "si", today: "si" },
    paid_pending: { paid: "si", today: "no" }
  };
  const next = map[stateValue] || map.charge_done;
  els.rtmAlreadyPaid.value = next.paid;
  els.rtmToday.value = next.today;
}

function rtmStatusText() {
  const labels = {
    charge_done: "Cobrada y realizada hoy",
    charge_pending: "Cobrada y pendiente",
    paid_done: "Ya pagada y realizada",
    paid_pending: "Ya pagada sin realizar"
  };
  return labels[els.rtmState.value] || labels.charge_done;
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

function resolvePackage(value) {
  const term = String(value || "").trim().toUpperCase();
  if (!term) return null;
  return (
    packages.find((item) => item.code.toUpperCase() === term) ||
    packages.find((item) => item.name.toUpperCase() === term) ||
    packages.find((item) => item.name.toUpperCase().includes(term)) ||
    packages.find((item) => item.range.toUpperCase().includes(term))
  );
}

function previewPackageFromSearch() {
  const item = resolvePackage(els.productSearch.value);
  if (item) els.productSearch.value = item.code;
}

function quickAddPackageFromSearch(event) {
  event.preventDefault();
  const item = resolvePackage(els.productSearch.value) || packages.find((packageItem) => packageItem.range === els.vehicleRange.value);
  if (!item) return;
  addBundleToCart(item.range);
  els.vehicleRange.value = item.range;
  els.vehicleModel.value = modelFromRange(item.range);
  state.selectedBundle = item.range;
  renderVehicleSummary();
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

function openPackageDialog(event) {
  event?.preventDefault?.();
  const nextNumber = packages.length + 1;
  els.packageCode.value = `RTM-${nextNumber}`;
  els.packageName.value = "";
  els.packageRange.value = "";
  els.packageAnsv.value = 8500;
  if (els.recurringDialog.open) els.recurringDialog.close();
  els.packageDialog.showModal();
}

function savePackageFromDialog(event) {
  event.preventDefault();
  const range = els.packageRange.value.trim().toUpperCase() || els.packageName.value.trim().toUpperCase();
  const name = els.packageName.value.trim().toUpperCase() || range;
  const code = els.packageCode.value.trim().toUpperCase() || `RTM-${packages.length + 1}`;
  const ansvValue = Number(els.packageAnsv.value || 0);
  if (!range || !name) return;

  const productCode = `ANSV-${code}`.replace(/\s+/g, "-");
  const customProduct = {
    code: productCode,
    name: `ANSV ${name}`,
    price: ansvValue,
    tax: 0
  };
  const components = ["5", "8", "9", "29", productCode];
  const customProducts = store.customProducts.filter((product) => product.code !== productCode);
  const customPackages = store.customPackages.filter((item) => item.code !== code && item.range !== range);
  store.customProducts = [...customProducts, customProduct];
  store.customPackages = [...customPackages, { code, name, range, components }];
  rebuildCatalogs();
  state.selectedBundle = range;
  renderDatalists();
  els.vehicleRange.value = range;
  renderBundleList();
  els.productSearch.value = code;
  els.packageDialog.close();
  if (els.recurringDialog.open) renderBundleList();
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
  const cost = methodById(methodId)?.cost || { type: "none" };
  if (cost.type === "fixed") return Number(cost.amount || 0);
  if (cost.type === "percent") return value * Number(cost.rate || 0);
  if (cost.type === "percent_plus_tax") return value * Number(cost.rate || 0) * (1 + Number(cost.taxRate || 0));
  return 0;
}

function transactionCostForPayments(payments) {
  return paymentMethods.reduce((sum, method) => sum + transactionCostFor(method.id, payments[method.id]), 0);
}

function currentFlowPayload(result = totals(), payments = getPaymentBreakdown()) {
  syncRtmStateToFields();
  const creditProvider = els.creditProvider.value;
  const creditAmount = paymentMethods
    .filter((method) => method.credit)
    .reduce((sum, method) => sum + Number(payments[method.id] || 0), 0);
  const missingPayment = Math.max(0, result.total - totalPayments(payments));
  const receivableAmount = creditProvider !== "no" ? Math.max(creditAmount, result.total) : missingPayment;
  const rtmPending = els.rtmToday.value === "no" && els.rtmAlreadyPaid.value === "no";

  return {
    rtmAlreadyPaid: els.rtmAlreadyPaid.value,
    rtmState: els.rtmState.value,
    saleOrigin: els.saleOrigin.value,
    referralName: els.referralName.value.trim() || "USUARIO",
    commission: Number(els.commissionValue.value || 0),
    creditProvider,
    paymentMethod: els.paymentMethod.value,
    rtmToday: els.rtmToday.value,
    pinNumber: els.pinNumber.value.trim(),
    dianStatus: els.dianStatus.value,
    rtmStatus: rtmStatusText(),
    receivableAmount,
    receivableProvider: receivableAmount > 0 ? (creditProvider !== "no" ? creditProvider : "SALDO PENDIENTE") : "",
    provisionAmount: rtmPending ? result.total : 0
  };
}

function buildCostBreakdown(flow, payments) {
  const model = currentVehiclePayload().model;
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
    els.cartBody.innerHTML = `<tr><td class="empty-row" colspan="7">No hay paquete agregado</td></tr>`;
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
  if (els.checkoutDialog?.open) renderCheckoutSnapshot();
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

function openVehicleDialog(event) {
  event?.preventDefault?.();
  const client = currentClientPayload();
  const vehicle = currentVehiclePayload();
  els.modalVehicleOwner.value = `${client.doc} - ${client.name}`;
  els.modalVehiclePlate.value = vehicle.plate;
  els.modalVehicleModel.value = vehicle.model || 2026;
  els.modalVehicleRange.value = vehicle.range || rangeFromModel(vehicle.model);
  els.vehicleDialog.showModal();
}

function saveVehicleFromDialog(event) {
  event.preventDefault();
  const client = currentClientPayload();
  upsertClient(client);
  const model = Number(els.modalVehicleModel.value) || modelFromRange(els.modalVehicleRange.value);
  const vehicle = {
    id: `veh-${client.doc}-${normalizePlate(els.modalVehiclePlate.value)}`.toLowerCase(),
    clientDoc: client.doc,
    plate: normalizePlate(els.modalVehiclePlate.value),
    model,
    range: els.modalVehicleRange.value || rangeFromModel(model)
  };
  if (!vehicle.plate) return;
  upsertVehicle(vehicle);
  setCurrentVehicle(vehicle);
  els.vehicleDialog.close();
  renderAllViews();
}

function openCheckoutDialog(event) {
  event?.preventDefault?.();
  if (!state.lines.length) return;
  syncRtmStateToFields();
  updateCommissionFromReferral();
  fillSelectedPaymentIfEmpty();
  renderTotals();
  renderCheckoutSnapshot();
  els.checkoutDialog.showModal();
}

function renderCheckoutSnapshot() {
  if (!els.checkoutSnapshot) return;
  const { result, payments, flow, costs } = currentSaleSnapshot();
  const paid = totalPayments(payments);
  const rows = [
    ["Total factura", result.total],
    ["Pagado", paid],
    ["Cambio", Math.max(0, paid - result.total)],
    ["Saldo cartera", flow.receivableAmount],
    ["Comision", flow.commission],
    ["Costos operativos", costs.total]
  ];
  els.checkoutSnapshot.innerHTML = rows
    .map(([label, value]) => `<div class="amount-row"><span>${escapeHtml(label)}</span><strong>${money(value)}</strong></div>`)
    .join("");
}

function finalizeInvoice(event) {
  event?.preventDefault?.();
  if (!state.lines.length) return;
  syncRtmStateToFields();
  updateCommissionFromReferral();
  const client = currentClientPayload();
  const vehicle = currentVehiclePayload();
  upsertClient(client);
  if (vehicle.plate) upsertVehicle(vehicle);
  const { result, payments, flow, costs } = currentSaleSnapshot();
  const generatedAt = new Date();
  const invoice = {
    id: nextInvoiceNumber(),
    date: els.invoiceDate.value,
    time: generatedAt.toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }),
    renewalDate: els.renewalDate.value,
    client,
    vehicle,
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
  if (els.checkoutDialog.open) els.checkoutDialog.close();
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
  const vehicle = invoiceVehicle(invoice);
  const qrSeed = `${ticketId}|${invoice.client.doc}|${vehicle.plate}|${Math.round(invoice.totals.total)}`;

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
        <span>Placa:</span><strong>${escapeHtml(vehicle.plate || "SIN PLACA")}</strong>
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
      <small class="ticket-foot">Moto: ${escapeHtml(vehicle.range || "-")}</small>
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
  els.rtmState.value = "charge_done";
  els.rtmAlreadyPaid.value = "no";
  els.saleOrigin.value = "directo";
  els.referralName.value = "USUARIO";
  updateCommissionFromReferral();
  els.creditProvider.value = "no";
  els.paymentMethod.value = "EFECTIVO";
  els.rtmToday.value = "si";
  els.pinNumber.value = "";
  els.dianStatus.value = "enviada";
  clearPaymentInputs();
  els.notes.value = "";
  clearProductEntry();
  els.productSearch.value = "";
  if (els.checkoutDialog.open) els.checkoutDialog.close();
  renderInvoiceNumber();
  renderClientSummary();
  renderCart();
  renderAllViews();
}

function renderClients() {
  els.clientsBody.innerHTML = store.clients.length
    ? store.clients
        .map(
          (client) => {
            const vehicles = store.vehicles.filter((vehicle) => vehicle.clientDoc === client.doc);
            const vehicleLabel = vehicles.length ? vehicles.map((vehicle) => vehicle.plate).join(", ") : "-";
            return `
            <tr>
              <td>${escapeHtml(client.doc)}</td>
              <td>${escapeHtml(client.name)}</td>
              <td>${escapeHtml(vehicleLabel)}</td>
              <td>${escapeHtml(client.phone || "-")}</td>
              <td>${escapeHtml(client.email || "-")}</td>
            </tr>
          `;
          }
        )
        .join("")
    : `<tr><td class="empty-row" colspan="5">Sin clientes</td></tr>`;
}

function renderInvoices() {
  const rows = store.invoices.map(
    (invoice) => {
      const vehicle = invoiceVehicle(invoice);
      return `
      <tr>
        <td>${escapeHtml(invoice.id)}</td>
        <td>${escapeHtml(invoice.date)}</td>
        <td>${escapeHtml(invoice.client?.name || "-")}</td>
        <td>${escapeHtml(vehicle.plate || "-")}</td>
        <td>${escapeHtml(methodLabel(invoice.paymentMethod))}</td>
        <td>${escapeHtml(invoice.flow?.rtmStatus || "-")}</td>
        <td>${escapeHtml(invoice.dianStatus || "-")}</td>
        <td class="number">${money(invoice.totals?.total || 0)}</td>
      </tr>
    `;
    }
  );
  els.invoicesBody.innerHTML = rows.length ? rows.join("") : `<tr><td class="empty-row" colspan="8">Sin facturas emitidas</td></tr>`;
}

function invoiceMatchesSearch(invoice, term) {
  const vehicle = invoiceVehicle(invoice);
  const haystack = `${invoice.client?.name || ""} ${invoice.client?.doc || ""} ${vehicle.plate || ""} ${invoice.paymentMethod || ""}`.toUpperCase();
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
  const plates = new Set(invoices.map((invoice) => invoiceVehicle(invoice).plate).filter(Boolean));
  els.kpiInvoices.textContent = invoices.length;
  els.kpiRevenue.textContent = money(revenue);
  els.kpiVehicles.textContent = plates.size;

  renderBars(
    els.rangeBars,
    invoices.reduce((acc, invoice) => {
      const range = invoiceVehicle(invoice).range || "SIN RANGO";
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
        .map((invoice) => {
          const vehicle = invoiceVehicle(invoice);
          return `
            <tr>
              <td>${escapeHtml(invoice.date)}</td>
              <td>${escapeHtml(vehicle.plate || "-")}</td>
              <td>${escapeHtml(vehicle.range || "-")}</td>
              <td>${escapeHtml(methodLabel(primaryMethod(invoice)))}</td>
              <td class="number">${money(invoice.totals?.total || 0)}</td>
            </tr>
          `;
        })
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
          <td>${escapeHtml(paymentCostDescription(method))}</td>
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
        .map((invoice) => {
          const vehicle = invoiceVehicle(invoice);
          return `
            <tr>
              <td>${escapeHtml(invoice.id)}</td>
              <td>${escapeHtml(invoice.client?.name || "-")}</td>
              <td>${escapeHtml(vehicle.plate || "-")}</td>
              <td>${escapeHtml(methodLabel(primaryMethod(invoice)))}</td>
              <td>${escapeHtml(invoice.flow?.rtmStatus || "-")}</td>
              <td>${escapeHtml(invoice.flow?.referralName || "-")}</td>
              <td class="number">${money(invoice.totals?.total || 0)}</td>
            </tr>
          `;
        })
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
          const vehicle = invoiceVehicle(invoice);
          return `
            <tr>
              <td>${escapeHtml(invoice.id)}</td>
              <td>${escapeHtml(invoice.date)}</td>
              <td>${escapeHtml(methodLabel(invoice.receivable.provider))}</td>
              <td>${escapeHtml(invoice.client?.name || "-")}</td>
              <td>${escapeHtml(vehicle.plate || "-")}</td>
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
              <td class="number">${money(ally.commission || 0)}</td>
              <td>${ally.enrolled ? "Si" : "No"}</td>
              <td>${escapeHtml(ally.notes || "-")}</td>
            </tr>
          `
        )
        .join("")
    : `<tr><td class="empty-row" colspan="8">Sin aliados</td></tr>`;
}

function addAlly(event) {
  event.preventDefault();
  const ally = {
    name: els.allyName.value.trim().toUpperCase(),
    phone: els.allyPhone.value.trim(),
    company: els.allyCompany.value.trim().toUpperCase(),
    paymentMethod: els.allyPayment.value.trim().toUpperCase(),
    account: els.allyAccount.value.trim(),
    commission: Number(els.allyCommission.value || 0),
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
  els.allyCommission.value = 40000;
  renderDatalists();
  renderAllies();
}

function exportInvoicesCsv() {
  const rows = [
    ["factura", "fecha", "cliente", "documento", "placa", "modelo", "rango", "metodo", "rtm", "referido", "estado_dian", "total", "cartera", "provision"],
    ...store.invoices.map((invoice) => {
      const vehicle = invoiceVehicle(invoice);
      return [
        invoice.id,
        invoice.date,
        invoice.client?.name,
        invoice.client?.doc,
        vehicle.plate,
        vehicle.model,
        vehicle.range,
        methodLabel(primaryMethod(invoice)),
        invoice.flow?.rtmStatus,
        invoice.flow?.referralName,
        invoice.dianStatus,
        Math.round(invoice.totals?.total || 0),
        Math.round(invoice.receivable?.amount || 0),
        Math.round(invoice.provision || 0)
      ];
    })
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
    ...summary.invoices.map((invoice) => {
      const vehicle = invoiceVehicle(invoice);
      return [
        invoice.id,
        invoice.client?.name,
        vehicle.plate,
        methodLabel(primaryMethod(invoice)),
        invoice.flow?.rtmStatus,
        invoice.flow?.referralName,
        Math.round(invoice.totals?.total || 0)
      ];
    })
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
