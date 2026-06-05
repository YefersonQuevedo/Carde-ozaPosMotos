import { api } from "./api.js";

const money = (n) => new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 }).format(Math.round(Number(n) || 0));
const todayIso = () => new Date().toISOString().slice(0, 10);
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const readCop = (id) => Math.round(Number(String($(id)?.value || "").replace(/[^\d]/g, "")) || 0);
// Descarga un Blob (export a Excel). Si el navegador lo soporta (Chrome/Edge),
// abre el dialogo "Guardar como" para elegir la carpeta; si no, descarga normal.
async function downloadBlob(blob, filename) {
  if (window.showSaveFilePicker) {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: filename,
        types: [{ description: "Excel", accept: { "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [".xlsx"] } }]
      });
      const w = await handle.createWritable();
      await w.write(blob);
      await w.close();
      return;
    } catch (e) {
      if (e && e.name === "AbortError") return; // el usuario cancelo el dialogo
      // Otro error (p.ej. gesto expirado): cae a la descarga clasica.
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

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
    provisionChecked: false, // ya se busco provision para este cliente
    provisionMatches: [],    // provisiones abiertas encontradas
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
    // Se verifica si el cliente ya tiene una provision (pago previo). Si no hay y el
    // usuario decide continuar, el paso cambia a "se cobra ahora" (rtmAlreadyPaid=false).
    o.push("provisionCheck");
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
    case "provisionCheck": return !!sale.registered;
    case "resumen": return !!sale.registered;
    default: return false;
  }
}

// Al editar un paso, se reinicia ese dato y los posteriores dependientes.
function resetFrom(key) {
  const fields = {
    cliente: () => { sale.client = null; },
    moto: () => { sale.vehicle = { plate: "", modelYear: null, rangeName: "" }; sale.packageCode = ""; },
    rtmPaid: () => { sale.rtmAlreadyPaid = null; sale.needsCredit = null; sale.creditProvider = null; sale.payments = []; sale.paymentConfirmed = false; sale.provisionChecked = false; sale.provisionMatches = []; },
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
    case "provisionCheck": {
      const search = `
        <div class="row" style="margin-top:8px">
          <input id="provSearch" placeholder="Buscar por placa o cedula" value="${esc(sale.vehicle.plate || "")}" style="text-transform:uppercase" />
          <button class="btn" id="provSearchBtn">Buscar provision</button>
        </div>`;
      if (sale.provisionMatches.length) {
        const rows = sale.provisionMatches.map((p) => `
          <div class="payrow">
            <span><b>${esc(p.plate)}</b> · ${esc(p.clientName)} · ${money(p.amount)}${p.allyType === "referido" ? " · ref: " + esc(p.allyName || "") : " · directo"} · ${esc(p.saleDate)}</span>
            <button class="btn success sm" data-consume="${p.saleId}">Realizar RTM</button>
          </div>`).join("");
        return card(key, "Provision encontrada ✓", `
          <div class="hint">Este cliente tiene RTM pagada(s) y pendiente(s). Al realizarla NO se recalcula comision ni valor: se consume la provision.</div>
          <div class="payrows">${rows}</div>
          ${search}
          <button class="link" id="provContinue">No es ninguna de estas, crear venta nueva</button>`, false);
      }
      return card(key, "Verificar provision", `
        <div class="warn-msg">Este cliente <b>${esc(sale.client?.name || "")}</b> no tiene ninguna RTM provisionada (pagada y pendiente). Puedes buscar por placa/cedula o crear una venta nueva.</div>
        ${search}
        <button class="btn primary" id="provContinue" style="margin-top:8px">Crear venta nueva</button>`, false);
    }
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
    case "provisionCheck": body = `Provision consumida · ${esc(sale.registered?.sale?.saleNumber || "")}`; break;
    case "resumen": body = `Registrada ${esc(sale.registered?.sale?.saleNumber || "")}`; break;
  }
  return card(key, titleFor(key), body, true);
}
function titleFor(key) {
  return {
    cliente: "1 · Cliente", moto: "2 · Moto", rtmPaid: "3 · RTM paga", credito: "4 · Credito",
    creditoProveedor: "4b · Financiacion", pago: "5 · Pago", tipoCliente: "6 · Tipo cliente",
    rtmHoy: "7 · RTM hoy", provisionCheck: "Provision", resumen: "8 · Resumen"
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

  document.querySelectorAll("[data-rtmpaid]").forEach((b) => b.addEventListener("click", async () => {
    sale.rtmAlreadyPaid = b.dataset.rtmpaid === "si";
    if (sale.rtmAlreadyPaid) {
      sale.rtmToday = true; sale.rtmTodayAnswered = true;
      // Buscar provisiones del CLIENTE (cualquiera de sus placas), no solo la placa tecleada,
      // para no recalcular comision ni valor de una RTM que ya pago.
      sale.provisionMatches = [];
      const doc = sale.client?.docNumber;
      if (doc) {
        try { const r = await api.provisions({ clientDoc: doc }); sale.provisionMatches = r.items || []; } catch {}
      }
      sale.provisionChecked = true;
    }
    render();
  }));
  document.querySelectorAll("[data-consume]").forEach((b) => b.addEventListener("click", () => consumeProvisionUI(Number(b.dataset.consume))));
  $("provSearchBtn")?.addEventListener("click", async () => {
    const q = ($("provSearch").value || "").trim().toUpperCase();
    if (!q) return;
    const params = /^\d+$/.test(q) ? { clientDoc: q } : { plate: q };
    try { const r = await api.provisions(params); sale.provisionMatches = r.items || []; if (!sale.provisionMatches.length) toast("Sin provision para ese criterio"); render(); }
    catch (e) { toast(e.message); }
  });
  $("provContinue")?.addEventListener("click", () => {
    // Sin provision: la RTM no estaba realmente paga -> se cobra ahora (paso 3 cambia).
    sale.rtmAlreadyPaid = false;
    sale.rtmToday = true; sale.rtmTodayAnswered = false;
    sale.provisionMatches = [];
    render();
  });
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
// Consume la provision de una placa ya pagada (no recalcula comision ni valor).
async function consumeProvisionUI(saleId) {
  try {
    const r = await api.realizeProvision(saleId, { date: todayIso() });
    sale.registered = { sale: r.sale, costs: r.costs };
    toast(`Provision consumida · RTM realizada (${r.sale.saleNumber})`);
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
    const methods = Object.entries(c.byMethod).map(([k, v]) => `<tr><td>${esc(k)}</td><td class="r">${(c.countByMethod && c.countByMethod[k]) || 0}</td><td class="r">${money(v)}</td></tr>`).join("");
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
        <div><h3>Ingresos por metodo</h3><table class="data"><thead><tr><th>Metodo</th><th class="r">Cant.</th><th class="r">Valor</th></tr></thead><tbody>${methods || '<tr><td class="hint" colspan="3">Sin pagos</td></tr>'}</tbody></table>
          <div class="amount"><span>Subtotal SG</span><b>${money(c.subtotalSG)}</b></div>
          <div class="amount"><span>Subtotal CM</span><b>${money(c.subtotalCM)}</b></div></div>
        <div><h3>Deducciones</h3>
          <div class="amount"><span>Fidelizacion</span><b>${money(c.fidelizacion)}</b></div>
          <div class="amount"><span>Referidos</span><b>${money(c.referidos)}</b></div>
          <div class="amount"><span>GORA</span><b>${money(c.egresos.gora)}</b></div>
          <div class="amount"><span>ADDI</span><b>${money(c.egresos.addi)}</b></div>
          <div class="amount total"><span>Diferencia Jasper</span><b>${money(c.diferenciaJasper)}</b></div></div>
      </div>
      <h3>Desglose (de donde sale cada numero)</h3>
      <div class="amount"><span>Subtotal CM ${money(c.subtotalCM)} − Provision ${money(c.provision)}</span><b>JASPER ${money(c.jasper)}</b></div>
      <div class="amount"><span>Efectivo ${money(c.efectivo)} − Fideliz. ${money(c.fidelizacion)} − Gastos ${money(c.gastos)} − Referidos ${money(c.referidos)}</span><b>Efectivo a entregar ${money(c.efectivoEntregar)}</b></div>
      <div class="amount total"><span>JASPER ${money(c.jasper)} − Efectivo entregado ${money(c.efectivoEntregar)}</span><b>Diferencia ${money(c.diferenciaJasper)} (≈ comisiones)</b></div>
      <h3>Detalle del dia</h3>
      <table class="data"><thead><tr><th>Venta</th><th>Cliente</th><th>Placa</th><th>RTM</th><th class="r">Total</th></tr></thead><tbody>${rows || '<tr><td class="hint" colspan="5">Sin ventas</td></tr>'}</tbody></table>`;
  } catch (e) { toast(e.message); }
}
async function exportClosingUI() {
  try {
    const date = $("closingDate").value || todayIso();
    const gastos = Number($("closingGastos").value) || 0;
    const blob = await api.exportClosing(date, gastos);
    await downloadBlob(blob, `cierre-${date}.xlsx`);
  } catch (e) { toast(e.message); }
}
async function exportReportUI() {
  try {
    const from = $("repFrom").value, to = $("repTo").value;
    if (!from || !to) return toast("Elige el rango de fechas");
    const blob = await api.exportConsolidado(from, to);
    await downloadBlob(blob, `consolidado-${from}_${to}.xlsx`);
  } catch (e) { toast(e.message); }
}
async function exportVentasUI() {
  try {
    const date = $("ventasDate").value;
    const blob = await api.exportSales(date ? { date } : {});
    await downloadBlob(blob, `ventas${date ? "-" + date : ""}.xlsx`);
  } catch (e) { toast(e.message); }
}
async function freezeClosing() {
  try {
    await api.saveClosing({ date: $("closingDate").value || todayIso(), gastos: Number($("closingGastos").value) || 0 });
    toast("Cierre del día guardado");
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
let currentAllyDetail = null;
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

// Implementacion extendida de pagos a convenios (revision 2026-06-04).
loadPagoConv = async function () {
  try {
    const { items, totals } = await api.allyPayments();
    $("pagoconvTotals").textContent = `Devengado ${money(totals.accrued)} · Pagado ${money(totals.paid)} · Pendiente ${money(totals.pending)}`;
    $("pagoconvBody").innerHTML = `<table class="data"><thead><tr><th>Convenio</th><th class="r">RTM</th><th class="r">Placas</th><th class="r">Devengado</th><th class="r">Pagado</th><th class="r">Pendiente</th></tr></thead><tbody>${
      items.map((a) => `<tr class="clickable" data-name="${esc(a.allyName)}" data-id="${a.allyId ?? ""}"><td>${esc(a.allyName)}</td><td class="r">${a.convenioCount || a.rtm || 0}</td><td class="r">${a.plateCount || 0}</td><td class="r">${money(a.accrued)}</td><td class="r">${money(a.paid)}</td><td class="r"><b>${money(a.pending)}</b></td></tr>`).join("") || '<tr><td class="hint" colspan="6">Aun no hay comisiones de referidos</td></tr>'
    }</tbody></table>`;
    $("pagoconvBody").querySelectorAll("[data-name]").forEach((tr) => tr.addEventListener("click", () => loadPagoConvDetail(tr.dataset.name, tr.dataset.id || null)));
  } catch (e) { toast(e.message); }
};

loadPagoConvDetail = async function (name, allyId = null) {
  currentAlly = { name, id: allyId ? Number(allyId) : null };
  try {
    const d = await api.allyPaymentDetail(name);
    currentAllyDetail = d;
    $("pagoconvName").textContent = name;
    const plates = d.plates || [];
    const allyDoc = d.ally?.docNumber || d.ally?.holderDoc || "";
    const sales = d.sales.map((s) => `<tr><td>${esc(s.saleDate)}</td><td>${esc(s.plate || "")}</td><td>${esc(s.clientName)}</td><td>${esc(s.invoiceNumber || s.saleNumber || "")}</td><td>${s.pinAdquirido > 0 ? "Si" : "-"}</td><td class="r">${money(s.deduction)}</td></tr>`).join("");
    const pays = d.payments.map((p) => {
      const payPlates = Array.isArray(p.plates) ? p.plates : [];
      const voucher = p.voucherPath ? `<a class="link" href="${esc(p.voucherPath)}" target="_blank">ver</a>` : "-";
      return `<tr><td>${esc(p.paidDate)}</td><td>${esc(p.invoiceNumber || "-")}</td><td>${voucher}</td><td class="r">${p.convenioCount || payPlates.length || 0}</td><td class="r">${money(p.amount)}</td><td>${esc(p.note || "")}</td><td><button class="link" data-printpay="${p.id}">imprimir</button> <button class="link" data-delpay="${p.id}">eliminar</button></td></tr>`;
    }).join("");
    $("pagoconvDetail").innerHTML = `
      <div class="kpis">
        <div class="kpi"><span>Devengado</span><b>${money(d.accrued)}</b></div>
        <div class="kpi"><span>Pagado</span><b>${money(d.paid)}</b></div>
        <div class="kpi"><span>Pendiente</span><b>${money(d.pending)}</b></div>
        <div class="kpi"><span>RTM / placas</span><b>${d.convenioCount || 0} / ${plates.length}</b></div>
      </div>
      <h3>Registrar pago</h3>
      <div class="form-grid">
        <label class="fld">Valor a pagar<input id="pc_amount" type="text" inputmode="numeric" value="${Math.max(0, d.pending || 0)}" /></label>
        <label class="fld">Fecha<input id="pc_date" type="date" value="${todayIso()}" /></label>
        <label class="fld">Factura / soporte externo<input id="pc_invoice" placeholder="Opcional" /></label>
        <label class="fld">Documento para facturar<input id="pc_invoice_doc" value="${esc(allyDoc)}" /></label>
        <label class="fld">Comprobante<input id="pc_voucher" type="file" accept="image/*,.pdf" /></label>
        <label class="fld">Nota<input id="pc_note" placeholder="Nota (opcional)" /></label>
      </div>
      <div class="row form-checks">
        <label class="chk"><input type="checkbox" id="pc_manual_invoice" /> Facturar a la cedula/NIT</label>
        <label class="chk"><input type="checkbox" id="pc_send_prov" checked /> Enviar a PROV_CONV</label>
      </div>
      <div class="row form-actions">
        <button class="btn success" id="pc_save">Pagar</button>
        <button class="btn" id="pc_print_pending">Imprimir soporte</button>
      </div>
      <p class="hint">Placas incluidas: ${plates.map(esc).join(", ") || "sin placas"}</p>
      <h3>Historial de pagos</h3>
      <table class="data"><thead><tr><th>Fecha</th><th>Factura</th><th>Comprobante</th><th class="r">RTM</th><th class="r">Valor</th><th>Nota</th><th></th></tr></thead><tbody>${pays || '<tr><td class="hint" colspan="7">Sin pagos registrados</td></tr>'}</tbody></table>
      <h3>Comisiones devengadas (${d.sales.length})</h3>
      <table class="data"><thead><tr><th>Fecha</th><th>Placa</th><th>Cliente</th><th>Factura</th><th>RTM</th><th class="r">Comision</th></tr></thead><tbody>${sales || '<tr><td class="hint" colspan="6">Sin comisiones</td></tr>'}</tbody></table>`;
    $("pc_save").addEventListener("click", () => addPagoConv(name));
    $("pc_print_pending").addEventListener("click", () => printPagoConvProof(d));
    $("pagoconvDetail").querySelectorAll("[data-delpay]").forEach((b) => b.addEventListener("click", () => delPagoConv(Number(b.dataset.delpay), name)));
    $("pagoconvDetail").querySelectorAll("[data-printpay]").forEach((b) => b.addEventListener("click", () => {
      const payment = d.payments.find((p) => p.id === Number(b.dataset.printpay));
      printPagoConvProof(d, payment);
    }));
  } catch (e) { toast(e.message); }
};

addPagoConv = async function (name) {
  const amount = readCop("pc_amount");
  if (amount <= 0) return toast("Ingresa un valor");
  try {
    let voucherPath = null;
    const file = $("pc_voucher")?.files?.[0];
    if (file) {
      const uploaded = await api.uploadFile(file);
      voucherPath = uploaded.url || uploaded.path;
    }
    const detail = currentAllyDetail || {};
    await api.addAllyPayment({
      allyName: name,
      allyId: currentAlly.id,
      amount,
      paidDate: $("pc_date").value || todayIso(),
      note: $("pc_note").value.trim(),
      voucherPath,
      invoiceNumber: $("pc_invoice").value.trim(),
      manualInvoice: $("pc_manual_invoice").checked,
      invoiceDoc: $("pc_invoice_doc").value.trim(),
      invoiceName: detail.ally?.name || name,
      plates: detail.plates || [],
      convenioCount: detail.convenioCount || 0,
      sendToProvision: $("pc_send_prov").checked
    });
    toast("Pago registrado");
    await loadPagoConvDetail(name);
    loadPagoConv();
  } catch (e) { toast(e.message); }
};

function printPagoConvProof(detail, payment = null) {
  const amount = payment?.amount ?? readCop("pc_amount") ?? detail.pending ?? 0;
  const invoice = payment?.invoiceNumber || $("pc_invoice")?.value || "-";
  const plates = payment?.plates?.length ? payment.plates : (detail.plates || []);
  const rows = (detail.sales || [])
    .filter((s) => !plates.length || plates.includes(s.plate))
    .map((s) => `<tr><td>${esc(s.plate || "")}</td><td>${esc(s.clientName)}</td><td>${esc(s.invoiceNumber || s.saleNumber || "")}</td><td style="text-align:right">${money(s.deduction)}</td></tr>`)
    .join("");
  const html = `<!doctype html><html><head><title>Comprobante convenio</title>
    <style>body{font-family:Arial,sans-serif;padding:28px;color:#111}h1{font-size:18px;margin:0 0 4px}.muted{color:#555;font-size:12px}table{width:100%;border-collapse:collapse;margin-top:18px}th,td{border-bottom:1px solid #ddd;padding:8px;text-align:left}th{font-size:11px;text-transform:uppercase}.total{font-size:18px;font-weight:700;text-align:right;margin-top:16px}.sign{margin-top:70px;border-top:1px solid #111;width:280px;text-align:center;padding-top:8px}</style>
    </head><body>
    <h1>Comprobante de pago a convenio</h1>
    <div class="muted">Fecha: ${esc(payment?.paidDate || $("pc_date")?.value || todayIso())}</div>
    <p><b>Convenio:</b> ${esc(detail.allyName)}<br><b>Factura/soporte:</b> ${esc(invoice)}<br><b>Placas:</b> ${plates.map(esc).join(", ") || "-"}</p>
    <table><thead><tr><th>Placa</th><th>Cliente</th><th>Factura</th><th>Comision</th></tr></thead><tbody>${rows || "<tr><td colspan='4'>Sin detalle de placas</td></tr>"}</tbody></table>
    <div class="total">Valor pagado: ${money(amount)}</div>
    <div class="sign">Firma recibido</div>
    </body></html>`;
  const w = window.open("", "_blank", "width=760,height=900");
  if (!w) return toast("El navegador bloqueo la ventana de impresion");
  w.document.write(html);
  w.document.close();
  w.focus();
  w.print();
}

async function loadCartera() {
  const prev = {
    provider: $("carteraProvider")?.value || "TODOS",
    status: $("carteraStatus")?.value || "abierta",
    from: $("carteraFrom")?.value || "",
    to: $("carteraTo")?.value || "",
    clientDoc: $("carteraClientDoc")?.value || "",
    invoiceNumber: $("carteraInvoice")?.value || ""
  };
  const params = Object.fromEntries(Object.entries(prev).filter(([, v]) => v !== ""));
  try {
    const { items = [], grouped = [], totals = {}, open = 0 } = await api.receivables(params);
    $("carteraOpen").textContent = `Pendiente: ${money(open)}`;
    $("carteraBody").innerHTML = `
      <div class="row filters">
        <select id="carteraProvider">
          <option value="TODOS" ${prev.provider === "TODOS" ? "selected" : ""}>Todos</option>
          <option value="GORA" ${prev.provider === "GORA" ? "selected" : ""}>GORA</option>
          <option value="ADDI" ${prev.provider === "ADDI" ? "selected" : ""}>ADDI</option>
          <option value="Credito propio" ${prev.provider === "Credito propio" ? "selected" : ""}>Credito propio</option>
        </select>
        <select id="carteraStatus">
          <option value="abierta" ${prev.status === "abierta" ? "selected" : ""}>Abierta</option>
          <option value="pagada" ${prev.status === "pagada" ? "selected" : ""}>Pagada</option>
          <option value="todas" ${prev.status === "todas" ? "selected" : ""}>Todas</option>
        </select>
        <input id="carteraFrom" type="date" value="${esc(prev.from)}" />
        <input id="carteraTo" type="date" value="${esc(prev.to)}" />
        <input id="carteraClientDoc" placeholder="Cedula/NIT" value="${esc(prev.clientDoc)}" />
        <input id="carteraInvoice" placeholder="# factura" value="${esc(prev.invoiceNumber)}" />
        <button class="btn primary" id="carteraFilter">Filtrar</button>
        <button class="btn" id="carteraExport">Excel</button>
      </div>
      <div class="kpis">
        <div class="kpi"><span>Facturado</span><b>${money(totals.amount)}</b></div>
        <div class="kpi"><span>Abonado neto</span><b>${money(totals.paidNet)}</b></div>
        <div class="kpi"><span>ICA + retencion</span><b>${money((totals.ica || 0) + (totals.retefuente || 0))}</b></div>
        <div class="kpi"><span>Pendiente</span><b>${money(totals.pending)}</b></div>
      </div>
      <div class="split">
        <div>
          <h3>Facturas</h3>
          <table class="data">
            <thead><tr><th>Proveedor</th><th># factura</th><th>Cliente</th><th>Doc</th><th>Placa</th><th>Fecha</th><th class="r">Monto</th><th class="r">Pendiente</th><th></th></tr></thead>
            <tbody>${
              items.map((r) => `<tr>
                <td>${esc(r.provider)}</td><td>${esc(r.invoiceNumber || "-")}</td><td>${esc(r.clientName || "")}</td><td>${esc(r.clientDoc)}</td>
                <td>${esc(r.plate || "")}</td><td>${esc(r.dueFrom)}</td><td class="r">${money(r.amount)}</td><td class="r"><b>${money(r.pending)}</b></td>
                <td><button class="link" data-recv="${r.id}">abonar</button></td>
              </tr>`).join("") || '<tr><td class="hint" colspan="9">Sin cartera con esos filtros</td></tr>'
            }</tbody>
          </table>
          <h3>Resumen por proveedor</h3>
          <table class="data">
            <thead><tr><th>Proveedor</th><th class="r">Facturas</th><th class="r">Facturado</th><th class="r">Costo real</th><th class="r">Pendiente</th></tr></thead>
            <tbody>${
              grouped.map((g) => `<tr><td>${esc(g.provider)}</td><td class="r">${g.count}</td><td class="r">${money(g.amount)}</td><td class="r">${money(g.realCost)}</td><td class="r">${money(g.pending)}</td></tr>`).join("") || '<tr><td class="hint" colspan="5">Sin resumen</td></tr>'
            }</tbody>
          </table>
        </div>
        <div class="detail-panel" id="carteraPayPanel"><p class="hint">Selecciona una factura para registrar el pago de Gora/Addi con ICA y retencion.</p></div>
      </div>`;
    $("carteraFilter").addEventListener("click", loadCartera);
    $("carteraExport").addEventListener("click", exportCartera);
    $("carteraBody").querySelectorAll("[data-recv]").forEach((b) => b.addEventListener("click", () => renderReceivablePayment(items.find((r) => r.id === Number(b.dataset.recv)))));
  } catch (e) { toast(e.message); }
}

function carteraParams() {
  return Object.fromEntries(Object.entries({
    provider: $("carteraProvider")?.value || "TODOS",
    status: $("carteraStatus")?.value || "abierta",
    from: $("carteraFrom")?.value || "",
    to: $("carteraTo")?.value || "",
    clientDoc: $("carteraClientDoc")?.value || "",
    invoiceNumber: $("carteraInvoice")?.value || ""
  }).filter(([, v]) => v !== ""));
}

function renderReceivablePayment(r) {
  if (!r) return;
  const history = (r.payments || []).map((p) => `<tr><td>${esc(p.paidDate)}</td><td class="r">${money(p.amount)}</td><td class="r">${money(p.ica)}</td><td class="r">${money(p.retefuente)}</td><td>${esc(p.note || "")}</td></tr>`).join("");
  $("carteraPayPanel").innerHTML = `
    <h3>${esc(r.provider)} ${esc(r.invoiceNumber || "")}</h3>
    <p class="hint">${esc(r.clientName || r.clientDoc)} · ${esc(r.plate || "sin placa")} · pendiente ${money(r.pending)}</p>
    <div class="form-grid">
      <label class="fld"># factura<input id="recv_invoice" value="${esc(r.invoiceNumber || "")}" /></label>
      <label class="fld">Referencia credito<input id="recv_ref" value="${esc(r.paymentRef || "")}" /></label>
      <label class="fld">Fecha pago<input id="recv_date" type="date" value="${todayIso()}" /></label>
      <label class="fld">Abono neto<input id="recv_amount" inputmode="numeric" value="${Math.max(0, r.pending || 0)}" /></label>
      <label class="fld">ICA<input id="recv_ica" inputmode="numeric" value="0" /></label>
      <label class="fld">Retencion<input id="recv_rete" inputmode="numeric" value="0" /></label>
    </div>
    <label class="fld">Nota<input id="recv_note" placeholder="Comprobante, observacion o ajuste" /></label>
    <div class="row form-actions">
      <button class="btn success" id="recv_save">Registrar abono</button>
      <button class="btn" id="recv_full">Marcar pagada manual</button>
    </div>
    <div class="kpis">
      <div class="kpi"><span>Costo transaccion</span><b>${money(r.transactionCost)}</b></div>
      <div class="kpi"><span>Costo real</span><b>${money(r.realCost)}</b></div>
      <div class="kpi"><span>Neto despues costos</span><b>${money(r.netAfterCosts)}</b></div>
    </div>
    <h3>Abonos</h3>
    <table class="data"><thead><tr><th>Fecha</th><th class="r">Neto</th><th class="r">ICA</th><th class="r">Retencion</th><th>Nota</th></tr></thead><tbody>${history || '<tr><td class="hint" colspan="5">Sin abonos registrados</td></tr>'}</tbody></table>`;
  $("recv_save").addEventListener("click", () => addReceivablePayment(r.id));
  $("recv_full").addEventListener("click", async () => {
    if (!confirm("Marcar esta cartera como pagada sin detalle de abono?")) return;
    try { await api.payReceivable(r.id); toast("Cartera marcada como pagada"); loadCartera(); }
    catch (e) { toast(e.message); }
  });
}

async function addReceivablePayment(id) {
  try {
    await api.addReceivablePayment(id, {
      invoiceNumber: $("recv_invoice").value.trim(),
      paymentRef: $("recv_ref").value.trim(),
      paidDate: $("recv_date").value || todayIso(),
      amount: readCop("recv_amount"),
      ica: readCop("recv_ica"),
      retefuente: readCop("recv_rete"),
      note: $("recv_note").value.trim()
    });
    toast("Abono registrado");
    loadCartera();
  } catch (e) { toast(e.message); }
}

async function exportCartera() {
  try {
    const blob = await api.exportReceivables(carteraParams());
    await downloadBlob(blob, `cartera-${todayIso()}.xlsx`);
  } catch (e) { toast(e.message); }
}

async function loadConvenios(q = "") {
  try {
    const items = await api.findAllies(q);
    $("conveniosBody").innerHTML = `
      <div class="row filters">
        <input id="allyBulkCommission" type="text" inputmode="numeric" placeholder="Nueva comision para todos" />
        <button class="btn" id="allyBulkApply">Aplicar a todos</button>
      </div>
      <table class="data"><thead><tr><th>Nombre</th><th>Contacto</th><th>Empresa</th><th class="r">Comision</th><th>Inscrito</th></tr></thead><tbody>${
      items.map((a) => `<tr class="clickable" data-ally='${esc(JSON.stringify(a))}'><td>${esc(a.name)}</td><td>${esc(a.contactPhone || "")}</td><td>${esc(a.company || "")}</td><td class="r">${money(a.commission)}</td><td>${a.enrolled ? "Si" : "-"}</td></tr>`).join("") || '<tr><td class="hint" colspan="5">Sin convenios</td></tr>'
    }</tbody></table>`;
    $("allyBulkApply").addEventListener("click", applyAlliesCommissionUI);
    $("conveniosBody").querySelectorAll("[data-ally]").forEach((tr) => tr.addEventListener("click", () => renderAllyForm(JSON.parse(tr.dataset.ally))));
  } catch (e) { toast(e.message); }
}

async function applyAlliesCommissionUI() {
  const commission = readCop("allyBulkCommission");
  if (commission <= 0) return toast("Ingresa la nueva comision");
  if (!confirm(`Aplicar ${money(commission)} a todos los convenios activos?`)) return;
  try {
    const r = await api.applyAlliesCommission(commission);
    toast(`Comision aplicada a ${r.count} convenios`);
    await loadConvenios($("allySearch").value || "");
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
const VIEW_TITLES = {
  dashboard: "Dashboard", venta: "Venta", cierre: "Cierre diario", provisiones: "Provisiones",
  consolidado: "Consolidado", cartera: "Cartera", pagoconv: "Pagos a convenios", clientes: "Clientes",
  llamadas: "Llamadas / vencimientos", convenios: "Convenios", facturaelec: "Factura electronica",
  proveedores: "Proveedores", ventas: "Ventas", usuarios: "Usuarios"
};
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
  // Modulos nuevos (revision 2026-06-04). Cada uno monta en su root.
  if (view === "dashboard") renderDashboard($("dashboardRoot"));
  if (view === "provisiones") renderProvisiones($("provisionesRoot"));
  if (view === "llamadas") renderLlamadas($("llamadasRoot"));
  if (view === "facturaelec") renderFacturaElec($("facturaelecRoot"));
  if (view === "proveedores") renderProveedores($("proveedoresRoot"));
}

// ---------- Modulos nuevos (puntos de montaje de la revision 2026-06-04) ----------
// Cada funcion recibe su contenedor raiz y lo rellena. Reemplazar el stub por la
// implementacion real. Ver PLAN-REVISION-2026-06-04.md para el reparto Claude/Codex.
function moduleStub(container, { title, owner, items }) {
  if (!container) return;
  container.innerHTML = `<div class="card">
    <div class="card-head"><h2>${esc(title)}</h2><div class="pill">${esc(owner)}</div></div>
    <p class="hint">Modulo en construccion. Pendientes:</p>
    <ul class="hint">${items.map((i) => `<li>${esc(i)}</li>`).join("")}</ul>
  </div>`;
}
function renderDashboard(c) {
  moduleStub(c, { title: "Dashboard / KPIs", owner: "Codex · K1–K4",
    items: ["Indice de reportes generales", "KPIs mensuales + comparacion ano anterior", "Provision de IVA (bimestral)", "Resumen de motos entre fechas + exportar Excel"] });
}
async function renderProvisiones(c) {
  if (!c) return;
  c.innerHTML = `<div id="provBoxes"></div>
    <div class="card">
      <div class="card-head"><h2>Provisiones (RTM pendientes)</h2><div id="provTotal" class="pill warn"></div></div>
      <p class="hint">Dinero apartado de quienes pagaron pero aun no hacen la RTM. Al hacerla se consume (sin recalcular comision ni valor).</p>
      <div id="provBody"></div>
    </div>`;
  await loadProvisiones();
}
async function loadProvisiones() {
  try {
    const { items, total, boxes } = await api.provisions();
    $("provTotal").textContent = `Pendiente: ${money(total)}`;
    $("provBoxes").innerHTML = `<div class="card">
      <div class="card-head"><h2>Cajas</h2><button class="btn ghost" id="provAddBox">+ caja</button></div>
      <div class="kpis">${(boxes || []).map((b) => `<div class="kpi"><span>${esc(b.name)}</span><b>${money(b.balance)}</b></div>`).join("") || '<span class="hint">Sin cajas</span>'}</div>
      <div id="provBoxForm"></div>
    </div>`;
    $("provAddBox").addEventListener("click", renderBoxForm);
    $("provBody").innerHTML = `<table class="data"><thead><tr><th>Fecha</th><th>Venta</th><th>Cliente</th><th>Placa</th><th>Tipo</th><th class="r">Monto</th><th></th></tr></thead><tbody>${
      items.map((p) => `<tr><td>${esc(p.saleDate)}</td><td>${esc(p.saleNumber)}</td><td>${esc(p.clientName)}</td><td><b>${esc(p.plate || "")}</b></td><td>${esc(p.allyType)}${p.allyName && p.allyType === "referido" ? " · " + esc(p.allyName) : ""}</td><td class="r">${money(p.amount)}</td><td><button class="btn success sm" data-realize="${p.saleId}">RTM realizada</button></td></tr>`).join("") || '<tr><td class="hint" colspan="7">Sin provisiones pendientes</td></tr>'
    }</tbody></table>`;
    $("provBody").querySelectorAll("[data-realize]").forEach((b) => b.addEventListener("click", () => realizeProvisionUI(Number(b.dataset.realize))));
  } catch (e) { toast(e.message); }
}
function renderBoxForm() {
  $("provBoxForm").innerHTML = `<div class="row" style="margin-top:10px">
    <input id="boxName" placeholder="Nombre de la caja" />
    <select id="boxKind">
      <option value="otra">Otra</option>
      <option value="caja_menor">Caja menor</option>
      <option value="provision_rtm">Provision RTM</option>
      <option value="provision_convenio">Provision convenios</option>
      <option value="iva">IVA</option>
    </select>
    <button class="btn success" id="boxSave">Crear caja</button>
  </div>`;
  $("boxSave").addEventListener("click", async () => {
    const name = $("boxName").value.trim();
    if (!name) return toast("Nombre de la caja obligatorio");
    const code = name.toUpperCase().replace(/\s+/g, "_").slice(0, 20);
    try { await api.addCashBox({ code, name, kind: $("boxKind").value }); toast("Caja creada"); loadProvisiones(); }
    catch (e) { toast(e.message); }
  });
}
async function realizeProvisionUI(saleId) {
  if (!confirm("¿Marcar la RTM como realizada y consumir la provision? No se recalcula comision ni valor.")) return;
  try {
    await api.realizeProvision(saleId, { date: todayIso() });
    toast("Provision consumida · RTM realizada");
    loadProvisiones();
  } catch (e) { toast(e.message); }
}
function addMonthsIso(iso, months) {
  const d = new Date(iso + "T00:00:00");
  d.setMonth(d.getMonth() + months);
  return d.toISOString().slice(0, 10);
}
function renderLlamadas(c) {
  if (!c) return;
  const today = todayIso();
  c.innerHTML = `<div class="card">
    <div class="card-head">
      <h2>Llamadas · vencimientos de RTM</h2>
      <div class="row">
        <label class="rng">Desde <input type="date" id="llFrom" value="${today}" /></label>
        <label class="rng">Hasta <input type="date" id="llTo" value="${addMonthsIso(today, 1)}" /></label>
        <button class="btn primary" id="llLoad">Buscar</button>
      </div>
    </div>
    <p class="hint">Placas cuya RTM vence en el rango (ultima RTM + 1 año). Util para llamar antes de que se venza.</p>
    <div id="llBody"></div>
  </div>`;
  $("llLoad").addEventListener("click", loadLlamadas);
  loadLlamadas();
}
async function loadLlamadas() {
  try {
    const from = $("llFrom").value || todayIso();
    const to = $("llTo").value || addMonthsIso(from, 1);
    const { items, count } = await api.calls(from, to);
    $("llBody").innerHTML = `<div class="detail-meta">${count} vencimiento(s) entre ${from} y ${to}</div>
      <table class="data"><thead><tr><th>Vence</th><th>Placa</th><th>Cliente</th><th>Telefono</th><th>Ultima RTM</th><th>Año/Rango</th></tr></thead><tbody>${
        items.map((i) => `<tr><td><b>${esc(i.dueDate)}</b></td><td>${esc(i.plate)}</td><td class="clickable" data-doc="${esc(i.clientDoc)}">${esc(i.clientName)}</td><td>${esc(i.phone || "-")}</td><td>${esc(i.lastRtm)}</td><td class="hint">${i.modelYear || ""} ${esc(i.rangeName || "")}</td></tr>`).join("") || '<tr><td class="hint" colspan="6">Sin vencimientos en el rango</td></tr>'
      }</tbody></table>`;
    $("llBody").querySelectorAll("[data-doc]").forEach((td) => td.addEventListener("click", () => { switchView("clientes"); setTimeout(() => loadClientDetail(td.dataset.doc), 50); }));
  } catch (e) { toast(e.message); }
}
async function loadDirectoReferido() {
  try {
    const { items } = await api.directoReferido();
    $("clientesBody").innerHTML = `<div class="detail-meta">${items.length} cliente(s) que pasaron de directo a referido</div>
      <table class="data"><thead><tr><th>Cliente</th><th>Directo</th><th>Referido</th><th>Lo refirio</th><th>Placa</th></tr></thead><tbody>${
        items.map((i) => `<tr class="clickable" data-doc="${esc(i.docNumber)}"><td>${esc(i.name)}</td><td>${i.directoYear}</td><td><span class="pill warn">${i.referidoYear}</span></td><td>${esc(i.referidoBy || "")}</td><td>${esc(i.plate || "")}</td></tr>`).join("") || '<tr><td class="hint" colspan="5">Sin casos: nadie paso de directo a referido</td></tr>'
      }</tbody></table>`;
    $("clientesBody").querySelectorAll("[data-doc]").forEach((tr) => tr.addEventListener("click", () => loadClientDetail(tr.dataset.doc)));
  } catch (e) { toast(e.message); }
}
function renderFacturaElec(c) {
  moduleStub(c, { title: "Factura electronica manual", owner: "Codex · F1/F3",
    items: ["Factura tipo POS para cualquier item (ej. equipos de pista)", "Conceptos de pago configurables", "ManualInvoice + ManualInvoiceLine"] });
}
function renderProveedores(c) {
  moduleStub(c, { title: "Proveedores / ordenes de compra", owner: "Codex · F2",
    items: ["CRUD de proveedores (Supplier)", "Emitir orden de compra (PurchaseOrder)", "Distinto de convenios/aliados"] });
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
const DOC_TYPES = ["CC", "NIT", "CE", "TI", "PAS"];
function docTypeSelect(id, val) {
  return `<select id="${id}">${DOC_TYPES.map((t) => `<option value="${t}" ${t === (val || "CC") ? "selected" : ""}>${t}</option>`).join("")}</select>`;
}
// Editor de telefonos: principal (obligatorio) + adicionales dinamicos.
function phonesEditorHtml(phone, phones) {
  const extra = Array.isArray(phones) ? phones : [];
  return `
    <label class="fld">Telefono principal *<input id="cl_phone" value="${esc(phone || "")}" placeholder="Obligatorio" /></label>
    <label class="fld">Telefonos adicionales
      <div id="cl_phones">${extra.map((p) => phoneRowHtml(p)).join("")}</div>
      <button class="link" id="cl_addphone" type="button">+ agregar telefono</button>
    </label>`;
}
function phoneRowHtml(val = "") {
  return `<div class="payrow"><input class="cl-extra-phone" value="${esc(val)}" placeholder="Telefono adicional" /><button class="link" type="button" data-delphone>quitar</button></div>`;
}
function wirePhonesEditor() {
  $("cl_addphone")?.addEventListener("click", () => {
    const box = $("cl_phones");
    box.insertAdjacentHTML("beforeend", phoneRowHtml(""));
    box.lastElementChild.querySelector("[data-delphone]").addEventListener("click", (e) => e.target.closest(".payrow").remove());
    box.lastElementChild.querySelector("input").focus();
  });
  $("cl_phones")?.querySelectorAll("[data-delphone]").forEach((b) => b.addEventListener("click", (e) => e.target.closest(".payrow").remove()));
}
function readPhones() {
  const phone = $("cl_phone").value.trim();
  const phones = [...document.querySelectorAll(".cl-extra-phone")].map((i) => i.value.trim()).filter(Boolean);
  return { phone, phones };
}
const HIST_LABEL = { directo: "Directo", referido: "Referido", rtm: "RTM", no_rtm: "Sin RTM" };
function historyTableHtml(history = []) {
  if (!history.length) return '<p class="hint">Sin historial todavia.</p>';
  return `<table class="data"><thead><tr><th>Año</th><th>Como llego</th><th>Placa</th><th>Convenio</th><th>Nota</th></tr></thead><tbody>${
    history.map((h) => `<tr><td>${h.year}</td><td><span class="pill ${h.eventType === "referido" ? "warn" : ""}">${esc(HIST_LABEL[h.eventType] || h.eventType)}</span></td><td>${esc(h.plate || "")}</td><td>${esc(h.allyName || "")}</td><td class="hint">${esc(h.note || "")}</td></tr>`).join("")
  }</tbody></table>`;
}

async function loadClientDetail(doc) {
  try {
    const c = await api.getClient(doc);
    $("clientDetailName").textContent = c.name;
    const veh = c.vehicles || [];
    const hist = c.history || [];
    $("clientDetailBody").innerHTML = `
      <div class="form-grid">
        <label class="fld">Tipo documento${docTypeSelect("cl_docType", c.docType)}</label>
        <label class="fld">Nombre<input id="cl_name" value="${esc(c.name)}" /></label>
        ${phonesEditorHtml(c.phone, c.phones)}
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
      </div>
      <h3>Historial del cliente (${hist.length})</h3>
      ${historyTableHtml(hist)}`;
    wirePhonesEditor();
    $("clSave").addEventListener("click", () => saveClientEdit(c.docNumber));
    $("clDelete").addEventListener("click", () => deleteClientUI(c.docNumber, c.name));
    $("clAddVeh").addEventListener("click", () => addVehicleUI(c.docNumber));
    $("clientDetailBody").querySelectorAll("[data-delveh]").forEach((b) => b.addEventListener("click", () => delVehicleUI(Number(b.dataset.delveh), c.docNumber)));
  } catch (e) { toast(e.message); }
}
async function saveClientEdit(doc) {
  const { phone, phones } = readPhones();
  if (!phone) return toast("El telefono principal es obligatorio");
  try {
    await api.saveClient({ docNumber: doc, docType: $("cl_docType").value, name: $("cl_name").value.trim(), phone, phones, email: $("cl_email").value.trim(), address: $("cl_address").value.trim() });
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
      <label class="fld">Tipo documento${docTypeSelect("cl_docType", "CC")}</label>
      <label class="fld">Documento *<input id="cl_newdoc" /></label>
      <label class="fld">Nombre *<input id="cl_name" /></label>
      ${phonesEditorHtml("", [])}
      <label class="fld">Email<input id="cl_email" /></label>
      <label class="fld">Direccion<input id="cl_address" /></label>
    </div>
    <div class="row form-actions"><button class="btn success" id="clCreate">Crear cliente</button></div>`;
  wirePhonesEditor();
  $("clCreate").addEventListener("click", createClientUI);
}
async function createClientUI() {
  const docNumber = $("cl_newdoc").value.trim();
  const name = $("cl_name").value.trim();
  const { phone, phones } = readPhones();
  if (!docNumber || !name) return toast("Documento y nombre obligatorios");
  if (!phone) return toast("El telefono principal es obligatorio");
  try {
    await api.saveClient({ docNumber, name, phone, phones, email: $("cl_email").value.trim(), address: $("cl_address").value.trim(), docType: $("cl_docType").value });
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
  $("exportClosing").addEventListener("click", exportClosingUI);
  $("freezeClosing").addEventListener("click", freezeClosing);
  const monthStart = todayIso().slice(0, 8) + "01";
  $("repFrom").value = monthStart;
  $("repTo").value = todayIso();
  $("loadReport").addEventListener("click", loadReport);
  $("exportReport").addEventListener("click", exportReportUI);
  $("ventasDate").addEventListener("change", loadVentas);
  $("ventasSearch").addEventListener("input", loadVentas);
  $("ventasAll").addEventListener("click", () => { $("ventasDate").value = ""; loadVentas(); });
  $("exportVentas").addEventListener("click", exportVentasUI);
  $("allySearch").addEventListener("input", (e) => loadConvenios(e.target.value));
  $("allyNew").addEventListener("click", () => renderAllyForm(null));
  $("clientListSearch").addEventListener("input", (e) => loadClientes(e.target.value));
  $("clientDirRef").addEventListener("click", loadDirectoReferido);
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
