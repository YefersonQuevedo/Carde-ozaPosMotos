import { api } from "./api.js";

const money = (n) => new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 }).format(Math.round(Number(n) || 0));
const todayIso = () => new Date().toISOString().slice(0, 10);
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

let catalog = { products: [], packages: [], componentsByPackage: {}, paymentMethods: [] };
const productByCode = {};
const methodByCode = {};

// ---------- Estado de la venta (wizard) ----------
function blankSale() {
  return {
    client: null, // {docNumber, name, phone, docType}
    vehicle: { plate: "", modelYear: null, rangeName: "" },
    packageCode: "",
    rtmAlreadyPaid: null,
    needsCredit: null,
    creditProvider: null,
    payments: [],
    paymentConfirmed: false,
    allyAnswered: false,
    allyType: "usuario",
    allyName: "USUARIO",
    discountApplied: true,
    rtmTodayAnswered: false,
    rtmToday: true,
    registered: null // respuesta del backend
  };
}
let sale = blankSale();

function rangeFromModel(year) {
  const y = Number(year) || 0;
  if (y >= 2024) return "MOTOCICLETAS 2024-2026";
  if (y >= 2019) return "MOTOCICLETAS 2019-2023";
  if (y >= 2010) return "MOTOCICLETAS 2010-2018";
  return "MOTOCICLETAS 2009-ANTES";
}
function packageForRange(range) {
  return catalog.packages.find((p) => p.rangeName === range);
}

// Lineas fiscales del paquete (espejo del backend, precios IVA-incluido).
function computeLines(packageCode) {
  const codes = catalog.componentsByPackage[packageCode] || [];
  return codes.map((code) => {
    const p = productByCode[code];
    const rate = (p.taxRate || 0) / 100;
    const base = Math.round(p.unitPrice / (1 + rate));
    return { ...p, base, tax: p.unitPrice - base, total: p.unitPrice };
  });
}
function saleTotals() {
  const lines = sale.packageCode ? computeLines(sale.packageCode) : [];
  return {
    lines,
    base: lines.reduce((s, l) => s + l.base, 0),
    iva: lines.reduce((s, l) => s + l.tax, 0),
    total: lines.reduce((s, l) => s + l.total, 0)
  };
}
const paidAmount = () => sale.payments.reduce((s, p) => s + (Number(p.amount) || 0), 0);

// Estado de pago: efectivo puede exceder (vueltas); los demas metodos no.
function paymentState() {
  const { total } = saleTotals();
  const paid = paidAmount();
  const cash = sale.payments.filter((p) => p.methodCode === "EFECTIVO").reduce((s, p) => s + (Number(p.amount) || 0), 0);
  const nonCash = paid - cash;
  return {
    total,
    paid,
    cash,
    nonCash,
    falta: Math.max(0, total - paid),
    change: Math.max(0, paid - total), // vueltas (solo se dan en efectivo)
    nonCashOver: nonCash > total,
    canConfirm: paid >= total && nonCash <= total
  };
}

// ---------- Flujo de pasos ----------
function stepOrder() {
  const o = ["cliente", "moto", "rtmPaid"];
  if (sale.rtmAlreadyPaid === true) {
    o.push("tipoCliente", "resumen");
  } else if (sale.rtmAlreadyPaid === false) {
    o.push("credito");
    if (sale.needsCredit === true) o.push("creditoProveedor");
    else if (sale.needsCredit === false) o.push("pago");
    if (sale.needsCredit !== null) o.push("tipoCliente", "rtmHoy", "resumen");
  }
  return o;
}
function isDone(key) {
  switch (key) {
    case "cliente": return !!sale.client;
    case "moto": return !!sale.vehicle.plate && !!sale.packageCode;
    case "rtmPaid": return sale.rtmAlreadyPaid !== null;
    case "credito": return sale.needsCredit !== null;
    case "creditoProveedor": return !!sale.creditProvider;
    case "pago": return sale.paymentConfirmed;
    case "tipoCliente": return sale.allyAnswered;
    case "rtmHoy": return sale.rtmTodayAnswered;
    case "resumen": return !!sale.registered;
    default: return false;
  }
}

// Al editar un paso, se reinicia ese dato y los posteriores dependientes.
function resetFrom(key) {
  const fields = {
    cliente: () => { sale.client = null; },
    moto: () => { sale.vehicle = { plate: "", modelYear: null, rangeName: "" }; sale.packageCode = ""; },
    rtmPaid: () => { sale.rtmAlreadyPaid = null; sale.needsCredit = null; sale.creditProvider = null; sale.payments = []; sale.paymentConfirmed = false; },
    credito: () => { sale.needsCredit = null; sale.creditProvider = null; sale.payments = []; sale.paymentConfirmed = false; },
    creditoProveedor: () => { sale.creditProvider = null; sale.payments = []; },
    pago: () => { sale.payments = []; sale.paymentConfirmed = false; },
    tipoCliente: () => { sale.allyAnswered = false; },
    rtmHoy: () => { sale.rtmTodayAnswered = false; }
  };
  const order = stepOrder();
  const idx = order.indexOf(key);
  order.slice(idx).forEach((k) => fields[k] && fields[k]());
  render();
}

// ---------- Render del wizard ----------
function card(key, title, bodyHtml, done) {
  const editBtn = done ? `<button class="link" data-edit="${key}">editar</button>` : "";
  return `<div class="step ${done ? "done" : "active"}">
    <div class="step-head"><span class="step-title">${title}</span>${editBtn}</div>
    <div class="step-body">${bodyHtml}</div>
  </div>`;
}

