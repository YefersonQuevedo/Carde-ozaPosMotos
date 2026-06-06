import { api } from "./api.js";

const money = (n) => new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 }).format(Math.round(Number(n) || 0));
const todayIso = () => new Date().toISOString().slice(0, 10);
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const readCop = (id) => Math.round(Number(String($(id)?.value || "").replace(/[^\d]/g, "")) || 0);
const MOTO_PLATE_RE = /^[A-Z]{3}\d{2}[A-Z]$/;
const PIN_RE = /^\d{19}$/;
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

// Icono + color por metodo de pago (asociacion visual para no confundir).
function payVisual(m) {
  const s = `${m.code || ""} ${m.name || ""}`.toUpperCase();
  if (s.includes("EFECTIVO")) return { ico: "💵", cls: "green" };
  if (s.includes("QR")) return { ico: "📲", cls: "indigo" };
  if (s.includes("DATAFONO") || s.includes("TARJETA")) return { ico: "💳", cls: "blue" };
  if (s.includes("TRANSFER")) return { ico: "🏦", cls: "teal" };
  if (s.includes("ADDI")) return { ico: "🅰️", cls: "amber" };
  if (s.includes("GORA")) return { ico: "🤝", cls: "teal" };
  if (s.includes("CREDITO")) return { ico: "📄", cls: "amber" };
  return { ico: "💳", cls: "blue" };
}

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
    pinNumber: "",
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
    if (sale.needsCredit !== null && sale.rtmTodayAnswered && sale.rtmToday) o.splice(o.indexOf("resumen"), 0, "pin");
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
    case "pin": return !sale.rtmToday || PIN_RE.test(sale.pinNumber);
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
    rtmHoy: () => { sale.rtmTodayAnswered = false; sale.pinNumber = ""; },
    pin: () => { sale.pinNumber = ""; }
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
        <div class="row" style="align-items:flex-start">
          <div class="lookup" style="flex:2 1 200px">
            <input id="vPlate" autocomplete="off" placeholder="Placa" maxlength="8" style="text-transform:uppercase" />
            <div id="vehicleSuggest" class="suggest hidden"></div>
          </div>
          <input id="vYear" type="number" placeholder="Año modelo" min="1980" max="2035" style="flex:1 1 120px" />
        </div>
        <div id="vRange" class="hint">Ingresa el año del modelo para cargar el paquete RTM.</div>
        <button class="btn primary" id="vNext">Continuar</button>`, false);
    case "rtmPaid":
      return card(key, "3 · ¿Se cobra o ya está paga?", `
        <div class="bigchoices">
          <button class="bigchoice green" data-rtmpaid="no"><span class="bc-ico">💵</span><span class="bc-main">SE COBRA AHORA</span><span class="bc-sub">Venta normal</span></button>
          <button class="bigchoice red" data-rtmpaid="si"><span class="bc-ico">⛔</span><span class="bc-main">YA ESTÁ PAGA</span><span class="bc-sub">Buscar provisión</span></button>
        </div>`, false);
    case "credito":
      return card(key, "4 · ¿Cómo paga?", `
        <div class="bigchoices">
          <button class="bigchoice green" data-credit="no"><span class="bc-ico">💵</span><span class="bc-main">PAGA DIRECTO</span><span class="bc-sub">Efectivo, tarjeta, QR…</span></button>
          <button class="bigchoice blue" data-credit="si"><span class="bc-ico">🏦</span><span class="bc-main">CON FINANCIACIÓN</span><span class="bc-sub">ADDI o GORA</span></button>
        </div>`, false);
    case "creditoProveedor":
      return card(key, "4b · Financiación", `
        <div class="bigchoices">
          <button class="bigchoice amber" data-prov="ADDI"><span class="bc-ico">🅰️</span><span class="bc-main">ADDI</span><span class="bc-sub">Crédito · factura</span></button>
          <button class="bigchoice blue" data-prov="ALIADOS DE INV. GORA SAS"><span class="bc-ico">🤝</span><span class="bc-main">GORA</span><span class="bc-sub">Crédito · factura</span></button>
        </div>
        <div class="hint">Ambos se facturan siempre y generan cartera.</div>`, false);
    case "pago": {
      const { total } = saleTotals();
      const p = paymentState();
      const opts = catalog.paymentMethods
        .filter((m) => !m.isCredit)
        .map((m) => { const v = payVisual(m); return `<button class="paybtn ${v.cls}" data-pay="${esc(m.code)}"><span class="pb-ico">${v.ico}</span> ${esc(m.name)}</button>`; })
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
      return card(key, "6 · ¿Cómo llegó el cliente?", `
        <div class="bigchoices">
          <button class="bigchoice green" data-ally="usuario"><span class="bc-ico">🧑</span><span class="bc-main">DIRECTO</span><span class="bc-sub">Cliente fidelizado</span></button>
          <button class="bigchoice blue" data-ally="referido"><span class="bc-ico">🤝</span><span class="bc-main">REFERIDO</span><span class="bc-sub">Lo trajo un convenio</span></button>
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
      return card(key, "7 · ¿Cuándo hace la RTM?", `
        <div class="bigchoices">
          <button class="bigchoice green" data-today="si"><span class="bc-ico">✅</span><span class="bc-main">HOY MISMO</span><span class="bc-sub">Genera PIN ahora</span></button>
          <button class="bigchoice amber" data-today="no"><span class="bc-ico">⏳</span><span class="bc-main">QUEDA PENDIENTE</span><span class="bc-sub">Va a provisión</span></button>
        </div>`, false);
    case "pin":
      return card(key, "7b · PIN SuperFlex", `
        <label class="fld">PIN generado (19 digitos)
          <input id="pinNumber" inputmode="numeric" maxlength="19" placeholder="0000000000000000000" value="${esc(sale.pinNumber)}" />
        </label>
        <div class="hint">Obligatorio porque la RTM se realiza hoy. Debe ser numerico de 19 digitos.</div>
        <button class="btn primary" id="pinNext">Continuar</button>`, false);
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
            <input id="provPin_${p.saleId}" inputmode="numeric" maxlength="19" placeholder="PIN 19 digitos" style="max-width:180px" />
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
    case "rtmPaid": body = sale.rtmAlreadyPaid ? "Ya estaba pagada" : "Se cobra en esta venta"; break;
    case "credito": body = sale.needsCredit ? "Con financiacion" : "Sin credito"; break;
    case "creditoProveedor": body = sale.creditProvider === "ADDI" ? "ADDI" : "GORA"; break;
    case "pago": body = sale.payments.map((p) => `${methodByCode[p.methodCode].name}: ${money(p.amount)}`).join(" · "); break;
    case "tipoCliente": body = sale.allyType === "usuario" ? "Usuario directo (fidelizado)" : `Referido: ${esc(sale.allyName)}${sale.discountApplied ? " (con descuento)" : ""}`; break;
    case "rtmHoy": body = sale.rtmToday ? "Se realiza hoy" : "Pendiente"; break;
    case "pin": body = sale.pinNumber; break;
    case "provisionCheck": body = `Provision consumida · ${esc(sale.registered?.sale?.saleNumber || "")}`; break;
    case "resumen": body = `Registrada ${esc(sale.registered?.sale?.saleNumber || "")}`; break;
  }
  return card(key, titleFor(key), body, true);
}
function titleFor(key) {
  return {
    cliente: "1 · Cliente", moto: "2 · Moto", rtmPaid: "3 · Pago previo RTM", credito: "4 · Credito",
    creditoProveedor: "4b · Financiacion", pago: "5 · Pago", tipoCliente: "6 · Tipo cliente",
    rtmHoy: "7 · RTM hoy", pin: "7b · PIN", provisionCheck: "Provision", resumen: "8 · Resumen"
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
      if (!year) { $("vRange").textContent = "Ingresa el año del modelo para cargar el paquete RTM."; return; }
      const range = rangeFromModel(year);
      const pkg = packageForRange(range);
      const total = pkg ? computeLines(pkg.code).reduce((s, l) => s + l.total, 0) : 0;
      $("vRange").innerHTML = pkg
        ? `Paquete <b>${esc(pkg.name)}</b> (${esc(pkg.code)}) · Total <b>${money(total)}</b>`
        : `Rango ${esc(range)} sin paquete configurado`;
    };
    $("vYear").addEventListener("input", upd); upd();
    // Solo las motos del cliente seleccionado (no de todo el sistema).
    attachSuggest($("vPlate"), $("vehicleSuggest"),
      async (q) => {
        const doc = sale.client?.docNumber;
        const list = doc ? await api.findVehicles({ clientDoc: doc }) : await api.findVehicles({ plate: q });
        const qq = q.toUpperCase();
        return list
          .filter((v) => (v.plate || "").toUpperCase().includes(qq))
          .map((v) => ({ title: v.plate, sub: `${v.modelYear || ""} ${v.rangeName || ""}`.trim(), raw: v }));
      },
      (v) => selectVehicle(v));
    // Mostrar las motos del cliente apenas se hace foco (aunque no se haya escrito).
    $("vPlate").addEventListener("focus", async () => {
      const doc = sale.client?.docNumber;
      if (!doc) return;
      try {
        const list = await api.findVehicles({ clientDoc: doc });
        const box = $("vehicleSuggest");
        if (!list.length || !box) return;
        box.innerHTML = list.map((v, i) => `<div class="suggest-item" data-vi="${i}"><b>${esc(v.plate)}</b><span>${esc(`${v.modelYear || ""} ${v.rangeName || ""}`.trim())}</span></div>`).join("");
        box.classList.remove("hidden");
        box.querySelectorAll("[data-vi]").forEach((el) =>
          el.addEventListener("mousedown", (ev) => { ev.preventDefault(); box.classList.add("hidden"); selectVehicle(list[Number(el.dataset.vi)]); }));
      } catch {}
    });
    $("vNext").addEventListener("click", () => {
      const plate = $("vPlate").value.trim().toUpperCase().replace(/\s+/g, "");
      const year = Number($("vYear").value) || null;
      if (!plate) return toast("Ingresa la placa");
      if (!MOTO_PLATE_RE.test(plate)) return toast("La placa de moto debe tener formato AAA00A");
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
    // Quita métodos en $0 (solo se cobró por los que tienen valor).
    sale.payments = sale.payments.filter((pay) => Number(pay.amount) > 0);
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
    sale.rtmToday = b.dataset.today === "si"; sale.rtmTodayAnswered = true; sale.pinNumber = ""; render();
  }));

  $("pinNext")?.addEventListener("click", () => {
    const pin = ($("pinNumber").value || "").trim();
    if (!PIN_RE.test(pin)) return toast("El PIN debe tener 19 digitos numericos");
    sale.pinNumber = pin;
    render();
  });

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
      pinNumber: sale.pinNumber,
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
    const pinNumber = ($(`provPin_${saleId}`)?.value || "").trim();
    if (!PIN_RE.test(pinNumber)) return toast("El PIN debe tener 19 digitos numericos");
    const r = await api.realizeProvision(saleId, { date: todayIso(), pinNumber });
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
    const { closing, detail, dispersion } = await api.closingDetail(date, gastos);
    const c = closing;
    const methods = Object.entries(c.byMethod).map(([k, v]) => `<tr><td>${esc(k)}</td><td class="r">${(c.countByMethod && c.countByMethod[k]) || 0}</td><td class="r">${money(v)}</td></tr>`).join("");
    const rows = detail.slice(0, 80).map((s) => `<tr><td>${esc(s.item)}</td><td>${esc(s.ventaInterna)}</td><td>${esc(s.facturaPosDian || "-")}</td><td>${esc(s.cliente)}</td><td>${esc(s.placa || "")}</td><td>${esc(s.tipoCliente)} / ${esc(s.referido || "")}</td><td>${esc(s.rtmEstado)}</td><td>${esc(s.pinRegistrado || "-")}</td><td class="r">${money(s.efectivoReal)}</td><td class="r">${money(s.bancosTarjetaQr)}</td><td class="r">${money(s.valorComision)}</td><td class="r">${money(s.costosTotal)}</td><td class="r">${money(s.base)}</td><td class="r">${money(s.iva)}</td><td class="r">${money(s.bruto)}</td></tr>`).join("");
    const dispRows = (dispersion || []).map((d) => `<tr><td>${esc(d.grupo)}</td><td class="r">${d.cantidad || 0}</td><td class="r">${money(d.recaudoBruto)}</td><td class="r">${money((d.servicioRecaudo || 0) + (d.ivaServicio || 0))}</td><td class="r">${money((d.servicioHomologado || 0) + (d.ivaHomologado || 0))}</td><td class="r">${money(d.ansv)}</td><td class="r">${money((d.adqTransaccion || 0) + (d.ica || 0))}</td><td class="r"><b>${money(d.netoEstimado)}</b></td></tr>`).join("");
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
      <p class="hint">Gastos: ${money(c.gastosRegistrados || 0)} registrados (modulo Gastos)${(c.gastosManual || 0) > 0 ? ` + ${money(c.gastosManual)} extra` : ""} = ${money(c.gastos)}.</p>
      <h3>Dispersion estimada Supergiros</h3>
      <table class="data"><thead><tr><th>Grupo</th><th class="r">Cant.</th><th class="r">Recaudo</th><th class="r">Serv. recaudo</th><th class="r">Homologado</th><th class="r">ANSV</th><th class="r">ADQ/ICA</th><th class="r">Neto</th></tr></thead><tbody>${dispRows || '<tr><td class="hint" colspan="8">Sin pagos para dispersar</td></tr>'}</tbody></table>
      <h3>Detalle del dia</h3>
      <p class="hint">Vista rapida. El boton "Detalle Excel" descarga la planilla completa con pagos, costos, movimientos de caja y gastos.</p>
      <table class="data"><thead><tr><th>#</th><th>Venta</th><th>Factura</th><th>Cliente</th><th>Placa</th><th>Tipo/ref.</th><th>RTM</th><th>PIN</th><th class="r">Efectivo</th><th class="r">Bancos</th><th class="r">Comision</th><th class="r">Costos</th><th class="r">Base</th><th class="r">IVA</th><th class="r">Total</th></tr></thead><tbody>${rows || '<tr><td class="hint" colspan="15">Sin ventas</td></tr>'}</tbody></table>`;
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
async function exportClosingDetailUI() {
  try {
    const date = $("closingDate").value || todayIso();
    const gastos = Number($("closingGastos").value) || 0;
    const blob = await api.exportClosingDetail(date, gastos);
    await downloadBlob(blob, `detalle-dia-${date}.xlsx`);
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
      </table>
      <h3 style="margin-top:18px">Mapa de calor — horas y días pico</h3>
      <div id="heatmapBox" class="hint">Cargando…</div>`;
    loadHeatmap(from, to);
  } catch (e) { toast(e.message); }
}
// Color de celda segun intensidad (0..1): de gris claro a verde fuerte.
function heatColor(ratio) {
  if (ratio <= 0) return "#eef2f7";
  const r = Math.round(232 - 200 * ratio);
  const g = Math.round(244 - 70 * ratio);
  const b = Math.round(247 - 200 * ratio);
  return `rgb(${r},${g},${b})`;
}
async function loadHeatmap(from, to) {
  try {
    const d = await api.heatmap(from, to);
    const hours = [];
    for (let h = d.hourMin; h <= d.hourMax; h++) hours.push(h);
    const head = `<tr><th></th>${hours.map((h) => `<th>${String(h).padStart(2, "0")}h</th>`).join("")}<th>Total</th></tr>`;
    const body = d.rows.map((row) => {
      const cells = hours.map((h) => {
        const v = row.hours[h] || 0;
        const ratio = d.max ? v / d.max : 0;
        return `<td class="cell" style="background:${heatColor(ratio)};color:${ratio > 0.55 ? "#fff" : "#0b3d20"}" title="${row.day} ${String(h).padStart(2, "0")}:00 · ${v}">${v || ""}</td>`;
      }).join("");
      return `<tr><td class="day">${row.day}</td>${cells}<td class="day">${row.total}</td></tr>`;
    }).join("");
    $("heatmapBox").innerHTML = `
      <div class="row" style="gap:18px;margin-bottom:8px">
        <div class="pill ok">Día pico: ${esc(d.peakDay || "-")}</div>
        <div class="pill ok">Hora pico: ${esc(d.peakHour || "-")}</div>
        <span class="hint">${d.total} RTM en el rango · más oscuro = más movimiento</span>
      </div>
      <div style="overflow-x:auto"><table class="heatmap">${head}${body}</table></div>`;
  } catch (e) { $("heatmapBox").innerHTML = `<span class="hint">${esc(e.message)}</span>`; }
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
    const activas = items.filter((s) => s.status !== "anulada");
    const total = activas.reduce((s, v) => s + v.total, 0);
    const ivaTot = activas.reduce((s, v) => s + (v.totalIva || 0), 0);
    $("ventasSummary").textContent = `${items.length} ventas${date ? " · " + date : " · todas"} · Total ${money(total)} · IVA ${money(ivaTot)}`;
    $("ventasBody").innerHTML = `<div style="overflow-x:auto"><table class="data"><thead><tr>
        <th>Fecha</th><th>Venta</th><th>Factura</th><th>Cliente</th><th>Documento</th><th>Placa</th><th>Modelo</th><th>Tipo</th><th>Convenio</th><th>RTM</th><th>PIN</th><th>Medios de pago</th><th class="r">Base</th><th class="r">IVA</th><th class="r">Total</th><th>Estado</th><th></th></tr></thead><tbody>${
      items.map((s) => {
        const anulada = s.status === "anulada";
        const canVoid = !anulada && api.currentUser()?.role === "admin";
        return `<tr style="${anulada ? "opacity:.5;text-decoration:line-through" : ""}">
          <td>${esc(s.saleDate)}</td><td>${esc(s.saleNumber)}</td><td>${esc(s.invoiceNumber || "-")}</td>
          <td>${esc(s.clientName)}</td><td>${esc(s.clientDoc)}</td><td>${esc(s.plate || "")}</td><td>${s.modelYear || ""}</td>
          <td>${esc(s.allyType)}</td><td>${esc(s.allyName || "")}</td><td>${esc(s.rtmStatus)}</td><td class="hint">${esc(s.pinNumber || "")}</td>
          <td class="hint">${esc(s.methods || "")}</td>
          <td class="r">${money(s.totalBase)}</td><td class="r">${money(s.totalIva)}</td><td class="r"><b>${money(s.total)}</b></td>
          <td>${anulada ? "anulada" : "activa"}</td>
          <td>${canVoid ? `<button class="link" data-void="${s.id}">anular</button>` : ""}</td></tr>`;
      }).join("") || '<tr><td class="hint" colspan="17">Sin ventas</td></tr>'
    }</tbody></table></div>`;
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
  proveedores: "Proveedores", ventas: "Ventas", usuarios: "Usuarios", gastos: "Gastos", fupa: "Pines / FUPA", dian: "Facturacion DIAN", config: "Configuracion", payables: "Cuentas por pagar", ingresos: "Ingresos"
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
  if (view === "gastos") renderGastos($("gastosRoot"));
  if (view === "ingresos") renderIngresos($("ingresosRoot"));
  if (view === "payables") renderPayables($("payablesRoot"));
  if (view === "fupa") renderFupa($("fupaRoot"));
  if (view === "dian") renderDian($("dianRoot"));
  if (view === "config") renderConfig($("configRoot"));
  if (view === "llamadas") renderLlamadas($("llamadasRoot"));
  if (view === "facturaelec") renderFacturaElec($("facturaelecRoot"));
  if (view === "proveedores") renderProveedores($("proveedoresRoot"));
}