function renderActive(key) {
  switch (key) {
    case "cliente":
      return card(key, "1 · Cliente", `
        <div class="row">
          <div class="lookup">
            <input id="cDoc" autocomplete="off" placeholder="Cedula, NIT o nombre" />
            <div id="clientSuggest" class="suggest hidden"></div>
          </div>
          <button class="btn" id="cFind">Buscar</button>
        </div>
        <div id="cResult" class="hint">Escribe documento o nombre; elige una sugerencia o registra uno nuevo.</div>
        <div id="cNew" class="grid2 hidden">
          <input id="cNewDoc" placeholder="Documento (cedula / NIT)" />
          <input id="cName" placeholder="Nombre completo" />
          <input id="cPhone" placeholder="Telefono" />
          <button class="btn primary" id="cSave">Guardar y continuar</button>
        </div>`, false);
    case "moto":
      return card(key, "2 · Moto", `
        <div class="grid2">
          <div class="lookup">
            <input id="vPlate" autocomplete="off" placeholder="Placa" maxlength="8" style="text-transform:uppercase" />
            <div id="vehicleSuggest" class="suggest hidden"></div>
          </div>
          <input id="vYear" type="number" placeholder="Año modelo" min="1980" max="2035" />
        </div>
        <div id="vRange" class="hint"></div>
        <button class="btn primary" id="vNext">Continuar</button>`, false);
    case "rtmPaid":
      return card(key, "3 · ¿La RTM ya esta paga?", `
        <div class="choices">
          <button class="choice" data-rtmpaid="no">No, se cobra ahora</button>
          <button class="choice" data-rtmpaid="si">Si, ya esta paga</button>
        </div>`, false);
    case "credito":
      return card(key, "4 · ¿Necesita credito?", `
        <div class="choices">
          <button class="choice" data-credit="no">No</button>
          <button class="choice" data-credit="si">Si (financiacion)</button>
        </div>`, false);
    case "creditoProveedor":
      return card(key, "4b · Financiacion", `
        <div class="choices">
          <button class="choice" data-prov="ADDI">ADDI</button>
          <button class="choice" data-prov="ALIADOS DE INV. GORA SAS">GORA</button>
        </div>
        <div class="hint">Ambos se facturan siempre y generan cartera.</div>`, false);
    case "pago": {
      const { total } = saleTotals();
      const p = paymentState();
      const opts = catalog.paymentMethods
        .filter((m) => !m.isCredit)
        .map((m) => `<button class="choice sm" data-pay="${esc(m.code)}">${esc(m.name)}</button>`)
        .join("");
      const rows = sale.payments
        .map((pay, i) => `<div class="payrow"><span>${esc(methodByCode[pay.methodCode].name)}</span>
          <input type="text" inputmode="numeric" data-payamt="${i}" value="${money(pay.amount)}" />
          <button class="link" data-paydel="${i}">quitar</button></div>`)
        .join("");
      const balance = `Total ${money(total)} · Pagado ${money(p.paid)} · Falta ${money(p.falta)}` +
        (p.change > 0 ? ` · <b>Vueltas ${money(p.change)}</b>` : "");
      const warn = p.nonCashOver
        ? `<div class="warn-msg">Los pagos que no son efectivo no pueden superar el total. Ajusta los montos.</div>`
        : "";
      return card(key, "5 · Metodo(s) de pago", `
        <div class="choices wrap">${opts}</div>
        <div class="payrows">${rows}</div>
        <div class="paybalance">${balance}</div>
        ${warn}
        <button class="btn primary" id="payDone" ${p.canConfirm ? "" : "disabled"}>Confirmar pago</button>`, false);
    }
    case "tipoCliente": {
      return card(key, "6 · ¿Usuario directo o referido?", `
        <div class="choices">
          <button class="choice" data-ally="usuario">Usuario directo</button>
          <button class="choice" data-ally="referido">Referido</button>
        </div>
        <div id="refBox" class="grid2 hidden">
          <div class="lookup">
            <input id="refName" autocomplete="off" placeholder="Nombre del convenio/referido" />
            <div id="refSuggest" class="suggest hidden"></div>
          </div>
          <label class="chk"><input type="checkbox" id="refDisc" checked /> Aplica descuento</label>
          <button class="btn primary" id="refSave">Continuar</button>
        </div>`, false);
    }
    case "rtmHoy":
      return card(key, "7 · ¿Realiza la RTM hoy?", `
        <div class="choices">
          <button class="choice" data-today="si">Si, se realiza hoy</button>
          <button class="choice" data-today="no">No, queda pendiente</button>
        </div>`, false);
    case "resumen":
      return card(key, "8 · Resumen y registro", `
        <div class="hint">Revisa el resumen a la derecha.</div>
        <button class="btn success big" id="registerBtn">Registrar venta</button>`, false);
  }
  return "";
}

function renderDone(key) {
  const t = saleTotals();
  let body = "";
  switch (key) {
    case "cliente": body = `${esc(sale.client.name)} · ${esc(sale.client.docNumber)}`; break;
    case "moto": body = `${esc(sale.vehicle.plate)} · ${sale.vehicle.modelYear || "?"} · ${esc(packageForRange(sale.vehicle.rangeName)?.name || sale.vehicle.rangeName)}`; break;
    case "rtmPaid": body = sale.rtmAlreadyPaid ? "Ya esta paga" : "Se cobra ahora"; break;
    case "credito": body = sale.needsCredit ? "Con financiacion" : "Sin credito"; break;
    case "creditoProveedor": body = sale.creditProvider === "ADDI" ? "ADDI" : "GORA"; break;
    case "pago": body = sale.payments.map((p) => `${methodByCode[p.methodCode].name}: ${money(p.amount)}`).join(" · "); break;
    case "tipoCliente": body = sale.allyType === "usuario" ? "Usuario directo (fidelizado)" : `Referido: ${esc(sale.allyName)}${sale.discountApplied ? " (con descuento)" : ""}`; break;
    case "rtmHoy": body = sale.rtmToday ? "Se realiza hoy" : "Pendiente"; break;
    case "resumen": body = `Registrada ${esc(sale.registered?.sale?.saleNumber || "")}`; break;
  }
  return card(key, titleFor(key), body, true);
}
function titleFor(key) {
  return {
    cliente: "1 · Cliente", moto: "2 · Moto", rtmPaid: "3 · RTM paga", credito: "4 · Credito",
    creditoProveedor: "4b · Financiacion", pago: "5 · Pago", tipoCliente: "6 · Tipo cliente",
    rtmHoy: "7 · RTM hoy", resumen: "8 · Resumen"
  }[key];
}

function renderWizard() {
  const order = stepOrder();
  let html = "";
  let activeRendered = false;
  for (const key of order) {
    if (isDone(key)) { html += renderDone(key); continue; }
    if (!activeRendered) { html += renderActive(key); activeRendered = true; }
    break;
  }
  $("wizard").innerHTML = html + `<button class="link reset" id="newSale">Nueva venta</button>`;
  wireWizard();
}

// ---------- Resumen (panel derecho) ----------
function renderSummary() {
  const t = saleTotals();
  const rtmDone = sale.rtmAlreadyPaid || (sale.rtmToday && sale.rtmTodayAnswered);
  const provision = !rtmDone && sale.rtmTodayAnswered ? t.total : 0;
  const lines = t.lines.map((l) => `<tr><td>${esc(l.name)}</td><td class="r">${money(l.total)}</td></tr>`).join("");
  const reg = sale.registered;
  const costs = reg?.costs;
  $("summary").innerHTML = `
    <h3>Resumen</h3>
    <table class="mini"><tbody>${lines || '<tr><td class="hint">Sin paquete</td><td></td></tr>'}</tbody></table>
    <div class="amount"><span>Base</span><b>${money(t.base)}</b></div>
    <div class="amount"><span>IVA</span><b>${money(t.iva)}</b></div>
    <div class="amount total"><span>Total</span><b>${money(t.total)}</b></div>
    ${sale.payments.length ? `<div class="amount"><span>Pagado</span><b>${money(paidAmount())}</b></div>` : ""}
    ${paidAmount() > t.total ? `<div class="amount"><span>Vueltas</span><b>${money(paidAmount() - t.total)}</b></div>` : ""}
    ${provision ? `<div class="amount warn"><span>A provision</span><b>${money(provision)}</b></div>` : ""}
    ${costs ? `<div class="amount quiet"><span>Costos op.</span><b>${money(costs.costosTotal)}</b></div>` : ""}
    ${reg ? renderReceipt(reg) : ""}`;
  if (reg && !reg.sale.invoiceNumber) {
    $("invoiceBtn")?.addEventListener("click", emitInvoice);
  }
}
function renderReceipt(reg) {
  const s = reg.sale;
  const facturada = s.dianStatus === "facturada";
  return `<div class="receipt">
    <div><b>${esc(s.saleNumber)}</b> · ${esc(s.clientName)}</div>
    <div class="hint">Estado RTM: ${esc(s.rtmStatus)} · ${facturada ? `Factura ${esc(s.invoiceNumber)}` : "Sin facturar"}</div>
    ${facturada ? "" : `<button class="btn primary" id="invoiceBtn">Emitir factura</button>`}
  </div>`;
}

// ---------- Wiring ----------
function wireWizard() {
  $("newSale")?.addEventListener("click", () => { sale = blankSale(); render(); });
  document.querySelectorAll("[data-edit]").forEach((b) => b.addEventListener("click", () => resetFrom(b.dataset.edit)));

  // Cliente — autocompletado por documento o nombre
  const cDoc = $("cDoc");
  if (cDoc) {
    cDoc.addEventListener("input", onClientInput);
    cDoc.addEventListener("keydown", (e) => { if (e.key === "Enter") { hideSuggest(); findClient(); } });
    cDoc.addEventListener("blur", () => setTimeout(hideSuggest, 150));
  }
  $("cFind")?.addEventListener("click", findClient);
  $("cSave")?.addEventListener("click", saveNewClient);

  // Moto
  if ($("vPlate")) {
    const upd = () => {
      const year = Number($("vYear").value) || null;
      const range = year ? rangeFromModel(year) : "";
      $("vRange").textContent = range ? `Rango: ${range} · Paquete ${packageForRange(range)?.code || "?"}` : "";
    };
    $("vYear").addEventListener("input", upd); upd();
    attachSuggest($("vPlate"), $("vehicleSuggest"),
      async (q) => (await api.findVehicles({ plate: q })).map((v) => ({ title: v.plate, sub: `${v.modelYear || ""} ${v.rangeName || ""}`.trim(), raw: v })),
      (v) => selectVehicle(v));
    $("vNext").addEventListener("click", () => {
      const plate = $("vPlate").value.trim().toUpperCase();
      const year = Number($("vYear").value) || null;
      if (!plate) return toast("Ingresa la placa");
      const range = year ? rangeFromModel(year) : "MOTOCICLETAS 2024-2026";
      sale.vehicle = { plate, modelYear: year, rangeName: range };
      sale.packageCode = packageForRange(range)?.code || "";
      render();
    });
  }

  document.querySelectorAll("[data-rtmpaid]").forEach((b) => b.addEventListener("click", () => {
    sale.rtmAlreadyPaid = b.dataset.rtmpaid === "si";
    if (sale.rtmAlreadyPaid) { sale.rtmToday = true; sale.rtmTodayAnswered = true; }
    render();
  }));
  document.querySelectorAll("[data-credit]").forEach((b) => b.addEventListener("click", () => {
    sale.needsCredit = b.dataset.credit === "si"; render();
  }));
  document.querySelectorAll("[data-prov]").forEach((b) => b.addEventListener("click", () => {
    sale.creditProvider = b.dataset.prov;
    const { total } = saleTotals();
    sale.payments = [{ methodCode: b.dataset.prov, amount: total }];
    sale.paymentConfirmed = true;
    render();
  }));

  // Pago mixto — el nuevo metodo arranca con lo que falta (no el total completo)
  document.querySelectorAll("[data-pay]").forEach((b) => b.addEventListener("click", () => {
    const { total } = saleTotals();
    const remaining = Math.max(0, total - paidAmount());
    sale.payments.push({ methodCode: b.dataset.pay, amount: remaining });
    render();
  }));
  document.querySelectorAll("[data-payamt]").forEach((inp) => inp.addEventListener("change", () => {
    sale.payments[Number(inp.dataset.payamt)].amount = Math.round(Number(String(inp.value).replace(/[^\d]/g, "")) || 0); render();
  }));
  document.querySelectorAll("[data-paydel]").forEach((b) => b.addEventListener("click", () => {
    sale.payments.splice(Number(b.dataset.paydel), 1); render();
  }));
  $("payDone")?.addEventListener("click", () => {
    const p = paymentState();
    if (p.nonCashOver) return toast("Los pagos que no son efectivo no pueden superar el total");
    if (p.paid < p.total) return toast("Falta cubrir el total");
    sale.paymentConfirmed = true;
    render();
  });

  // Tipo cliente
  document.querySelectorAll("[data-ally]").forEach((b) => b.addEventListener("click", () => {
    if (b.dataset.ally === "usuario") {
      sale.allyType = "usuario"; sale.allyName = "USUARIO"; sale.discountApplied = true; sale.allyAnswered = true; render();
    } else {
      sale.allyType = "referido";
      $("refBox").classList.remove("hidden");
      attachSuggest($("refName"), $("refSuggest"),
        async (q) => (await api.findAllies(q)).map((a) => ({ title: a.name, sub: a.company || "", raw: a })),
        (a) => { $("refName").value = a.name; });
    }
  }));
  $("refSave")?.addEventListener("click", () => {
    const name = $("refName").value.trim();
    if (!name) return toast("Indica el referido");
    sale.allyName = name; sale.discountApplied = $("refDisc").checked; sale.allyAnswered = true; render();
  });

  document.querySelectorAll("[data-today]").forEach((b) => b.addEventListener("click", () => {
    sale.rtmToday = b.dataset.today === "si"; sale.rtmTodayAnswered = true; render();
  }));

  $("registerBtn")?.addEventListener("click", registerSale);
}