// ---------- Cuentas por pagar (Claude) ----------
const PAY_FREQ = ["unico", "mensual", "bimestral", "cuotas"];
const PAY_BADGE = { pagado: "ok", parcial: "warn", pendiente: "danger" };
async function renderPayables(c) {
  if (!c) return;
  try { expenseNatures = ((await api.expenseNatures()).items) || expenseNatures || []; } catch { expenseNatures = expenseNatures || []; }
  const natOpts = (expenseNatures || []).map((n) => `<option value="${esc(n.code)}">${esc(n.name)}</option>`).join("");
  c.innerHTML = `<div class="card">
      <div class="card-head"><h2>Nueva obligacion</h2></div>
      <div class="form-grid">
        <label class="fld">Concepto *<input id="pyConcept" placeholder="Ej: Arriendo junio, cuota equipo…" /></label>
        <label class="fld">Acreedor<input id="pyCreditor" placeholder="A quien se le debe" /></label>
        <label class="fld">Naturaleza<select id="pyCategory"><option value="">Sin naturaleza</option>${natOpts}</select></label>
        <label class="fld">Total *<input id="pyTotal" inputmode="numeric" placeholder="$" /></label>
        <label class="fld">Frecuencia<select id="pyFreq">${PAY_FREQ.map((f) => `<option value="${f}">${f}</option>`).join("")}</select></label>
        <label class="fld">Fecha estimada<input type="date" id="pyDue" /></label>
      </div>
      <div class="row form-actions"><button class="btn success" id="pySave">Agregar</button></div>
    </div>
    <div class="card">
      <div class="card-head"><h2>Cuentas por pagar</h2>
        <div class="row"><div id="pyTotals" class="pill warn"></div><button class="btn ghost" id="pyExport">Exportar Excel</button></div>
      </div>
      <div id="pyBody"></div>
    </div>`;
  $("pySave").addEventListener("click", addPayableUI);
  $("pyExport").addEventListener("click", async () => { try { await downloadBlob(await api.exportPayables(), "cuentas-por-pagar.xlsx"); } catch (e) { toast(e.message); } });
  await loadPayables();
}
async function loadPayables() {
  try {
    const { items, totals, count } = await api.payables();
    $("pyTotals").textContent = `Pendiente ${money(totals.pending)} · Total ${money(totals.total)} · Pagado ${money(totals.paid)}`;
    $("pyBody").innerHTML = `<table class="data"><thead><tr><th>Concepto</th><th>Acreedor</th><th>Naturaleza</th><th>Frec.</th><th>Vence</th><th>Estado</th><th class="r">Total</th><th class="r">Pendiente</th><th></th></tr></thead><tbody>${
      items.map((p) => `<tr>
        <td><b>${esc(p.concept)}</b></td><td>${esc(p.creditor || "")}</td><td>${esc(p.category || "")}</td>
        <td>${esc(p.frequency)}</td><td>${esc(p.dueDate || "")}</td>
        <td><span class="pill ${PAY_BADGE[p.status] || ""}">${esc(p.status)}</span></td>
        <td class="r">${money(p.totalAmount)}</td><td class="r"><b>${money(p.pending)}</b></td>
        <td>${p.status !== "pagado" ? `<button class="btn primary sm" data-pay="${p.id}">Abonar</button> ` : ""}<button class="link" data-delpay="${p.id}">eliminar</button></td>
      </tr>`).join("") || '<tr><td class="hint" colspan="9">Sin cuentas por pagar</td></tr>'
    }</tbody></table>`;
    $("pyBody").querySelectorAll("[data-pay]").forEach((b) => b.addEventListener("click", () => payPayableUI(Number(b.dataset.pay))));
    $("pyBody").querySelectorAll("[data-delpay]").forEach((b) => b.addEventListener("click", () => delPayableUI(Number(b.dataset.delpay))));
  } catch (e) { toast(e.message); }
}
async function addPayableUI() {
  const concept = $("pyConcept").value.trim();
  const totalAmount = readCop("pyTotal");
  if (!concept) return toast("El concepto es obligatorio");
  if (totalAmount <= 0) return toast("Ingresa el total");
  try {
    await api.createPayable({ concept, creditor: $("pyCreditor").value.trim(), category: $("pyCategory").value.trim(), totalAmount, frequency: $("pyFreq").value, dueDate: $("pyDue").value || null });
    toast("Obligacion agregada");
    $("pyConcept").value = ""; $("pyCreditor").value = ""; $("pyCategory").value = ""; $("pyTotal").value = ""; $("pyDue").value = "";
    loadPayables();
  } catch (e) { toast(e.message); }
}
async function payPayableUI(id) {
  const raw = prompt("Valor del abono:");
  if (raw === null) return;
  const amount = Math.round(Number(String(raw).replace(/[^\d]/g, "")) || 0);
  if (amount <= 0) return toast("Valor invalido");
  try { await api.payPayable(id, { amount, paidDate: todayIso() }); toast("Abono registrado"); loadPayables(); }
  catch (e) { toast(e.message); }
}
async function delPayableUI(id) {
  if (!confirm("¿Eliminar esta obligacion y sus abonos?")) return;
  try { await api.deletePayable(id); toast("Eliminada"); loadPayables(); }
  catch (e) { toast(e.message); }
}