let clientMatches = {};
let clientSearchTimer;
function hideSuggest() {
  const s = $("clientSuggest");
  if (s) { s.classList.add("hidden"); s.innerHTML = ""; }
}
// Dropdown de sugerencias reutilizable. `search(q)` -> [{title, sub, raw}].
function attachSuggest(inputEl, boxEl, search, onPick) {
  if (!inputEl || !boxEl) return;
  let timer;
  inputEl.addEventListener("input", () => {
    const q = inputEl.value.trim();
    if (q.length < 2) { boxEl.classList.add("hidden"); boxEl.innerHTML = ""; return; }
    clearTimeout(timer);
    timer = setTimeout(async () => {
      try {
        const items = await search(q);
        if (!items.length) {
          boxEl.innerHTML = `<div class="suggest-empty">Sin coincidencias</div>`;
          boxEl.classList.remove("hidden");
          return;
        }
        boxEl.innerHTML = items
          .map((it, i) => `<div class="suggest-item" data-i="${i}"><b>${esc(it.title)}</b><span>${esc(it.sub || "")}</span></div>`)
          .join("");
        boxEl.classList.remove("hidden");
        boxEl.querySelectorAll("[data-i]").forEach((el) =>
          el.addEventListener("mousedown", (ev) => { ev.preventDefault(); boxEl.classList.add("hidden"); onPick(items[Number(el.dataset.i)].raw); })
        );
      } catch {}
    }, 180);
  });
  inputEl.addEventListener("blur", () => setTimeout(() => boxEl.classList.add("hidden"), 150));
}
function selectVehicle(v) {
  sale.vehicle = { plate: v.plate, modelYear: v.modelYear, rangeName: v.rangeName || rangeFromModel(v.modelYear) };
  sale.packageCode = packageForRange(sale.vehicle.rangeName)?.code || "";
  render();
}
function selectClient(c) {
  sale.client = { docNumber: c.docNumber, name: c.name, phone: c.phone, docType: c.docType };
  render();
}
async function onClientInput(e) {
  const q = e.target.value.trim();
  if (q.length < 2) return hideSuggest();
  clearTimeout(clientSearchTimer);
  clientSearchTimer = setTimeout(async () => {
    try {
      const items = await api.findClients(q);
      clientMatches = {};
      const box = $("clientSuggest");
      if (!box) return;
      if (!items.length) {
        box.innerHTML = `<div class="suggest-empty">Sin coincidencias · se registrara nuevo</div>`;
        box.classList.remove("hidden");
        return;
      }
      box.innerHTML = items
        .map((c) => {
          clientMatches[c.docNumber] = c;
          return `<div class="suggest-item" data-doc="${esc(c.docNumber)}"><b>${esc(c.name)}</b><span>${esc(c.docType || "")} ${esc(c.docNumber)}</span></div>`;
        })
        .join("");
      box.classList.remove("hidden");
      box.querySelectorAll("[data-doc]").forEach((el) =>
        el.addEventListener("mousedown", (ev) => { ev.preventDefault(); selectClient(clientMatches[el.dataset.doc]); })
      );
    } catch {}
  }, 180);
}
async function findClient() {
  const val = $("cDoc").value.trim();
  if (!val) return;
  if (clientMatches[val]) return selectClient(clientMatches[val]);
  try {
    const c = await api.getClient(val).catch(() => null);
    if (c) return selectClient(c);
    const items = await api.findClients(val);
    if (items.length === 1) return selectClient(items[0]);
    $("cResult").textContent = "No existe. Registra el cliente:";
    $("cNew").classList.remove("hidden");
    if (/^\d+$/.test(val)) { $("cNewDoc").value = val; $("cName").focus(); }
    else { $("cName").value = val; $("cNewDoc").focus(); }
  } catch (e) { toast(e.message); }
}
async function saveNewClient() {
  const docNumber = $("cNewDoc").value.trim();
  const name = $("cName").value.trim();
  if (!docNumber || !name) return toast("Documento y nombre obligatorios");
  try {
    const c = await api.saveClient({ docNumber, name, phone: $("cPhone").value.trim(), docType: /^\d{6,10}$/.test(docNumber) ? "CC" : "NIT" });
    selectClient(c);
  } catch (e) { toast(e.message); }
}
async function registerSale() {
  try {
    const body = {
      date: todayIso(),
      client: sale.client,
      vehicle: sale.vehicle,
      packageCode: sale.packageCode,
      rtmAlreadyPaid: sale.rtmAlreadyPaid,
      rtmToday: sale.rtmToday,
      ally: { name: sale.allyName, type: sale.allyType, discountApplied: sale.discountApplied },
      payments: sale.payments
    };
    const reg = await api.createSale(body);
    sale.registered = reg;
    toast(`Venta ${reg.sale.saleNumber} registrada`);
    render();
  } catch (e) { toast(e.message); }
}
async function emitInvoice() {
  try {
    const r = await api.invoice(sale.registered.sale.id);
    sale.registered.sale = r.sale;
    toast(`Factura ${r.sale.invoiceNumber} emitida`);
    render();
  } catch (e) { toast(e.message); }
}

function render() { renderWizard(); renderSummary(); }

// ---------- Otras vistas ----------
async function loadClosing() {
  const date = $("closingDate").value || todayIso();
  const gastos = Number($("closingGastos").value) || 0;
  try {
    const { closing, detail } = await api.closing(date, gastos);
    const c = closing;
    const methods = Object.entries(c.byMethod).map(([k, v]) => `<tr><td>${esc(k)}</td><td class="r">${money(v)}</td></tr>`).join("");
    const rows = detail.map((s) => `<tr><td>${esc(s.saleNumber)}</td><td>${esc(s.clientName)}</td><td>${esc(s.plate || "")}</td><td>${esc(s.rtmStatus)}</td><td class="r">${money(s.total)}</td></tr>`).join("");
    $("closingBody").innerHTML = `
      <div class="kpis">
        <div class="kpi"><span>Ventas</span><b>${money(c.salesTotal)}</b></div>
        <div class="kpi"><span>JASPER (gira Supergiros)</span><b>${money(c.jasper)}</b></div>
        <div class="kpi"><span>Provision</span><b>${money(c.provision)}</b></div>
        <div class="kpi"><span>Efectivo a entregar</span><b>${money(c.efectivoEntregar)}</b></div>
        <div class="kpi"><span>RTM realizadas</span><b>${c.rtmRealizadas}/${c.rtmFacturadas}</b></div>
        <div class="kpi"><span>Cartera abierta</span><b>${money(c.receivableOpen)}</b></div>
      </div>
      <div class="grid2">
        <div><h3>Ingresos por metodo</h3><table class="data"><tbody>${methods || '<tr><td class="hint">Sin pagos</td></tr>'}</tbody></table>
          <div class="amount"><span>Subtotal SG</span><b>${money(c.subtotalSG)}</b></div>
          <div class="amount"><span>Subtotal CM</span><b>${money(c.subtotalCM)}</b></div></div>
        <div><h3>Deducciones</h3>
          <div class="amount"><span>Fidelizacion</span><b>${money(c.fidelizacion)}</b></div>
          <div class="amount"><span>Referidos</span><b>${money(c.referidos)}</b></div>
          <div class="amount"><span>GORA</span><b>${money(c.egresos.gora)}</b></div>
          <div class="amount"><span>ADDI</span><b>${money(c.egresos.addi)}</b></div>
          <div class="amount total"><span>Diferencia Jasper</span><b>${money(c.diferenciaJasper)}</b></div></div>
      </div>
      <h3>Detalle del dia</h3>
      <table class="data"><thead><tr><th>Venta</th><th>Cliente</th><th>Placa</th><th>RTM</th><th class="r">Total</th></tr></thead><tbody>${rows || '<tr><td class="hint" colspan="5">Sin ventas</td></tr>'}</tbody></table>`;
  } catch (e) { toast(e.message); }
}
async function freezeClosing() {
  try {
    await api.saveClosing({ date: $("closingDate").value || todayIso(), gastos: Number($("closingGastos").value) || 0 });
    toast("Cierre congelado");
  } catch (e) { toast(e.message); }
}

async function loadReport() {
  const from = $("repFrom").value;
  const to = $("repTo").value;
  if (!from || !to) return;
  try {
    const { days, totals: t } = await api.report(from, to);
    const rows = days.map((d) => `<tr><td>${esc(d.date)}</td><td class="r">${money(d.salesTotal)}</td><td class="r">${money(d.jasper)}</td><td class="r">${money(d.provision)}</td><td class="r">${money(d.deducciones)}</td><td class="r">${money(d.efectivoEntregar)}</td><td class="r">${d.rtmRealizadas}/${d.rtmFacturadas}</td></tr>`).join("");
    $("reportBody").innerHTML = `
      <div class="kpis">
        <div class="kpi"><span>Ventas del periodo</span><b>${money(t.salesTotal)}</b></div>
        <div class="kpi"><span>JASPER total</span><b>${money(t.jasper)}</b></div>
        <div class="kpi"><span>Provision</span><b>${money(t.provision)}</b></div>
        <div class="kpi"><span>Deducciones</span><b>${money(t.deducciones)}</b></div>
        <div class="kpi"><span>Efectivo entregado</span><b>${money(t.efectivoEntregar)}</b></div>
        <div class="kpi"><span>RTM realizadas</span><b>${t.rtmRealizadas}/${t.rtmFacturadas}</b></div>
      </div>
      <table class="data"><thead><tr><th>Dia</th><th class="r">Ventas</th><th class="r">Jasper</th><th class="r">Provision</th><th class="r">Deducciones</th><th class="r">Efectivo</th><th class="r">RTM</th></tr></thead>
      <tbody>${rows || '<tr><td class="hint" colspan="7">Sin ventas en el rango</td></tr>'}</tbody>
      <tfoot><tr><td><b>Total</b></td><td class="r"><b>${money(t.salesTotal)}</b></td><td class="r"><b>${money(t.jasper)}</b></td><td class="r"><b>${money(t.provision)}</b></td><td class="r"><b>${money(t.deducciones)}</b></td><td class="r"><b>${money(t.efectivoEntregar)}</b></td><td></td></tr></tfoot>
      </table>`;
  } catch (e) { toast(e.message); }
}

async function loadPagoConv() {
  try {
    const { items, totals } = await api.allyPayments();
    $("pagoconvTotals").textContent = `Devengado ${money(totals.accrued)} · Pagado ${money(totals.paid)} · Pendiente ${money(totals.pending)}`;
    $("pagoconvBody").innerHTML = `<table class="data"><thead><tr><th>Convenio</th><th class="r">Devengado</th><th class="r">Pagado</th><th class="r">Pendiente</th></tr></thead><tbody>${
      items.map((a) => `<tr class="clickable" data-name="${esc(a.allyName)}" data-id="${a.allyId ?? ""}"><td>${esc(a.allyName)}</td><td class="r">${money(a.accrued)}</td><td class="r">${money(a.paid)}</td><td class="r"><b>${money(a.pending)}</b></td></tr>`).join("") || '<tr><td class="hint" colspan="4">Aun no hay comisiones de referidos</td></tr>'
    }</tbody></table>`;
    $("pagoconvBody").querySelectorAll("[data-name]").forEach((tr) => tr.addEventListener("click", () => loadPagoConvDetail(tr.dataset.name, tr.dataset.id || null)));
  } catch (e) { toast(e.message); }
}
let currentAlly = { name: null, id: null };
async function loadPagoConvDetail(name, allyId = null) {
  currentAlly = { name, id: allyId ? Number(allyId) : null };
  try {
    const d = await api.allyPaymentDetail(name);
    $("pagoconvName").textContent = name;
    const sales = d.sales.map((s) => `<tr><td>${esc(s.saleDate)}</td><td>${esc(s.plate || "")}</td><td>${esc(s.clientName)}</td><td>${s.pinAdquirido > 0 ? "Si" : "-"}</td><td class="r">${money(s.deduction)}</td></tr>`).join("");
    const pays = d.payments.map((p) => `<tr><td>${esc(p.paidDate)}</td><td>${esc(p.note || "")}</td><td class="r">${money(p.amount)}</td><td><button class="link" data-delpay="${p.id}">eliminar</button></td></tr>`).join("");
    $("pagoconvDetail").innerHTML = `
      <div class="kpis">
        <div class="kpi"><span>Devengado</span><b>${money(d.accrued)}</b></div>
        <div class="kpi"><span>Pagado</span><b>${money(d.paid)}</b></div>
        <div class="kpi"><span>Pendiente</span><b>${money(d.pending)}</b></div>
      </div>
      <h3>Registrar pago</h3>
      <div class="row">
        <input id="pc_amount" type="text" inputmode="numeric" placeholder="Valor" />
        <input id="pc_date" type="date" value="${todayIso()}" />
        <input id="pc_note" placeholder="Nota (opcional)" />
        <button class="btn success" id="pc_save">Pagar</button>
      </div>
      <h3>Historial de pagos</h3>
      <table class="data"><thead><tr><th>Fecha</th><th>Nota</th><th class="r">Valor</th><th></th></tr></thead><tbody>${pays || '<tr><td class="hint" colspan="4">Sin pagos registrados</td></tr>'}</tbody></table>
      <h3>Comisiones devengadas (${d.sales.length})</h3>
      <table class="data"><thead><tr><th>Fecha</th><th>Placa</th><th>Cliente</th><th>RTM</th><th class="r">Comision</th></tr></thead><tbody>${sales || '<tr><td class="hint" colspan="5">Sin comisiones</td></tr>'}</tbody></table>`;
    $("pc_save").addEventListener("click", () => addPagoConv(name));
    $("pagoconvDetail").querySelectorAll("[data-delpay]").forEach((b) => b.addEventListener("click", () => delPagoConv(Number(b.dataset.delpay), name)));
  } catch (e) { toast(e.message); }
}
async function addPagoConv(name) {
  const amount = Number(String($("pc_amount").value).replace(/[^\d]/g, "")) || 0;
  if (amount <= 0) return toast("Ingresa un valor");
  try {
    await api.addAllyPayment({ allyName: name, allyId: currentAlly.id, amount, paidDate: $("pc_date").value || todayIso(), note: $("pc_note").value.trim() });
    toast("Pago registrado");
    await loadPagoConvDetail(name);
    loadPagoConv();
  } catch (e) { toast(e.message); }
}
async function delPagoConv(id, name) {
  if (!confirm("¿Eliminar este pago?")) return;
  try { await api.deleteAllyPayment(id); toast("Pago eliminado"); await loadPagoConvDetail(name); loadPagoConv(); }
  catch (e) { toast(e.message); }
}