// ---------- Ingresos (plantilla) ----------
async function renderIngresos(c) {
  if (!c) return;
  const today = todayIso();
  try { expenseNatures = ((await api.expenseNatures()).items) || expenseNatures || []; } catch { expenseNatures = expenseNatures || []; }
  const natOpts = (expenseNatures || []).map((n) => `<option value="${esc(n.code)}">${esc(n.name)}</option>`).join("");
  c.innerHTML = `<div class="card">
      <div class="card-head"><h2>Registrar ingreso</h2></div>
      <div class="form-grid">
        <label class="fld">Fecha<input type="date" id="inDate" value="${today}" /></label>
        <label class="fld">Valor *<input id="inValue" inputmode="numeric" placeholder="$" /></label>
        <label class="fld">Observacion<input id="inObs" placeholder="Ej: Semana 27 abril, abono SOAT…" /></label>
        <label class="fld">Naturaleza<span class="row" style="gap:6px"><select id="inNature" style="flex:1"><option value="">Sin naturaleza</option>${natOpts}</select><button class="btn ghost" id="inAddNature" type="button" title="Agregar tipo">+</button></span></label>
        <label class="fld">Fuente<select id="inSource"><option value="efectivo">Efectivo</option><option value="bancos">Bancos</option></select></label>
        <label class="chk" style="align-self:end"><input type="checkbox" id="inAfectaCaja" /> Acreditar a una caja</label>
      </div>
      <div class="row form-actions"><button class="btn success" id="inSave">Registrar ingreso</button></div>
    </div>
    <div class="card">
      <div class="card-head">
        <h2>Ingresos</h2>
        <div class="row">
          <label class="rng">Desde <input type="date" id="inFrom" value="${today.slice(0, 8)}01" /></label>
          <label class="rng">Hasta <input type="date" id="inTo" value="${today}" /></label>
          <select id="inSourceFilter"><option value="">Toda fuente</option><option value="efectivo">Efectivo</option><option value="bancos">Bancos</option></select>
          <button class="btn primary" id="inLoad">Ver</button>
          <button class="btn ghost" id="inExport">Exportar Excel</button>
        </div>
      </div>
      <div id="inTotal" class="pill warn"></div>
      <div id="inBody"></div>
    </div>`;
  $("inSave").addEventListener("click", addIncomeUI);
  $("inLoad").addEventListener("click", loadIncome);
  $("inExport").addEventListener("click", exportIncomeUI);
  $("inAddNature").addEventListener("click", () => addNatureUI(c));
  await loadIncome();
}
async function loadIncome() {
  try {
    const params = { from: $("inFrom").value, to: $("inTo").value };
    if ($("inSourceFilter").value) params.source = $("inSourceFilter").value;
    const { items, total, count, bySource } = await api.income(params);
    const natName = Object.fromEntries((expenseNatures || []).map((n) => [n.code, n.name]));
    $("inTotal").textContent = `${count} ingreso(s) · ${money(total)} · Efectivo ${money(bySource.efectivo || 0)} · Bancos ${money(bySource.bancos || 0)}`;
    $("inBody").innerHTML = `<table class="data"><thead><tr><th>Fecha</th><th class="r">Valor</th><th>Observacion</th><th>Naturaleza</th><th>Fuente</th><th></th></tr></thead><tbody>${
      items.map((i) => `<tr><td>${esc(i.date)}</td><td class="r">${money(i.value)}</td><td>${esc(i.observation || "")}</td><td>${esc(natName[i.natureCode] || i.natureCode || "")}</td><td>${esc(i.source)}</td><td><button class="link" data-delinc="${i.id}">anular</button></td></tr>`).join("") || '<tr><td class="hint" colspan="6">Sin ingresos en el rango</td></tr>'
    }</tbody></table>`;
    $("inBody").querySelectorAll("[data-delinc]").forEach((b) => b.addEventListener("click", () => delIncomeUI(Number(b.dataset.delinc))));
  } catch (e) { toast(e.message); }
}
async function addIncomeUI() {
  const value = readCop("inValue");
  if (value <= 0) return toast("Ingresa el valor");
  try {
    await api.addIncome({ date: $("inDate").value || todayIso(), value, observation: $("inObs").value.trim(), natureCode: $("inNature").value, source: $("inSource").value, afectaCaja: $("inAfectaCaja").checked });
    toast("Ingreso registrado");
    $("inValue").value = ""; $("inObs").value = "";
    loadIncome();
  } catch (e) { toast(e.message); }
}
async function delIncomeUI(id) {
  if (!confirm("¿Anular este ingreso?")) return;
  try { await api.deleteIncome(id); toast("Ingreso anulado"); loadIncome(); }
  catch (e) { toast(e.message); }
}
async function exportIncomeUI() {
  try {
    const params = { from: $("inFrom").value, to: $("inTo").value };
    if ($("inSourceFilter").value) params.source = $("inSourceFilter").value;
    await downloadBlob(await api.exportIncome(params), `ingresos-${$("inFrom").value}_${$("inTo").value}.xlsx`);
  } catch (e) { toast(e.message); }
}

// ---------- Gastos (Claude) ----------
let gastosBoxes = [];
let expenseNatures = [];
function natureOptions(selected = "") {
  return expenseNatures.map((n) => `<option value="${esc(n.code)}" ${n.code === selected ? "selected" : ""}>${esc(n.name)}</option>`).join("");
}
async function renderGastos(c) {
  if (!c) return;
  const today = todayIso();
  try {
    const [boxesRes, natureRes] = await Promise.all([api.cashBoxes(), api.expenseNatures()]);
    gastosBoxes = boxesRes.boxes || [];
    expenseNatures = natureRes.items || [];
  } catch {
    gastosBoxes = [];
    expenseNatures = [];
  }
  const boxOpts = gastosBoxes.map((b) => `<option value="${esc(b.code)}">${esc(b.name)}</option>`).join("");
  c.innerHTML = `<div class="card">
    <div class="card-head"><h2>Registrar gasto</h2></div>
    <div class="form-grid">
      <label class="fld">Fecha<input type="date" id="gxDate" value="${today}" /></label>
      <label class="fld">Concepto *<input id="gxConcept" placeholder="Ej: papeleria, almuerzo, transporte" /></label>
      <label class="fld">Naturaleza<span class="row" style="gap:6px"><select id="gxCategory" style="flex:1"><option value="">Sin naturaleza</option>${natureOptions()}</select><button class="btn ghost" id="gxAddNature" type="button" title="Agregar tipo de gasto">+</button></span></label>
      <label class="fld">Caja${`<select id="gxBox">${boxOpts}</select>`}</label>
      <label class="fld">Monto *<input id="gxAmount" inputmode="numeric" placeholder="$" /></label>
      <label class="fld">Nota<input id="gxNote" placeholder="Opcional" /></label>
    </div>
    <div class="row form-actions"><button class="btn success" id="gxSave">Registrar gasto</button></div>
  </div>
  <div class="card">
    <div class="card-head">
      <h2>Gastos</h2>
      <div class="row">
        <label class="rng">Desde <input type="date" id="gxFrom" value="${today.slice(0, 8)}01" /></label>
        <label class="rng">Hasta <input type="date" id="gxTo" value="${today}" /></label>
        <button class="btn primary" id="gxLoad">Ver</button>
        <button class="btn ghost" id="gxExport">Exportar Excel</button>
      </div>
    </div>
    <div id="gxTotal" class="pill warn"></div>
    <div id="gxBody"></div>
  </div>
  <div class="card">
    <div class="card-head">
      <h2>Reporte ejecutivo por naturaleza</h2>
      <div class="row"><button class="btn ghost" id="gxNatureExport">Excel naturalezas</button></div>
    </div>
    <div id="gxNatureBody"></div>
  </div>`;
  $("gxSave").addEventListener("click", addGastoUI);
  $("gxLoad").addEventListener("click", loadGastos);
  $("gxExport").addEventListener("click", exportGastosUI);
  $("gxNatureExport").addEventListener("click", exportNatureReportUI);
  $("gxAddNature").addEventListener("click", () => addNatureUI(c));
  loadGastos();
}
// Agregar un nuevo tipo de gasto/ingreso (naturaleza) al catalogo.
async function addNatureUI(container) {
  const name = prompt("Nombre del nuevo tipo (ej: Papeleria, Mora, Cuota canal, Dispersion Supergiros):");
  if (!name || !name.trim()) return;
  const kind = (prompt("Tipo: gasto o ingreso", "gasto") || "gasto").trim().toLowerCase() === "ingreso" ? "ingreso" : "gasto";
  try {
    const r = await api.saveExpenseNature({ name: name.trim(), kind });
    expenseNatures = ((await api.expenseNatures()).items) || expenseNatures;
    toast("Naturaleza agregada");
    await renderGastos(container); // recarga el desplegable
    const sel = $("gxCategory");
    if (sel && r.item) sel.value = r.item.code;
  } catch (e) { toast(e.message); }
}
async function loadGastos() {
  try {
    const from = $("gxFrom").value, to = $("gxTo").value;
    const { items, total, count } = await api.expenses({ from, to });
    $("gxTotal").textContent = `${count} gasto(s) · ${money(total)}`;
    $("gxBody").innerHTML = `<table class="data"><thead><tr><th>Fecha</th><th>Concepto</th><th>Categoria</th><th>Caja</th><th>Nota</th><th class="r">Monto</th><th></th></tr></thead><tbody>${
      items.map((e) => `<tr><td>${esc(e.date)}</td><td>${esc(e.concept)}</td><td>${esc(e.category || "")}</td><td>${esc(e.boxCode)}</td><td class="hint">${esc(e.note || "")}</td><td class="r">${money(e.amount)}</td><td><button class="link" data-delgasto="${e.id}">anular</button></td></tr>`).join("") || '<tr><td class="hint" colspan="7">Sin gastos en el rango</td></tr>'
    }</tbody></table>`;
    $("gxBody").querySelectorAll("[data-delgasto]").forEach((b) => b.addEventListener("click", () => delGastoUI(Number(b.dataset.delgasto))));
    loadNatureReport();
  } catch (e) { toast(e.message); }
}
async function loadNatureReport() {
  try {
    const { rows, totals } = await api.expenseNatureReport({ from: $("gxFrom").value, to: $("gxTo").value });
    $("gxNatureBody").innerHTML = `<div class="kpis">
      <div class="kpi"><span>Gastos caja</span><b>${money(totals.expenses)}</b></div>
      <div class="kpi"><span>Facturas recibidas</span><b>${money(totals.invoiceTotal)}</b></div>
      <div class="kpi"><span>IVA descontable</span><b>${money(totals.invoiceIvaDeductible)}</b></div>
    </div>
    <table class="data"><thead><tr><th>Naturaleza</th><th class="r">Gastos</th><th class="r">Facturas</th><th class="r">IVA desc.</th><th class="r">Reg.</th></tr></thead><tbody>${
      rows.map((r) => `<tr><td>${esc(r.name)}</td><td class="r">${money(r.expenses)}</td><td class="r">${money(r.invoiceTotal)}</td><td class="r">${money(r.invoiceIvaDeductible)}</td><td class="r">${r.count}</td></tr>`).join("") || '<tr><td class="hint" colspan="5">Sin movimientos por naturaleza</td></tr>'
    }</tbody></table>`;
  } catch (e) { toast(e.message); }
}
async function addGastoUI() {
  const concept = $("gxConcept").value.trim();
  const amount = readCop("gxAmount");
  if (!concept) return toast("El concepto es obligatorio");
  if (amount <= 0) return toast("Ingresa un monto");
  try {
    await api.addExpense({ date: $("gxDate").value || todayIso(), concept, category: $("gxCategory").value.trim(), boxCode: $("gxBox").value, amount, note: $("gxNote").value.trim() });
    toast("Gasto registrado");
    $("gxConcept").value = ""; $("gxAmount").value = ""; $("gxCategory").value = ""; $("gxNote").value = "";
    loadGastos();
  } catch (e) { toast(e.message); }
}
async function delGastoUI(id) {
  if (!confirm("¿Anular este gasto? Se devuelve el dinero a la caja.")) return;
  try { await api.deleteExpense(id); toast("Gasto anulado"); loadGastos(); }
  catch (e) { toast(e.message); }
}
async function exportGastosUI() {
  try {
    const blob = await api.exportExpenses({ from: $("gxFrom").value, to: $("gxTo").value });
    await downloadBlob(blob, `gastos-${$("gxFrom").value}_${$("gxTo").value}.xlsx`);
  } catch (e) { toast(e.message); }
}
async function exportNatureReportUI() {
  try {
    const blob = await api.exportExpenseNatureReport({ from: $("gxFrom").value, to: $("gxTo").value });
    await downloadBlob(blob, `naturalezas-${$("gxFrom").value}_${$("gxTo").value}.xlsx`);
  } catch (e) { toast(e.message); }
}