async function loadCartera() {
  try {
    const { items, open } = await api.receivables({ status: "abierta" });
    $("carteraOpen").textContent = `Abierto: ${money(open)}`;
    $("carteraBody").innerHTML = `<table class="data"><thead><tr><th>Proveedor</th><th>Cliente</th><th>Placa</th><th>Desde</th><th class="r">Pendiente</th><th></th></tr></thead><tbody>${
      items.map((r) => `<tr><td>${esc(r.provider)}</td><td>${esc(r.clientDoc)}</td><td>${esc(r.plate || "")}</td><td>${esc(r.dueFrom)}</td><td class="r">${money(r.pending)}</td><td><button class="link" data-pay="${r.id}">marcar pagada</button></td></tr>`).join("") || '<tr><td class="hint" colspan="6">Sin cartera abierta</td></tr>'
    }</tbody></table>`;
    document.querySelectorAll("[data-pay]").forEach((b) => b.addEventListener("click", async () => {
      await api.payReceivable(Number(b.dataset.pay)); loadCartera();
    }));
  } catch (e) { toast(e.message); }
}

async function loadConvenios(q = "") {
  try {
    const items = await api.findAllies(q);
    $("conveniosBody").innerHTML = `<table class="data"><thead><tr><th>Nombre</th><th>Contacto</th><th>Empresa</th><th class="r">Comision</th><th>Inscrito</th></tr></thead><tbody>${
      items.map((a) => `<tr class="clickable" data-ally='${esc(JSON.stringify(a))}'><td>${esc(a.name)}</td><td>${esc(a.contactPhone || "")}</td><td>${esc(a.company || "")}</td><td class="r">${money(a.commission)}</td><td>${a.enrolled ? "Si" : "-"}</td></tr>`).join("") || '<tr><td class="hint" colspan="5">Sin convenios</td></tr>'
    }</tbody></table>`;
    $("conveniosBody").querySelectorAll("[data-ally]").forEach((tr) => tr.addEventListener("click", () => renderAllyForm(JSON.parse(tr.dataset.ally))));
  } catch (e) { toast(e.message); }
}
const ALLY_FIELDS = [
  ["name", "Nombre completo", "text"],
  ["company", "Empresa", "text"],
  ["contactPhone", "Telefono", "text"],
  ["altPhone", "Telefono alterno", "text"],
  ["docType", "Tipo documento", "text"],
  ["docNumber", "Numero documento", "text"],
  ["paymentMethod", "Metodo de pago", "text"],
  ["accountNumber", "Numero de cuenta", "text"],
  ["holderDocType", "Tipo doc titular", "text"],
  ["holderDoc", "Documento titular", "text"],
  ["address", "Direccion", "text"],
  ["commission", "Comision", "number"]
];
function renderAllyForm(a) {
  const ally = a || { commission: 40000, enrolled: false, isDirectUser: false, active: true };
  $("allyFormTitle").textContent = a ? `Editar: ${a.name}` : "Nuevo convenio";
  const fields = ALLY_FIELDS.map(([k, label, type]) =>
    `<label class="fld">${label}<input id="af_${k}" type="${type}" value="${esc(ally[k] ?? "")}" /></label>`
  ).join("");
  $("allyForm").innerHTML = `
    <div class="form-grid">${fields}</div>
    <label class="fld">Observacion<textarea id="af_observation">${esc(ally.observation ?? "")}</textarea></label>
    <label class="fld">Notas<textarea id="af_notes">${esc(ally.notes ?? "")}</textarea></label>
    <div class="row form-checks">
      <label class="chk"><input type="checkbox" id="af_enrolled" ${ally.enrolled ? "checked" : ""} /> Inscrito</label>
      <label class="chk"><input type="checkbox" id="af_isDirectUser" ${ally.isDirectUser ? "checked" : ""} /> Usuario directo</label>
      <label class="chk"><input type="checkbox" id="af_active" ${ally.active !== false ? "checked" : ""} /> Activo</label>
    </div>
    <div class="row form-actions">
      <button class="btn success" id="allySave">${a ? "Guardar cambios" : "Crear convenio"}</button>
      ${a ? `<button class="btn danger" id="allyDelete">Eliminar</button>` : ""}
    </div>`;
  $("allySave").addEventListener("click", () => saveAlly(a?.id));
  if (a) $("allyDelete").addEventListener("click", () => deleteAlly(a.id, a.name));
}
function readAllyForm() {
  const body = {};
  ALLY_FIELDS.forEach(([k, , type]) => {
    const v = $(`af_${k}`).value.trim();
    body[k] = type === "number" ? Number(v) || 0 : v;
  });
  body.observation = $("af_observation").value.trim();
  body.notes = $("af_notes").value.trim();
  body.enrolled = $("af_enrolled").checked;
  body.isDirectUser = $("af_isDirectUser").checked;
  body.active = $("af_active").checked;
  return body;
}
async function saveAlly(id) {
  const body = readAllyForm();
  if (!body.name) return toast("El nombre es obligatorio");
  try {
    const saved = id ? await api.updateAlly(id, body) : await api.saveAlly(body);
    toast(id ? "Convenio actualizado" : "Convenio creado");
    await loadConvenios($("allySearch").value || "");
    renderAllyForm(saved);
  } catch (e) { toast(e.message); }
}
async function deleteAlly(id, name) {
  if (!confirm(`¿Eliminar el convenio "${name}"?`)) return;
  try {
    await api.deleteAlly(id);
    toast("Convenio eliminado");
    $("allyForm").innerHTML = `<p class="hint">Selecciona un convenio o crea uno nuevo.</p>`;
    $("allyFormTitle").textContent = "Detalle del convenio";
    await loadConvenios($("allySearch").value || "");
  } catch (e) { toast(e.message); }
}

async function loadVentas() {
  const date = $("ventasDate").value;
  const q = ($("ventasSearch").value || "").trim().toLowerCase();
  try {
    let items = await api.listSales(date ? { date } : {});
    if (q) {
      items = items.filter((s) =>
        (s.clientName || "").toLowerCase().includes(q) ||
        (s.plate || "").toLowerCase().includes(q) ||
        (s.saleNumber || "").toLowerCase().includes(q) ||
        (s.invoiceNumber || "").toLowerCase().includes(q)
      );
    }
    const total = items.reduce((s, v) => s + v.total, 0);
    $("ventasSummary").textContent = `${items.length} ventas${date ? " · " + date : " · todas"} · ${money(total)}`;
    $("ventasBody").innerHTML = `<table class="data"><thead><tr><th>Fecha</th><th>Venta</th><th>Cliente</th><th>Placa</th><th>Tipo</th><th>RTM</th><th>Factura</th><th class="r">Total</th><th>Estado</th><th></th></tr></thead><tbody>${
      items.map((s) => {
        const anulada = s.status === "anulada";
        const canVoid = !anulada && api.currentUser()?.role === "admin";
        return `<tr style="${anulada ? "opacity:.5;text-decoration:line-through" : ""}"><td>${esc(s.saleDate)}</td><td>${esc(s.saleNumber)}</td><td>${esc(s.clientName)}</td><td>${esc(s.plate || "")}</td><td>${esc(s.allyType)}</td><td>${esc(s.rtmStatus)}</td><td>${esc(s.invoiceNumber || "-")}</td><td class="r">${money(s.total)}</td><td>${anulada ? "anulada" : "activa"}</td><td>${canVoid ? `<button class="link" data-void="${s.id}">anular</button>` : ""}</td></tr>`;
      }).join("") || '<tr><td class="hint" colspan="10">Sin ventas</td></tr>'
    }</tbody></table>`;
    $("ventasBody").querySelectorAll("[data-void]").forEach((b) => b.addEventListener("click", () => voidSaleUI(Number(b.dataset.void))));
  } catch (e) { toast(e.message); }
}
async function voidSaleUI(id) {
  const reason = prompt("Motivo de la anulacion:");
  if (reason === null) return;
  const authorizedBy = prompt("Autorizado por (codigo/nombre):") || "";
  try {
    await api.voidSale(id, { reason, authorizedBy });
    toast("Venta anulada");
    loadVentas();
  } catch (e) { toast(e.message); }
}

// ---------- Navegacion ----------
const VIEW_TITLES = { venta: "Venta", cierre: "Cierre diario", consolidado: "Consolidado", cartera: "Cartera", pagoconv: "Pagos a convenios", clientes: "Clientes", convenios: "Convenios", ventas: "Ventas", usuarios: "Usuarios" };
function switchView(view) {
  document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t.dataset.view === view));
  document.querySelectorAll(".view").forEach((v) => v.classList.toggle("active", v.id === `view-${view}`));
  $("pageTitle").textContent = VIEW_TITLES[view] || "";
  if (view === "cierre") loadClosing();
  if (view === "consolidado") loadReport();
  if (view === "cartera") loadCartera();
  if (view === "pagoconv") loadPagoConv();
  if (view === "clientes") loadClientes();
  if (view === "convenios") loadConvenios();
  if (view === "ventas") loadVentas();
  if (view === "usuarios") loadUsuarios();
}

// ---------- Usuarios (admin) ----------
async function loadUsuarios() {
  try {
    const users = await api.listUsers();
    $("usuariosBody").innerHTML = `<table class="data"><thead><tr><th>Usuario</th><th>Nombre</th><th>Rol</th><th>Activo</th></tr></thead><tbody>${
      users.map((u) => `<tr class="clickable" data-user='${esc(JSON.stringify(u))}'><td>${esc(u.username)}</td><td>${esc(u.name)}</td><td>${esc(u.role)}</td><td>${u.active ? "Si" : "-"}</td></tr>`).join("")
    }</tbody></table>`;
    $("usuariosBody").querySelectorAll("[data-user]").forEach((tr) => tr.addEventListener("click", () => renderUserForm(JSON.parse(tr.dataset.user))));
  } catch (e) { toast(e.message); }
}
function renderUserForm(u) {
  $("userFormTitle").textContent = u ? `Editar: ${u.username}` : "Nuevo usuario";
  $("userForm").innerHTML = `
    <div class="form-grid">
      <label class="fld">Usuario<input id="us_username" value="${esc(u?.username || "")}" ${u ? "disabled" : ""} /></label>
      <label class="fld">Nombre<input id="us_name" value="${esc(u?.name || "")}" /></label>
      <label class="fld">Rol
        <select id="us_role">
          <option value="vendedor" ${u?.role === "vendedor" ? "selected" : ""}>Vendedor</option>
          <option value="admin" ${u?.role === "admin" ? "selected" : ""}>Administrador</option>
        </select>
      </label>
      <label class="fld">${u ? "Nueva clave (opcional)" : "Clave"}<input id="us_password" type="password" /></label>
    </div>
    <div class="row form-checks"><label class="chk"><input type="checkbox" id="us_active" ${!u || u.active ? "checked" : ""} /> Activo</label></div>
    <div class="row form-actions">
      <button class="btn success" id="userSave">${u ? "Guardar" : "Crear usuario"}</button>
      ${u ? `<button class="btn danger" id="userDelete">Eliminar</button>` : ""}
    </div>`;
  $("userSave").addEventListener("click", () => saveUser(u?.id));
  if (u) $("userDelete").addEventListener("click", () => deleteUserUI(u.id, u.username));
}
async function saveUser(id) {
  const body = {
    username: $("us_username").value.trim(),
    name: $("us_name").value.trim(),
    role: $("us_role").value,
    active: $("us_active").checked
  };
  const pass = $("us_password").value;
  if (pass) body.password = pass;
  if (!body.username || !body.name || (!id && !pass)) return toast("Usuario, nombre y clave obligatorios");
  try {
    const saved = id ? await api.updateUser(id, body) : await api.createUser(body);
    toast(id ? "Usuario actualizado" : "Usuario creado");
    await loadUsuarios();
    renderUserForm(saved);
  } catch (e) { toast(e.message); }
}
async function deleteUserUI(id, username) {
  if (!confirm(`¿Eliminar al usuario "${username}"?`)) return;
  try {
    await api.deleteUser(id);
    toast("Usuario eliminado");
    $("userForm").innerHTML = `<p class="hint">Selecciona un usuario o crea uno nuevo.</p>`;
    $("userFormTitle").textContent = "Detalle";
    await loadUsuarios();
  } catch (e) { toast(e.message); }
}