// ---------- Pines / FUPA (Claude · T2) ----------
async function renderFupa(c) {
  if (!c) return;
  const today = todayIso();
  c.innerHTML = `<div id="fupaSummary"></div>
    <div class="grid2">
      <div class="card">
        <div class="card-head"><h2>Comprar pines</h2></div>
        <div class="row"><input id="fpQty" inputmode="numeric" placeholder="Cantidad" />
          <input id="fpCost" inputmode="numeric" placeholder="Costo unitario $ (opcional)" />
          <input type="date" id="fpDate" value="${today}" /></div>
        <div class="row" style="margin-top:8px"><input id="fpNote" placeholder="Nota (opcional)" />
          <button class="btn success" id="fpBuy">Registrar compra</button></div>
      </div>
      <div class="card">
        <div class="card-head"><h2>Conteo fisico</h2></div>
        <p class="hint">Cuenta los pines reales que tienes. Si no cuadra con el teorico, se registra la diferencia (pines quemados sin registro).</p>
        <div class="row"><input id="fpCount" inputmode="numeric" placeholder="Pines reales contados" />
          <button class="btn" id="fpCountBtn">Registrar conteo</button></div>
      </div>
    </div>
    <div class="card">
      <div class="card-head"><h2>Movimiento por dia</h2>
        <div class="row">
          <label class="rng">Desde <input type="date" id="fpFrom" value="${today.slice(0, 8)}01" /></label>
          <label class="rng">Hasta <input type="date" id="fpTo" value="${today}" /></label>
          <button class="btn primary" id="fpLoad">Ver</button>
          <button class="btn ghost" id="fpExport">Exportar Excel</button>
        </div>
      </div>
      <div id="fpBody"></div>
    </div>`;
  $("fpBuy").addEventListener("click", fupaBuyUI);
  $("fpCountBtn").addEventListener("click", fupaCountUI);
  $("fpLoad").addEventListener("click", loadFupa);
  $("fpExport").addEventListener("click", exportFupaUI);
  await loadFupa();
}
async function loadFupa() {
  try {
    const from = $("fpFrom").value, to = $("fpTo").value;
    const d = await api.fupa(from, to);
    $("fupaSummary").innerHTML = `<div class="kpis">
      <div class="kpi"><span>Stock teorico (pines)</span><b>${d.stock}</b></div>
      <div class="kpi"><span>Comprados</span><b>${d.totalComprado}</b></div>
      <div class="kpi"><span>RTM realizadas (consumo)</span><b>${d.totalRtm}</b></div>
      <div class="kpi"><span>Ajustes</span><b>${d.totalAjustes}</b></div>
    </div>`;
    $("fpBody").innerHTML = `<table class="data"><thead><tr><th>Dia</th><th class="r">Inicio</th><th class="r">Compras</th><th class="r">Ajustes</th><th class="r">Consumo RTM</th><th class="r">Fin</th></tr></thead><tbody>${
      d.rows.map((r) => `<tr><td>${esc(r.date)}</td><td class="r">${r.inicio}</td><td class="r">${r.compras}</td><td class="r">${r.ajustes}</td><td class="r">${r.consumo}</td><td class="r"><b>${r.fin}</b></td></tr>`).join("") || '<tr><td class="hint" colspan="6">Sin movimientos en el rango</td></tr>'
    }</tbody></table>`;
  } catch (e) { toast(e.message); }
}
async function fupaBuyUI() {
  const quantity = readCop("fpQty");
  if (quantity <= 0) return toast("Ingresa la cantidad de pines");
  try {
    await api.fupaPurchase({ quantity, unitCost: readCop("fpCost"), date: $("fpDate").value || todayIso(), note: $("fpNote").value.trim() });
    toast("Compra registrada");
    $("fpQty").value = ""; $("fpCost").value = ""; $("fpNote").value = "";
    loadFupa();
  } catch (e) { toast(e.message); }
}
async function fupaCountUI() {
  const physicalCount = readCop("fpCount");
  if ($("fpCount").value.trim() === "") return toast("Ingresa los pines contados");
  try {
    const r = await api.fupaCount({ physicalCount });
    toast(`Conteo: real ${r.fisico}, teorico ${r.teorico}, diferencia ${r.diferencia}`);
    $("fpCount").value = "";
    loadFupa();
  } catch (e) { toast(e.message); }
}
async function exportFupaUI() {
  try {
    const blob = await api.exportFupa($("fpFrom").value, $("fpTo").value);
    await downloadBlob(blob, `pines-${$("fpFrom").value}_${$("fpTo").value}.xlsx`);
  } catch (e) { toast(e.message); }
}

// ---------- Facturacion electronica DIAN (config apidian + trazabilidad) ----------
const DIAN_BADGE = { ACEPTADA: "ok", RECHAZADA: "danger", ENVIADA: "warn", PENDIENTE: "", NO_APLICA: "" };
const DIAN_CFG_FIELDS = [
  ["companyNit", "NIT empresa"], ["companyDv", "DV"], ["companyName", "Razon social"],
  ["apidianUrl", "URL apidian (…/api/ubl2.1)"], ["apidianToken", "Token apidian"],
  ["testSetId", "Set de pruebas (TestId)"], ["softwareId", "Software ID"], ["softwarePin", "Software PIN"],
  ["resolution", "Resolucion"], ["prefix", "Prefijo"], ["emailApiUrl", "URL API email (opcional)"]
];
async function renderDian(c) {
  if (!c) return;
  c.innerHTML = `<div class="card">
      <div class="card-head"><h2>Trazabilidad de facturas DIAN</h2>
        <div class="row"><div id="dnSummary" class="detail-meta"></div><button class="btn ghost" id="dnExport">Exportar Excel</button></div>
      </div>
      <p class="hint">Estado de cada factura ante la DIAN: ACEPTADA (en la DIAN), RECHAZADA, ENVIADA o PENDIENTE (sin enviar). La conexion se configura en <b>Configuracion → API DIAN</b>.</p>
      <div id="dnBody"></div>
    </div>`;
  $("dnExport").addEventListener("click", async () => {
    try { await downloadBlob(await api.exportDian(), "dian-trazabilidad.xlsx"); } catch (e) { toast(e.message); }
  });
  await loadDianInvoices();
}

// ---------- Panel de Configuracion (DIAN + correos + Telegram + WhatsApp) ----------
async function renderConfig(c) {
  if (!c) return;
  let dian = {}, notif = {};
  try { [dian, notif] = await Promise.all([api.dianConfig(), api.notifConfig()]); } catch (e) { return toast(e.message); }
  const dianFields = DIAN_CFG_FIELDS.map(([k, label]) =>
    `<label class="fld">${label}<input id="dn_${k}" value="${esc(dian[k] ?? "")}" /></label>`).join("");
  c.innerHTML = `
    <div class="card">
      <div class="card-head"><h2>API DIAN (apidian)</h2>
        <label class="chk"><input type="checkbox" id="dn_active" ${dian.active ? "checked" : ""} /> Activa</label>
      </div>
      <p class="hint">apidian arma el XML/UBL, calcula el CUFE, firma y envia a la DIAN.</p>
      <div class="form-grid">
        ${dianFields}
        <label class="fld">Ambiente<select id="dn_environment"><option value="2" ${Number(dian.environment) === 2 ? "selected" : ""}>Pruebas/Habilitacion</option><option value="1" ${Number(dian.environment) === 1 ? "selected" : ""}>Produccion</option></select></label>
      </div>
      <div class="row form-actions"><button class="btn success" id="cfgDianSave">Guardar API DIAN</button></div>
    </div>

    <div class="card">
      <div class="card-head"><h2>Correos</h2><label class="chk"><input type="checkbox" id="nf_emailEnabled" ${notif.emailEnabled ? "checked" : ""} /> Habilitado</label></div>
      <div class="form-grid">
        <label class="fld">URL API de correo<input id="nf_emailApiUrl" value="${esc(notif.emailApiUrl ?? "")}" placeholder="https://…/send-email" /></label>
        <label class="fld">Remitente (from)<input id="nf_emailFrom" value="${esc(notif.emailFrom ?? "")}" placeholder="facturacion@empresa.com" /></label>
      </div>
      <div class="row form-actions"><button class="btn success" id="cfgNotifSave">Guardar notificaciones</button>
        <button class="btn ghost" data-test="email">Probar correo</button></div>
    </div>

    <div class="card">
      <div class="card-head"><h2>Telegram</h2><label class="chk"><input type="checkbox" id="nf_telegramEnabled" ${notif.telegramEnabled ? "checked" : ""} /> Habilitado</label></div>
      <div class="form-grid">
        <label class="fld">Bot Token<input id="nf_telegramBotToken" value="${esc(notif.telegramBotToken ?? "")}" placeholder="123456:ABC…" /></label>
        <label class="fld">Chat ID<input id="nf_telegramChatId" value="${esc(notif.telegramChatId ?? "")}" placeholder="-100123…" /></label>
      </div>
      <div class="row form-actions"><button class="btn ghost" data-test="telegram">Probar Telegram</button></div>
    </div>

    <div class="card">
      <div class="card-head"><h2>WhatsApp</h2><label class="chk"><input type="checkbox" id="nf_whatsappEnabled" ${notif.whatsappEnabled ? "checked" : ""} /> Habilitado</label></div>
      <div class="form-grid">
        <label class="fld">API URL<input id="nf_whatsappApiUrl" value="${esc(notif.whatsappApiUrl ?? "")}" placeholder="https://graph.facebook.com/v20.0" /></label>
        <label class="fld">Token<input id="nf_whatsappToken" value="${esc(notif.whatsappToken ?? "")}" /></label>
        <label class="fld">Phone Number ID<input id="nf_whatsappPhoneId" value="${esc(notif.whatsappPhoneId ?? "")}" /></label>
      </div>
      <div class="row form-actions"><button class="btn ghost" data-test="whatsapp">Probar WhatsApp</button></div>
    </div>`;
  $("cfgDianSave").addEventListener("click", saveDianConfigUI);
  $("cfgNotifSave").addEventListener("click", saveNotifConfigUI);
  c.querySelectorAll("[data-test]").forEach((b) => b.addEventListener("click", () => testNotifUI(b.dataset.test)));
}
async function saveDianConfigUI() {
  const body = { environment: $("dn_environment").value, active: $("dn_active").checked };
  DIAN_CFG_FIELDS.forEach(([k]) => { body[k] = $(`dn_${k}`).value.trim(); });
  try { await api.saveDianConfig(body); toast("Configuracion DIAN guardada"); }
  catch (e) { toast(e.message); }
}
function readNotifForm() {
  return {
    emailEnabled: $("nf_emailEnabled").checked, emailApiUrl: $("nf_emailApiUrl").value.trim(), emailFrom: $("nf_emailFrom").value.trim(),
    telegramEnabled: $("nf_telegramEnabled").checked, telegramBotToken: $("nf_telegramBotToken").value.trim(), telegramChatId: $("nf_telegramChatId").value.trim(),
    whatsappEnabled: $("nf_whatsappEnabled").checked, whatsappApiUrl: $("nf_whatsappApiUrl").value.trim(), whatsappToken: $("nf_whatsappToken").value.trim(), whatsappPhoneId: $("nf_whatsappPhoneId").value.trim()
  };
}
async function saveNotifConfigUI() {
  try { await api.saveNotifConfig(readNotifForm()); toast("Notificaciones guardadas"); }
  catch (e) { toast(e.message); }
}
async function testNotifUI(channel) {
  let to = "";
  if (channel === "email") to = prompt("Correo destino para la prueba:") || "";
  if (channel === "whatsapp") to = prompt("Numero WhatsApp destino (ej: 57300…):") || "";
  if ((channel === "email" || channel === "whatsapp") && !to) return;
  try { await api.saveNotifConfig(readNotifForm()); } catch {}
  toast(`Enviando prueba de ${channel}…`);
  try { await api.testNotif(channel, to); toast(`Prueba de ${channel} enviada`); }
  catch (e) { toast(`${channel}: ${e.message}`); }
}
async function loadDianInvoices() {
  try {
    const { items, summary, count } = await api.dianInvoices();
    $("dnSummary").textContent = `${count} facturas · ` + Object.entries(summary).map(([k, v]) => `${k}: ${v}`).join(" · ");
    $("dnBody").innerHTML = `<table class="data"><thead><tr><th>Factura</th><th>Cliente</th><th>Estado</th><th>CUFE</th><th>Mensajes</th><th class="r">Total</th><th></th></tr></thead><tbody>${
      items.map((i) => `<tr>
        <td>${esc(i.number)}</td>
        <td>${esc(i.sale?.clientName || "")}</td>
        <td><span class="pill ${DIAN_BADGE[i.sendStatus] || ""}">${esc(i.sendStatus)}</span></td>
        <td class="hint" style="max-width:240px;overflow:hidden;text-overflow:ellipsis">${esc(i.cufe || "")}</td>
        <td class="hint" style="max-width:240px">${esc((i.dianMessages || "").slice(0, 120))}</td>
        <td class="r">${money(i.total)}</td>
        <td>${i.sendStatus === "ACEPTADA" ? "✓" : `<button class="btn primary sm" data-send="${i.id}">Enviar DIAN</button>`}</td>
      </tr>`).join("") || '<tr><td class="hint" colspan="7">Sin facturas</td></tr>'
    }</tbody></table>`;
    $("dnBody").querySelectorAll("[data-send]").forEach((b) => b.addEventListener("click", () => sendDianUI(Number(b.dataset.send))));
  } catch (e) { toast(e.message); }
}
async function sendDianUI(id) {
  if (!confirm("¿Enviar esta factura a la DIAN (apidian)?")) return;
  toast("Enviando a la DIAN…");
  try {
    const r = await api.sendDianInvoice(id);
    toast(r.ok ? `Enviada · ${r.invoice.sendStatus}` : `Respuesta: ${r.invoice.sendStatus}`);
    loadDianInvoices();
  } catch (e) { toast(`DIAN: ${e.message}`); loadDianInvoices(); }
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
renderDashboard = function (c) {
  if (!c) return;
  const from = $("dashFrom")?.value || todayIso().slice(0, 8) + "01";
  const to = $("dashTo")?.value || todayIso();
  c.innerHTML = `
    <div class="card">
      <div class="card-head">
        <h2>Dashboard / KPIs</h2>
        <div class="row filters">
          <input id="dashFrom" type="date" value="${esc(from)}" />
          <input id="dashTo" type="date" value="${esc(to)}" />
          <button class="btn primary" id="dashLoad">Actualizar</button>
          <button class="btn" id="dashExport">Excel</button>
        </div>
      </div>
      <div id="dashBody"><p class="hint">Cargando indicadores...</p></div>
    </div>`;
  $("dashLoad").addEventListener("click", loadDashboard);
  $("dashExport").addEventListener("click", exportDashboardUI);
  loadDashboard();
};

function dashCompareRow(label, actual, previous, isMoney = true) {
  const diff = (Number(actual) || 0) - (Number(previous) || 0);
  const fmt = isMoney ? money : (n) => String(Math.round(Number(n) || 0));
  return `<tr><td>${esc(label)}</td><td class="r">${fmt(actual)}</td><td class="r">${fmt(previous)}</td><td class="r"><b>${fmt(diff)}</b></td></tr>`;
}

async function loadDashboard() {
  try {
    const from = $("dashFrom").value;
    const to = $("dashTo").value;
    const { current, previous } = await api.dashboard(from, to);
    const k = current.kpis;
    const p = previous.kpis;
    const compare = [
      dashCompareRow("RTM facturadas", k.rtmFacturadas, p.rtmFacturadas, false),
      dashCompareRow("RTM realizadas", k.rtmRealizadas, p.rtmRealizadas, false),
      dashCompareRow("Ventas brutas", k.salesTotal, p.salesTotal),
      dashCompareRow("Ticket promedio", k.ticketPromedio, p.ticketPromedio),
      dashCompareRow("Jasper estimado", k.jasper, p.jasper),
      dashCompareRow("Deducciones", k.deducciones, p.deducciones),
      dashCompareRow("Dispersion neta esperada", k.dispersionNeta, p.dispersionNeta),
      dashCompareRow("Dispersion efectivo", k.dispersionEfectivoNeto, p.dispersionEfectivoNeto),
      dashCompareRow("Dispersion bancos/QR/tarjeta", k.dispersionBancosNeto, p.dispersionBancosNeto),
      dashCompareRow("IVA provisionado", k.ivaProvision, p.ivaProvision),
      dashCompareRow("Utilidad bruta aprox.", k.utilidadBruta, p.utilidadBruta)
    ].join("");
    const ranges = current.byRange.map((r) => `<tr><td>${esc(r.key)}</td><td class="r">${r.count}</td><td class="r">${r.realized}</td><td class="r">${r.pending}</td><td class="r">${money(r.total)}</td></tr>`).join("");
    const methods = current.byMethod.map((m) => `<tr><td>${esc(m.method)}</td><td class="r">${m.count}</td><td class="r">${money(m.value)}</td></tr>`).join("");
    const dispersion = (current.byDispersion || []).map((d) => `<tr><td>${esc(d.grupo)}</td><td class="r">${d.cantidad || 0}</td><td class="r">${money(d.recaudoBruto)}</td><td class="r">${money((d.servicioRecaudo || 0) + (d.ivaServicio || 0) + (d.servicioHomologado || 0) + (d.ivaHomologado || 0) + (d.ansv || 0) + (d.adqTransaccion || 0) + (d.ica || 0))}</td><td class="r"><b>${money(d.netoEstimado)}</b></td></tr>`).join("");
    const heatmap = (current.byHourHeatmap || []).slice(0, 12).map((h) => `<tr><td>${esc(h.day)}</td><td>${esc(h.label)}</td><td class="r">${h.count}</td><td class="r">${money(h.total)}</td></tr>`).join("");
    const days = current.byDay.map((d) => `<tr><td>${esc(d.date)}</td><td class="r">${d.count}</td><td class="r">${d.realized}</td><td class="r">${d.pending}</td><td class="r">${money(d.total)}</td></tr>`).join("");
    $("dashBody").innerHTML = `
      <div class="kpis">
        <div class="kpi"><span>Ventas brutas</span><b>${money(k.salesTotal)}</b></div>
        <div class="kpi"><span>RTM realizadas</span><b>${k.rtmRealizadas}/${k.rtmFacturadas}</b></div>
        <div class="kpi"><span>Ticket promedio</span><b>${money(k.ticketPromedio)}</b></div>
        <div class="kpi"><span>Directo / referido</span><b>${k.directPct}% / ${k.referredPct}%</b></div>
        <div class="kpi"><span>Jasper estimado</span><b>${money(k.jasper)}</b></div>
        <div class="kpi"><span>Dispersion neta</span><b>${money(k.dispersionNeta)}</b></div>
        <div class="kpi"><span>Efectivo / bancos</span><b>${money(k.dispersionEfectivoNeto)} / ${money(k.dispersionBancosNeto)}</b></div>
        <div class="kpi"><span>IVA provisionado</span><b>${money(k.ivaProvision)}</b></div>
        <div class="kpi"><span>Utilidad bruta aprox.</span><b>${money(k.utilidadBruta)}</b></div>
      </div>
      <div class="split">
        <div>
          <h3>Comparacion contra año anterior</h3>
          <table class="data"><thead><tr><th>Indicador</th><th class="r">Actual</th><th class="r">Año anterior</th><th class="r">Diferencia</th></tr></thead><tbody>${compare}</tbody></table>
          <h3>Resumen de motos por rango</h3>
          <table class="data"><thead><tr><th>Rango</th><th class="r">Total</th><th class="r">Realizadas</th><th class="r">Pendientes</th><th class="r">Ventas</th></tr></thead><tbody>${ranges || '<tr><td class="hint" colspan="5">Sin motos en el rango</td></tr>'}</tbody></table>
          <h3>Horas pico</h3>
          <table class="data"><thead><tr><th>Dia</th><th>Hora</th><th class="r">RTM</th><th class="r">Ventas</th></tr></thead><tbody>${heatmap || '<tr><td class="hint" colspan="4">Sin ventas con hora</td></tr>'}</tbody></table>
        </div>
        <div>
          <h3>Dispersion estimada Supergiros</h3>
          <table class="data"><thead><tr><th>Grupo</th><th class="r">Cant.</th><th class="r">Bruto</th><th class="r">Deducciones</th><th class="r">Neto</th></tr></thead><tbody>${dispersion || '<tr><td class="hint" colspan="5">Sin dispersion calculada</td></tr>'}</tbody></table>
          <h3>Metodos de pago</h3>
          <table class="data"><thead><tr><th>Metodo</th><th class="r">Cant.</th><th class="r">Valor</th></tr></thead><tbody>${methods || '<tr><td class="hint" colspan="3">Sin pagos</td></tr>'}</tbody></table>
          <h3>Dias</h3>
          <table class="data"><thead><tr><th>Dia</th><th class="r">RTM</th><th class="r">Hechas</th><th class="r">Pend.</th><th class="r">Ventas</th></tr></thead><tbody>${days || '<tr><td class="hint" colspan="5">Sin dias</td></tr>'}</tbody></table>
        </div>
      </div>`;
  } catch (e) { toast(e.message); }
}

async function exportDashboardUI() {
  try {
    const from = $("dashFrom").value;
    const to = $("dashTo").value;
    const blob = await api.exportDashboard(from, to);
    await downloadBlob(blob, `dashboard-${from}_${to}.xlsx`);
  } catch (e) { toast(e.message); }
}

async function renderProvisiones(c) {
  if (!c) return;
  c.innerHTML = `<div id="provBoxes"></div>
    <div class="card">
      <div class="card-head"><h2>Provisiones (RTM pendientes)</h2>
        <div class="row"><div id="provTotal" class="pill warn"></div><button class="btn ghost" id="provExport">Exportar Excel</button></div>
      </div>
      <p class="hint">Dinero apartado de quienes pagaron pero aun no hacen la RTM. Al hacerla se consume (sin recalcular comision ni valor).</p>
      <div id="provBody"></div>
    </div>`;
  $("provExport").addEventListener("click", async () => {
    try { const blob = await api.exportProvisions(); await downloadBlob(blob, `provisiones-${todayIso()}.xlsx`); }
    catch (e) { toast(e.message); }
  });
  await loadProvisiones();
}
let provBoxesList = [];
async function loadProvisiones() {
  try {
    const { items, total, boxes } = await api.provisions();
    provBoxesList = boxes || [];
    $("provTotal").textContent = `Pendiente: ${money(total)}`;
    $("provBoxes").innerHTML = `<div class="card">
      <div class="card-head"><h2>Cajas de ahorro</h2>
        <div class="row">
          <button class="btn ghost" id="provMove">Depositar / retirar</button>
          <button class="btn ghost" id="provAddBox">+ caja</button>
        </div>
      </div>
      <p class="hint">Cada caja funciona como una caja de ahorros: acumula su saldo (caja menor, provision RTM, provision convenios, IVA…).</p>
      <div class="kpis">${provBoxesList.map((b) => `<div class="kpi"><span>${esc(b.name)}</span><b>${money(b.balance)}</b></div>`).join("") || '<span class="hint">Sin cajas</span>'}</div>
      <div id="provBoxForm"></div>
    </div>`;
    $("provAddBox").addEventListener("click", renderBoxForm);
    $("provMove").addEventListener("click", renderMoveForm);
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
function renderMoveForm() {
  const opts = provBoxesList.map((b) => `<option value="${esc(b.code)}">${esc(b.name)}</option>`).join("");
  $("provBoxForm").innerHTML = `<div class="row" style="margin-top:10px">
    <select id="mvBox">${opts}</select>
    <select id="mvType"><option value="ingreso">Depositar (ingreso)</option><option value="egreso">Retirar (egreso)</option></select>
    <input id="mvAmount" inputmode="numeric" placeholder="Monto $" />
    <input id="mvNote" placeholder="Nota (ej: retiro del banco)" />
    <button class="btn success" id="mvSave">Aplicar</button>
  </div>`;
  $("mvSave").addEventListener("click", async () => {
    const amount = readCop("mvAmount");
    if (amount <= 0) return toast("Ingresa un monto");
    try {
      await api.addCashMovement({ boxCode: $("mvBox").value, type: $("mvType").value, amount, note: $("mvNote").value.trim(), date: todayIso() });
      toast("Movimiento aplicado");
      loadProvisiones();
    } catch (e) { toast(e.message); }
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
const CALL_STATUS_LABEL = { pendiente: "Pendiente", llamado: "Llamado", no_contesta: "No contesta", numero_errado: "Número errado", contestado: "Contestado", agendado: "Agendado", vino: "Vino", no_vino: "No vino" };
const CALL_BADGE = { agendado: "ok", vino: "ok", contestado: "ok", no_contesta: "warn", numero_errado: "danger", no_vino: "danger", pendiente: "warn", llamado: "" };
let llamadasTab = "venc";
function renderLlamadas(c) {
  if (!c) return;
  c.innerHTML = `<div class="card">
    <div class="card-head"><h2>Llamadas</h2>
      <div class="row">
        <button class="btn ${llamadasTab === "venc" ? "primary" : "ghost"}" data-lltab="venc">Vencimientos</button>
        <button class="btn ${llamadasTab === "gest" ? "primary" : "ghost"}" data-lltab="gest">Gestión</button>
        <button class="btn ${llamadasTab === "ref" ? "primary" : "ghost"}" data-lltab="ref">Referidos</button>
      </div>
    </div>
    <div id="llRoot"></div>
  </div>`;
  c.querySelectorAll("[data-lltab]").forEach((b) => b.addEventListener("click", () => { llamadasTab = b.dataset.lltab; renderLlamadas(c); }));
  if (llamadasTab === "venc") renderLlamadasVenc();
  else if (llamadasTab === "gest") loadGestion();
  else loadReferidos();
}
function renderLlamadasVenc() {
  const today = todayIso();
  $("llRoot").innerHTML = `<div class="row" style="margin-bottom:8px">
      <label class="rng">Desde <input type="date" id="llFrom" value="${today}" /></label>
      <label class="rng">Hasta <input type="date" id="llTo" value="${addMonthsIso(today, 1)}" /></label>
      <button class="btn primary" id="llLoad">Buscar</button>
      <button class="btn ghost" id="llExport">Exportar Excel</button>
    </div>
    <p class="hint">Placas cuya RTM vence en el rango (última RTM + 1 año). "Gestionar" abre el seguimiento de la llamada.</p>
    <div id="llBody"></div>`;
  $("llLoad").addEventListener("click", loadLlamadas);
  $("llExport").addEventListener("click", async () => {
    try { await downloadBlob(await api.exportCalls($("llFrom").value, $("llTo").value), `llamadas-${$("llFrom").value}_${$("llTo").value}.xlsx`); }
    catch (e) { toast(e.message); }
  });
  loadLlamadas();
}
async function loadLlamadas() {
  try {
    const from = $("llFrom").value || todayIso();
    const to = $("llTo").value || addMonthsIso(from, 1);
    const { items, count } = await api.calls(from, to);
    $("llBody").innerHTML = `<div class="detail-meta">${count} vencimiento(s) entre ${from} y ${to}</div>
      <table class="data"><thead><tr><th>Vence</th><th>Placa</th><th>Cliente</th><th>Telefono</th><th>Ultima RTM</th><th></th></tr></thead><tbody>${
        items.map((i, idx) => `<tr data-i="${idx}"><td><b>${esc(i.dueDate)}</b></td><td>${esc(i.plate)}</td><td class="clickable" data-doc="${esc(i.clientDoc)}">${esc(i.clientName)}</td><td>${esc(i.phone || "-")}</td><td>${esc(i.lastRtm)}</td><td><button class="btn ghost sm" data-gestionar="${idx}">Gestionar</button></td></tr>`).join("") || '<tr><td class="hint" colspan="6">Sin vencimientos en el rango</td></tr>'
      }</tbody></table>`;
    $("llBody").querySelectorAll("[data-doc]").forEach((td) => td.addEventListener("click", () => { switchView("clientes"); setTimeout(() => loadClientDetail(td.dataset.doc), 50); }));
    $("llBody").querySelectorAll("[data-gestionar]").forEach((b) => b.addEventListener("click", () => gestionarLlamada(items[Number(b.dataset.gestionar)])));
  } catch (e) { toast(e.message); }
}
// Registra una gestión a partir de un vencimiento.
async function gestionarLlamada(v) {
  const status = prompt(`Gestión para ${v.plate} (${v.clientName}).\nEstado: pendiente, llamado, no_contesta, numero_errado, contestado, agendado, vino, no_vino`, "contestado");
  if (status === null) return;
  if (!CALL_STATUS_LABEL[status]) return toast("Estado inválido");
  const note = prompt("Nota (opcional):") || "";
  let nextCallDate = null;
  if (status === "agendado" || status === "no_contesta") nextCallDate = prompt("Próxima llamada (YYYY-MM-DD):") || null;
  try {
    await api.saveCallLog({ clientDoc: v.clientDoc, clientName: v.clientName, plate: v.plate, phone: v.phone, status, note, dueDate: v.dueDate, nextCallDate });
    toast("Gestión registrada");
  } catch (e) { toast(e.message); }
}
async function loadGestion() {
  $("llRoot").innerHTML = `<div class="row" style="margin-bottom:8px">
      <select id="llStatusFilter"><option value="">Todos los estados</option>${Object.entries(CALL_STATUS_LABEL).map(([k, v]) => `<option value="${k}">${v}</option>`).join("")}</select>
      <button class="btn primary" id="llGestLoad">Ver</button>
      <button class="btn ghost" id="llGestExport">Exportar Excel</button>
    </div>
    <div id="llGestBody"></div>`;
  $("llGestLoad").addEventListener("click", loadGestionList);
  $("llGestExport").addEventListener("click", async () => {
    try { await downloadBlob(await api.exportCallLogs({ status: $("llStatusFilter").value }), "gestion-llamadas.xlsx"); } catch (e) { toast(e.message); }
  });
  loadGestionList();
}
async function loadGestionList() {
  try {
    const status = $("llStatusFilter")?.value || "";
    const { items, summary, count } = await api.callLogs(status ? { status } : {});
    $("llGestBody").innerHTML = `<div class="detail-meta">${count} gestión(es) · ${Object.entries(summary).map(([k, v]) => `${CALL_STATUS_LABEL[k] || k}: ${v}`).join(" · ")}</div>
      <table class="data"><thead><tr><th>Cliente</th><th>Placa</th><th>Telefono</th><th>Estado</th><th>Próxima</th><th>Nota</th><th></th></tr></thead><tbody>${
        items.map((l) => `<tr>
          <td>${esc(l.clientName || l.clientDoc || "")}</td><td>${esc(l.plate || "")}</td><td>${esc(l.phone || "")}</td>
          <td><span class="pill ${CALL_BADGE[l.status] || ""}">${esc(CALL_STATUS_LABEL[l.status] || l.status)}</span></td>
          <td>${esc(l.nextCallDate || "")}</td><td class="hint">${esc(l.note || "")}</td>
          <td><button class="link" data-delcall="${l.id}">eliminar</button></td>
        </tr>`).join("") || '<tr><td class="hint" colspan="7">Sin gestiones registradas</td></tr>'
      }</tbody></table>`;
    $("llGestBody").querySelectorAll("[data-delcall]").forEach((b) => b.addEventListener("click", async () => { if (confirm("¿Eliminar gestión?")) { await api.deleteCallLog(Number(b.dataset.delcall)); loadGestionList(); } }));
  } catch (e) { toast(e.message); }
}
async function loadReferidos() {
  try {
    const { items, count } = await api.referidosReport();
    $("llRoot").innerHTML = `<p class="hint">Rendimiento por referido y placas provisionadas pendientes (para llamarlos a cerrar la RTM).</p>
      <table class="data"><thead><tr><th>Referido</th><th class="r">Total</th><th class="r">Realizadas</th><th class="r">Pendientes</th><th class="r">$ Pendiente</th><th>Placas pendientes</th></tr></thead><tbody>${
        items.map((r) => `<tr><td><b>${esc(r.referido)}</b></td><td class="r">${r.total}</td><td class="r">${r.realizadas}</td><td class="r">${r.pendientes ? `<span class="pill warn">${r.pendientes}</span>` : 0}</td><td class="r">${money(r.montoPendiente)}</td><td class="hint">${esc(r.placasPendientes.map((p) => p.plate).join(", "))}</td></tr>`).join("") || `<tr><td class="hint" colspan="6">Sin referidos</td></tr>`
      }</tbody></table>`;
  } catch (e) { toast(e.message); }
}
async function loadDirectoReferido() {
  try {
    const { items } = await api.directoReferido();
    $("clientesBody").innerHTML = `<div class="row" style="justify-content:space-between;align-items:center">
        <div class="detail-meta">${items.length} cliente(s) que pasaron de directo a referido</div>
        <button class="btn ghost" id="dirRefExport">Exportar Excel</button>
      </div>
      <table class="data"><thead><tr><th>Cliente</th><th>Directo</th><th>Referido</th><th>Lo refirio</th><th>Placa</th></tr></thead><tbody>${
        items.map((i) => `<tr class="clickable" data-doc="${esc(i.docNumber)}"><td>${esc(i.name)}</td><td>${i.directoYear}</td><td><span class="pill warn">${i.referidoYear}</span></td><td>${esc(i.referidoBy || "")}</td><td>${esc(i.plate || "")}</td></tr>`).join("") || '<tr><td class="hint" colspan="5">Sin casos: nadie paso de directo a referido</td></tr>'
      }</tbody></table>`;
    $("dirRefExport").addEventListener("click", async () => {
      try { const blob = await api.exportDirectoReferido(); await downloadBlob(blob, "directo-referido.xlsx"); }
      catch (e) { toast(e.message); }
    });
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

function lineRowHtml(kind, row = {}) {
  return `<div class="payrow ${kind}-line">
    <input class="${kind}-desc" placeholder="Descripcion" value="${esc(row.description || "")}" />
    <input class="${kind}-qty" type="number" min="1" value="${row.quantity || 1}" />
    <input class="${kind}-price" inputmode="numeric" placeholder="Valor unitario" value="${row.unitPrice || ""}" />
    <select class="${kind}-tax"><option value="0" ${(row.taxRate || 0) === 0 ? "selected" : ""}>0%</option><option value="19" ${(row.taxRate || 0) === 19 ? "selected" : ""}>19%</option></select>
    <button class="link" type="button" data-delline>quitar</button>
  </div>`;
}
function wireLineBox(boxId, kind) {
  $(boxId).querySelectorAll("[data-delline]").forEach((b) => b.addEventListener("click", (e) => e.target.closest(".payrow").remove()));
  $(`${kind}AddLine`).onclick = () => {
    $(boxId).insertAdjacentHTML("beforeend", lineRowHtml(kind));
    wireLineBox(boxId, kind);
  };
}
function readLineBox(kind) {
  return [...document.querySelectorAll(`.${kind}-line`)].map((row) => ({
    description: row.querySelector(`.${kind}-desc`).value.trim(),
    quantity: Number(row.querySelector(`.${kind}-qty`).value) || 1,
    unitPrice: Number(String(row.querySelector(`.${kind}-price`).value).replace(/[^\d]/g, "")) || 0,
    taxRate: Number(row.querySelector(`.${kind}-tax`).value) || 0
  })).filter((l) => l.description && l.unitPrice > 0);
}

renderFacturaElec = function (c) {
  if (!c) return;
  const from = $("miFrom")?.value || todayIso().slice(0, 8) + "01";
  const to = $("miTo")?.value || todayIso();
  c.innerHTML = `<div class="master-detail">
    <div class="card">
      <div class="card-head"><h2>Factura electronica manual</h2><button class="btn" id="miExport">Excel</button></div>
      <div class="row filters"><input id="miFrom" type="date" value="${esc(from)}" /><input id="miTo" type="date" value="${esc(to)}" /><input id="miDocFilter" placeholder="Documento" /><button class="btn primary" id="miLoad">Buscar</button></div>
      <div id="miList"></div>
    </div>
    <div class="card">
      <div class="card-head"><h2>Nueva factura manual</h2></div>
      <div class="form-grid">
        <label class="fld">Documento cliente<input id="miClientDoc" /></label>
        <label class="fld">Nombre cliente<input id="miClientName" /></label>
        <label class="fld">Fecha<input id="miDate" type="date" value="${todayIso()}" /></label>
        <label class="fld">Origen<select id="miSource"><option value="manual">Manual</option><option value="venta_equipo">Venta equipo</option><option value="convenio">Convenio</option><option value="otro">Otro</option></select></label>
      </div>
      <label class="fld">Concepto<input id="miConcept" placeholder="Ej. venta de equipos de pista" /></label>
      <div id="miLines">${lineRowHtml("mi")}</div>
      <button class="link" id="miAddLine" type="button">+ agregar linea</button>
      <div class="row form-actions"><button class="btn success" id="miSave">Emitir local</button></div>
    </div>
  </div>`;
  wireLineBox("miLines", "mi");
  $("miLoad").addEventListener("click", loadManualInvoices);
  $("miExport").addEventListener("click", exportManualInvoicesUI);
  $("miSave").addEventListener("click", saveManualInvoiceUI);
  loadManualInvoices();
};

async function loadManualInvoices() {
  try {
    const params = { from: $("miFrom").value, to: $("miTo").value, clientDoc: $("miDocFilter").value.trim() };
    const { items } = await api.manualInvoices(params);
    $("miList").innerHTML = `<table class="data"><thead><tr><th>Numero</th><th>Fecha</th><th>Cliente</th><th>Concepto</th><th class="r">IVA</th><th class="r">Total</th><th>Estado</th><th></th></tr></thead><tbody>${items.map((i) => `<tr><td>${esc(i.number)}</td><td>${esc(i.date)}</td><td>${esc(i.clientName)}<br><span class="hint">${esc(i.clientDoc)}</span></td><td>${esc(i.concept || "")}</td><td class="r">${money(i.iva)}</td><td class="r">${money(i.total)}</td><td>${esc(i.status)}</td><td>${i.status === "activa" ? `<button class="link" data-voidmi="${i.id}">anular</button>` : ""}</td></tr>`).join("") || '<tr><td class="hint" colspan="8">Sin facturas manuales</td></tr>'}</tbody></table>`;
    $("miList").querySelectorAll("[data-voidmi]").forEach((b) => b.addEventListener("click", () => voidManualInvoiceUI(Number(b.dataset.voidmi))));
  } catch (e) { toast(e.message); }
}
async function saveManualInvoiceUI() {
  const lines = readLineBox("mi");
  if (!$("miClientDoc").value.trim() || !$("miClientName").value.trim()) return toast("Cliente obligatorio");
  if (!lines.length) return toast("Agrega al menos una linea");
  try {
    const r = await api.createManualInvoice({ clientDoc: $("miClientDoc").value.trim(), clientName: $("miClientName").value.trim(), date: $("miDate").value || todayIso(), source: $("miSource").value, concept: $("miConcept").value.trim(), lines });
    toast(`Factura ${r.invoice.number} creada`);
    renderFacturaElec($("facturaelecRoot"));
  } catch (e) { toast(e.message); }
}
async function voidManualInvoiceUI(id) {
  if (!confirm("Anular esta factura manual?")) return;
  try { await api.voidManualInvoice(id); toast("Factura anulada"); loadManualInvoices(); }
  catch (e) { toast(e.message); }
}
async function exportManualInvoicesUI() {
  try {
    const blob = await api.exportManualInvoices({ from: $("miFrom").value, to: $("miTo").value, clientDoc: $("miDocFilter").value.trim() });
    await downloadBlob(blob, `facturas-manuales-${todayIso()}.xlsx`);
  } catch (e) { toast(e.message); }
}

let selectedSupplier = null;
let supplierInvoiceBoxes = [];
renderProveedores = function (c) {
  if (!c) return;
  c.innerHTML = `<div class="master-detail">
    <div class="card">
      <div class="card-head"><h2>Proveedores</h2><div class="row"><input id="supSearch" placeholder="Buscar proveedor" /><button class="btn primary" id="supNew">Nuevo</button></div></div>
      <div id="supList"></div>
    </div>
    <div class="card">
      <div class="card-head"><h2 id="supTitle">Proveedor / documentos</h2><div class="row"><button class="btn" id="poExport">Excel OC</button><button class="btn" id="invExport">Excel recibidas</button></div></div>
      <div id="supForm"><p class="hint">Selecciona un proveedor o crea uno nuevo.</p></div>
      <div id="poBox"></div>
      <div id="invBox"></div>
    </div>
  </div>`;
  $("supSearch").addEventListener("input", (e) => loadSuppliers(e.target.value));
  $("supNew").addEventListener("click", () => renderSupplierForm(null));
  $("poExport").addEventListener("click", exportPurchaseOrdersUI);
  $("invExport").addEventListener("click", exportSupplierInvoicesUI);
  loadSuppliers();
  loadPurchaseOrders();
  renderSupplierInvoiceForm();
};

async function loadSuppliers(q = "") {
  try {
    const { items } = await api.suppliers(q);
    $("supList").innerHTML = `<table class="data"><thead><tr><th>Proveedor</th><th>Doc</th><th>Telefono</th><th>Activo</th></tr></thead><tbody>${items.map((s) => `<tr class="clickable" data-sup="${encodeURIComponent(JSON.stringify(s))}"><td>${esc(s.name)}</td><td>${esc(s.docType)} ${esc(s.docNumber)}</td><td>${esc(s.phone || "")}</td><td>${s.active ? "Si" : "-"}</td></tr>`).join("") || '<tr><td class="hint" colspan="4">Sin proveedores</td></tr>'}</tbody></table>`;
    $("supList").querySelectorAll("[data-sup]").forEach((tr) => tr.addEventListener("click", () => renderSupplierForm(JSON.parse(decodeURIComponent(tr.dataset.sup)))));
  } catch (e) { toast(e.message); }
}
function renderSupplierForm(s) {
  selectedSupplier = s;
  $("supTitle").textContent = s ? `Proveedor: ${s.name}` : "Nuevo proveedor";
  $("supForm").innerHTML = `<div class="form-grid"><label class="fld">Tipo doc<input id="supDocType" value="${esc(s?.docType || "NIT")}" /></label><label class="fld">Documento<input id="supDoc" value="${esc(s?.docNumber || "")}" /></label><label class="fld">Nombre<input id="supName" value="${esc(s?.name || "")}" /></label><label class="fld">Telefono<input id="supPhone" value="${esc(s?.phone || "")}" /></label><label class="fld">Email<input id="supEmail" value="${esc(s?.email || "")}" /></label><label class="fld">Metodo pago<input id="supPay" value="${esc(s?.paymentMethod || "")}" /></label></div><label class="fld">Direccion<input id="supAddress" value="${esc(s?.address || "")}" /></label><div class="row form-actions"><button class="btn success" id="supSave">Guardar proveedor</button>${s ? '<button class="btn danger" id="supDelete">Desactivar</button>' : ""}</div>`;
  $("supSave").addEventListener("click", () => saveSupplierUI(s?.id));
  $("supDelete")?.addEventListener("click", () => deleteSupplierUI(s.id));
  renderPurchaseOrderForm();
  renderSupplierInvoiceForm();
}
async function saveSupplierUI(id) {
  const body = { docType: $("supDocType").value.trim(), docNumber: $("supDoc").value.trim(), name: $("supName").value.trim(), phone: $("supPhone").value.trim(), email: $("supEmail").value.trim(), paymentMethod: $("supPay").value.trim(), address: $("supAddress").value.trim() };
  if (!body.docNumber || !body.name) return toast("Documento y nombre obligatorios");
  try {
    const saved = id ? await api.updateSupplier(id, body) : await api.saveSupplier(body);
    toast("Proveedor guardado");
    await loadSuppliers($("supSearch").value || "");
    renderSupplierForm(saved);
  } catch (e) { toast(e.message); }
}
async function deleteSupplierUI(id) {
  if (!confirm("Desactivar proveedor?")) return;
  try { await api.deleteSupplier(id); toast("Proveedor desactivado"); loadSuppliers(); }
  catch (e) { toast(e.message); }
}
function renderPurchaseOrderForm() {
  if (!selectedSupplier) {
    $("poBox").innerHTML = `<p class="hint">Guarda o selecciona un proveedor para crear ordenes de compra.</p><div id="poList"></div>`;
    loadPurchaseOrders();
    return;
  }
  $("poBox").innerHTML = `<h3>Nueva orden de compra</h3><div class="form-grid"><label class="fld">Fecha<input id="poDate" type="date" value="${todayIso()}" /></label><label class="fld">Concepto<input id="poConcept" /></label></div><label class="fld">Nota<input id="poNote" /></label><div id="poLines">${lineRowHtml("po")}</div><button class="link" id="poAddLine" type="button">+ agregar linea</button><div class="row form-actions"><button class="btn success" id="poSave">Emitir OC</button></div><h3>Ordenes recientes</h3><div id="poList"></div>`;
  wireLineBox("poLines", "po");
  $("poSave").addEventListener("click", savePurchaseOrderUI);
  loadPurchaseOrders(selectedSupplier.id);
}

async function renderSupplierInvoiceForm() {
  if (!$("invBox")) return;
  if (!expenseNatures.length || !supplierInvoiceBoxes.length) {
    try {
      const [natureRes, boxRes] = await Promise.all([api.expenseNatures(), api.cashBoxes()]);
      expenseNatures = natureRes.items || [];
      supplierInvoiceBoxes = boxRes.boxes || [];
    } catch {
      expenseNatures = expenseNatures || [];
      supplierInvoiceBoxes = supplierInvoiceBoxes || [];
    }
  }
  if (!selectedSupplier) {
    $("invBox").innerHTML = `<h3>Facturas recibidas</h3><p class="hint">Selecciona un proveedor para registrar una factura recibida. Abajo ves las ultimas facturas de todos los proveedores.</p><div id="invSummary"></div><div id="invList"></div>`;
    loadSupplierInvoices();
    return;
  }
  $("invBox").innerHTML = `<h3>Factura recibida del proveedor</h3>
    <div class="form-grid">
      <label class="fld">Numero factura *<input id="invNumber" /></label>
      <label class="fld">Fecha<input id="invDate" type="date" value="${todayIso()}" /></label>
      <label class="fld">Vence<input id="invDueDate" type="date" /></label>
      <label class="fld">Naturaleza<select id="invNature"><option value="">Sin naturaleza</option>${natureOptions()}</select></label>
      <label class="fld">Base<input id="invBase" inputmode="numeric" placeholder="$" /></label>
      <label class="fld">IVA<input id="invIva" inputmode="numeric" placeholder="$" /></label>
      <label class="fld">Total<input id="invTotal" inputmode="numeric" placeholder="Base + IVA si se deja vacio" /></label>
      <label class="fld">Origen<select id="invSource"><option value="manual">Manual</option><option value="correo">Correo</option><option value="dian">DIAN</option><option value="xml">XML</option><option value="pdf">PDF</option></select></label>
    </div>
    <label class="fld">Concepto<input id="invConcept" placeholder="Ej. contabilidad, papeleria, servicio" /></label>
    <label class="fld">Archivo / comprobante<input id="invFile" type="file" accept=".pdf,image/*" /></label>
    <label class="fld">Nota<input id="invNote" /></label>
    <div class="row form-checks"><label class="chk"><input type="checkbox" id="invDeductible" checked /> IVA descontable</label></div>
    <div class="row form-actions"><button class="btn success" id="invSave">Registrar factura recibida</button></div>
    <h3>Facturas recibidas recientes</h3><div id="invSummary"></div><div id="invList"></div>`;
  $("invSave").addEventListener("click", saveSupplierInvoiceUI);
  loadSupplierInvoices(selectedSupplier.id);
}

async function loadSupplierInvoices(supplierId = selectedSupplier?.id) {
  try {
    const params = supplierId ? { supplierId } : {};
    const { items, summary, count } = await api.supplierInvoices(params);
    if ($("invSummary")) {
      $("invSummary").innerHTML = `<div class="kpis">
        <div class="kpi"><span>Facturas</span><b>${count}</b></div>
        <div class="kpi"><span>Total recibido</span><b>${money(summary.total)}</b></div>
        <div class="kpi"><span>Por pagar</span><b>${money(summary.pending)}</b></div>
        <div class="kpi"><span>IVA descontable</span><b>${money(summary.ivaDeductible)}</b></div>
      </div>`;
    }
    if ($("invList")) {
      $("invList").innerHTML = `<table class="data"><thead><tr><th>Fecha</th><th>Proveedor</th><th>Factura</th><th>Naturaleza</th><th class="r">IVA</th><th class="r">Total</th><th class="r">Pend.</th><th>Estado</th><th></th></tr></thead><tbody>${
        items.map((i) => {
          const pending = Math.max(0, i.total - i.paidAmount);
          return `<tr><td>${esc(i.date)}</td><td>${esc(i.supplierName)}</td><td>${esc(i.number)}<br><span class="hint">${esc(i.concept || "")}</span>${i.filePath ? `<br><a class="link" href="${esc(i.filePath)}" target="_blank">archivo</a>` : ""}</td><td>${esc(i.natureCode || "")}</td><td class="r">${money(i.iva)}</td><td class="r">${money(i.total)}</td><td class="r">${money(pending)}</td><td>${esc(i.status)}</td><td>${i.status !== "anulada" && pending > 0 ? `<button class="link" data-payinv="${i.id}" data-pending="${pending}">pagar</button> ` : ""}${i.status !== "anulada" ? `<button class="link" data-voidinv="${i.id}">anular</button>` : ""}</td></tr>`;
        }).join("") || '<tr><td class="hint" colspan="9">Sin facturas recibidas</td></tr>'
      }</tbody></table>`;
      $("invList").querySelectorAll("[data-payinv]").forEach((b) => b.addEventListener("click", () => paySupplierInvoiceUI(Number(b.dataset.payinv), Number(b.dataset.pending))));
      $("invList").querySelectorAll("[data-voidinv]").forEach((b) => b.addEventListener("click", () => voidSupplierInvoiceUI(Number(b.dataset.voidinv))));
    }
  } catch (e) { toast(e.message); }
}

async function saveSupplierInvoiceUI() {
  if (!selectedSupplier) return toast("Selecciona proveedor");
  const base = readCop("invBase");
  const iva = readCop("invIva");
  const total = readCop("invTotal") || base + iva;
  const body = {
    supplierId: selectedSupplier.id,
    supplierName: selectedSupplier.name,
    supplierDoc: selectedSupplier.docNumber,
    number: $("invNumber").value.trim(),
    date: $("invDate").value || todayIso(),
    dueDate: $("invDueDate").value || null,
    concept: $("invConcept").value.trim(),
    natureCode: $("invNature").value,
    base,
    iva,
    total,
    deductible: $("invDeductible").checked,
    source: $("invSource").value,
    note: $("invNote").value.trim()
  };
  if (!body.number) return toast("Numero de factura obligatorio");
  if (body.total <= 0) return toast("Total de factura obligatorio");
  try {
    const file = $("invFile")?.files?.[0];
    if (file) {
      toast("Subiendo archivo...");
      const uploaded = await api.uploadFile(file);
      body.filePath = uploaded.path || uploaded.url;
    }
    await api.createSupplierInvoice(body);
    toast("Factura recibida registrada");
    renderSupplierInvoiceForm();
  } catch (e) { toast(e.message); }
}

async function paySupplierInvoiceUI(id, pending) {
  const value = prompt("Valor pagado:", String(pending || ""));
  if (value === null) return;
  const amount = Math.round(Number(String(value).replace(/[^\d]/g, "")) || 0);
  if (amount <= 0) return toast("Ingresa un valor valido");
  if (!supplierInvoiceBoxes.length) {
    try { supplierInvoiceBoxes = (await api.cashBoxes()).boxes || []; } catch { supplierInvoiceBoxes = []; }
  }
  const boxList = supplierInvoiceBoxes.map((b) => b.code).join(", ");
  const boxCode = (prompt(`Caja de donde sale el pago (${boxList || "CAJA_MENOR"}):`, supplierInvoiceBoxes[0]?.code || "CAJA_MENOR") || "").trim();
  if (!boxCode) return toast("Selecciona una caja");
  try {
    await api.paySupplierInvoice(id, { amount, paidDate: todayIso(), boxCode });
    toast("Pago registrado y caja descontada");
    loadSupplierInvoices(selectedSupplier?.id);
  } catch (e) { toast(e.message); }
}

async function voidSupplierInvoiceUI(id) {
  if (!confirm("Anular esta factura recibida?")) return;
  try {
    await api.voidSupplierInvoice(id);
    toast("Factura recibida anulada");
    loadSupplierInvoices(selectedSupplier?.id);
  } catch (e) { toast(e.message); }
}

async function exportSupplierInvoicesUI() {
  try {
    const blob = await api.exportSupplierInvoices({});
    await downloadBlob(blob, `facturas-recibidas-${todayIso()}.xlsx`);
  } catch (e) { toast(e.message); }
}
async function loadPurchaseOrders(supplierId = selectedSupplier?.id) {
  try {
    const { items } = await api.purchaseOrders(supplierId ? { supplierId } : {});
    const box = $("poList");
    if (!box) return;
    box.innerHTML = `<table class="data"><thead><tr><th>Numero</th><th>Fecha</th><th>Proveedor</th><th>Concepto</th><th class="r">IVA</th><th class="r">Total</th><th>Estado</th></tr></thead><tbody>${items.map((o) => `<tr><td>${esc(o.number)}</td><td>${esc(o.date)}</td><td>${esc(o.supplierName)}</td><td>${esc(o.concept || "")}</td><td class="r">${money(o.iva)}</td><td class="r">${money(o.total)}</td><td>${esc(o.status)}</td></tr>`).join("") || '<tr><td class="hint" colspan="7">Sin ordenes</td></tr>'}</tbody></table>`;
  } catch (e) { toast(e.message); }
}
async function savePurchaseOrderUI() {
  const lines = readLineBox("po");
  if (!selectedSupplier) return toast("Selecciona proveedor");
  if (!lines.length) return toast("Agrega al menos una linea");
  try {
    const r = await api.createPurchaseOrder({ supplierId: selectedSupplier.id, supplierName: selectedSupplier.name, date: $("poDate").value || todayIso(), concept: $("poConcept").value.trim(), note: $("poNote").value.trim(), lines });
    toast(`OC ${r.order.number} creada`);
    renderPurchaseOrderForm();
  } catch (e) { toast(e.message); }
}
async function exportPurchaseOrdersUI() {
  try {
    const blob = await api.exportPurchaseOrders({});
    await downloadBlob(blob, `ordenes-compra-${todayIso()}.xlsx`);
  } catch (e) { toast(e.message); }
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
  $("exportClosingDetail")?.addEventListener("click", exportClosingDetailUI);
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