async function loadClientes(q = "") {
  try {
    const items = await api.findClients(q);
    $("clientesBody").innerHTML = `<table class="data"><thead><tr><th>Documento</th><th>Nombre</th><th>Telefono</th></tr></thead><tbody>${
      items.map((c) => `<tr class="clickable" data-doc="${esc(c.docNumber)}"><td>${esc(c.docType || "")} ${esc(c.docNumber)}</td><td>${esc(c.name)}</td><td>${esc(c.phone || "")}</td></tr>`).join("") || '<tr><td class="hint" colspan="3">Sin clientes</td></tr>'
    }</tbody></table>`;
    $("clientesBody").querySelectorAll("[data-doc]").forEach((tr) => tr.addEventListener("click", () => loadClientDetail(tr.dataset.doc)));
  } catch (e) { toast(e.message); }
}
async function loadClientDetail(doc) {
  try {
    const c = await api.getClient(doc);
    $("clientDetailName").textContent = c.name;
    const veh = c.vehicles || [];
    $("clientDetailBody").innerHTML = `
      <div class="form-grid">
        <label class="fld">Nombre<input id="cl_name" value="${esc(c.name)}" /></label>
        <label class="fld">Telefono<input id="cl_phone" value="${esc(c.phone || "")}" /></label>
        <label class="fld">Email<input id="cl_email" value="${esc(c.email || "")}" /></label>
        <label class="fld">Direccion<input id="cl_address" value="${esc(c.address || "")}" /></label>
      </div>
      <div class="detail-meta">${esc(c.docType || "")} ${esc(c.docNumber)}</div>
      <div class="row form-actions">
        <button class="btn success" id="clSave">Guardar cliente</button>
        <button class="btn danger" id="clDelete">Eliminar</button>
      </div>
      <h3>Motos / placas (${veh.length})</h3>
      <table class="data"><thead><tr><th>Placa</th><th>Año</th><th>Rango</th><th></th></tr></thead><tbody>${
        veh.map((v) => `<tr><td><b>${esc(v.plate)}</b></td><td>${v.modelYear || "-"}</td><td>${esc(v.rangeName || "")}</td><td><button class="link" data-delveh="${v.id}">eliminar</button></td></tr>`).join("") || '<tr><td class="hint" colspan="4">Sin motos registradas</td></tr>'
      }</tbody></table>
      <div class="row" style="margin-top:12px">
        <input id="cl_newplate" placeholder="Nueva placa" style="text-transform:uppercase" />
        <input id="cl_newyear" type="number" placeholder="Año" min="1980" max="2035" />
        <button class="btn" id="clAddVeh">Agregar moto</button>
      </div>`;
    $("clSave").addEventListener("click", () => saveClientEdit(c.docNumber));
    $("clDelete").addEventListener("click", () => deleteClientUI(c.docNumber, c.name));
    $("clAddVeh").addEventListener("click", () => addVehicleUI(c.docNumber));
    $("clientDetailBody").querySelectorAll("[data-delveh]").forEach((b) => b.addEventListener("click", () => delVehicleUI(Number(b.dataset.delveh), c.docNumber)));
  } catch (e) { toast(e.message); }
}
async function saveClientEdit(doc) {
  try {
    await api.saveClient({ docNumber: doc, name: $("cl_name").value.trim(), phone: $("cl_phone").value.trim(), email: $("cl_email").value.trim(), address: $("cl_address").value.trim() });
    toast("Cliente guardado");
    loadClientes($("clientListSearch").value || "");
    loadClientDetail(doc);
  } catch (e) { toast(e.message); }
}
async function deleteClientUI(doc, name) {
  if (!confirm(`¿Eliminar a "${name}" y sus motos?`)) return;
  try {
    await api.deleteClient(doc);
    toast("Cliente eliminado");
    $("clientDetailBody").innerHTML = `<p class="hint">Selecciona un cliente para ver sus motos y placas.</p>`;
    $("clientDetailName").textContent = "Motos / placas";
    loadClientes($("clientListSearch").value || "");
  } catch (e) { toast(e.message); }
}
async function addVehicleUI(doc) {
  const plate = $("cl_newplate").value.trim().toUpperCase();
  const year = Number($("cl_newyear").value) || null;
  if (!plate) return toast("Ingresa la placa");
  try { await api.saveVehicle({ clientDoc: doc, plate, modelYear: year }); toast("Moto agregada"); loadClientDetail(doc); }
  catch (e) { toast(e.message); }
}
async function delVehicleUI(id, doc) {
  if (!confirm("¿Eliminar esta moto?")) return;
  try { await api.deleteVehicle(id); toast("Moto eliminada"); loadClientDetail(doc); }
  catch (e) { toast(e.message); }
}
function renderNewClientForm() {
  $("clientDetailName").textContent = "Nuevo cliente";
  $("clientDetailBody").innerHTML = `
    <div class="form-grid">
      <label class="fld">Documento<input id="cl_newdoc" /></label>
      <label class="fld">Nombre<input id="cl_name" /></label>
      <label class="fld">Telefono<input id="cl_phone" /></label>
      <label class="fld">Email<input id="cl_email" /></label>
      <label class="fld">Direccion<input id="cl_address" /></label>
    </div>
    <div class="row form-actions"><button class="btn success" id="clCreate">Crear cliente</button></div>`;
  $("clCreate").addEventListener("click", createClientUI);
}
async function createClientUI() {
  const docNumber = $("cl_newdoc").value.trim();
  const name = $("cl_name").value.trim();
  if (!docNumber || !name) return toast("Documento y nombre obligatorios");
  try {
    await api.saveClient({ docNumber, name, phone: $("cl_phone").value.trim(), email: $("cl_email").value.trim(), address: $("cl_address").value.trim(), docType: /^\d{6,10}$/.test(docNumber) ? "CC" : "NIT" });
    toast("Cliente creado");
    loadClientes();
    loadClientDetail(docNumber);
  } catch (e) { toast(e.message); }
}

let toastTimer;
function toast(msg) {
  const t = $("toast");
  t.textContent = msg; t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 2600);
}

function applyRole() {
  const u = api.currentUser();
  $("userBox").innerHTML = u
    ? `<div class="uname">${esc(u.name)}</div><div class="urole">${esc(u.role)}</div><button class="link" id="logoutBtn">Cerrar sesion</button>`
    : "";
  $("logoutBtn")?.addEventListener("click", logout);
  const isAdmin = u?.role === "admin";
  document.querySelectorAll(".admin-only").forEach((el) => el.classList.toggle("hidden", !isAdmin));
}
function showLogin() { $("loginOverlay").classList.remove("hidden"); $("appShell").classList.add("hidden"); }
function showApp() { $("loginOverlay").classList.add("hidden"); $("appShell").classList.remove("hidden"); }
function logout() { api.logout(); showLogin(); }

let started = false;
async function startApp() {
  showApp();
  applyRole();
  if (started) { switchView("venta"); render(); return; }
  started = true;
  $("closingDate").value = todayIso();
  $("ventasDate").value = todayIso();
  $("topbarMeta").textContent = new Date().toLocaleDateString("es-CO", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
  $("tabs").addEventListener("click", (e) => { const t = e.target.closest(".tab"); if (t?.dataset.view) switchView(t.dataset.view); });
  $("loadClosing").addEventListener("click", loadClosing);
  $("freezeClosing").addEventListener("click", freezeClosing);
  const monthStart = todayIso().slice(0, 8) + "01";
  $("repFrom").value = monthStart;
  $("repTo").value = todayIso();
  $("loadReport").addEventListener("click", loadReport);
  $("ventasDate").addEventListener("change", loadVentas);
  $("ventasSearch").addEventListener("input", loadVentas);
  $("ventasAll").addEventListener("click", () => { $("ventasDate").value = ""; loadVentas(); });
  $("allySearch").addEventListener("input", (e) => loadConvenios(e.target.value));
  $("allyNew").addEventListener("click", () => renderAllyForm(null));
  $("clientListSearch").addEventListener("input", (e) => loadClientes(e.target.value));
  $("clientNew").addEventListener("click", renderNewClientForm);
  $("userNew").addEventListener("click", () => renderUserForm(null));
  try {
    catalog = await api.catalog();
    catalog.products.forEach((p) => (productByCode[p.code] = p));
    catalog.paymentMethods.forEach((m) => (methodByCode[m.code] = m));
    $("connStatus").textContent = "conectado";
    $("connStatus").classList.add("ok");
  } catch (e) {
    $("connStatus").textContent = "sin conexion API";
  }
  render();
}

function boot() {
  $("loginForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    $("loginError").textContent = "";
    try {
      await api.login($("loginUser").value.trim(), $("loginPass").value);
      await startApp();
    } catch (err) {
      $("loginError").textContent = err.message;
    }
  });
  document.addEventListener("motopos:unauthorized", showLogin);
  if (api.hasToken()) startApp();
  else showLogin();
}
boot();
