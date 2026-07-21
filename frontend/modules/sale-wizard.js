import { $, esc, money, readCop, todayIso, MOTO_PLATE_RE, PIN_RE, CO_MOBILE_RE, normalizeCoPhone, isValidName, isValidDoc } from "../utils.js";

export function createSaleModule(context) {
  const { api, catalog, productByCode, methodByCode, toast } = context;
  function payVisual(m) {
    const s = `${m.code || ""} ${m.name || ""}`.toUpperCase();
    if (s.includes("EFECTIVO")) return { ico: "💵", cls: "green" };
    if (s.includes("QR")) return { ico: "📲", cls: "indigo" };
    if (s.includes("DATAFONO") || s.includes("TARJETA")) return { ico: "💳", cls: "blue" };
    if (s.includes("TRANSFER")) return { ico: "🏦", cls: "teal" };
    if (s.includes("ADDI")) return { ico: "🅰️", cls: "amber" };
    if (s.includes("GORA")) return { ico: "🤝", cls: "teal" };
    if (s.includes("CUPON") || s.includes("DESCUENTO")) return { ico: "🎟️", cls: "amber" };
    if (s.includes("CREDITO")) return { ico: "📄", cls: "amber" };
    return { ico: "💳", cls: "blue" };
  }

  // ---------- Estado de la venta (wizard) ----------
  function blankSale() {
    return {
      saleDate: todayIso(), // dia operativo de la venta (el admin puede backdatear)
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
  // ¿Hay pago por SuperGiros (Datafono SG / QR SG)? Si lo hay, la RTM no puede quedar pendiente.
  const hasSupergiros = () => sale.payments.some((p) => methodByCode[p.methodCode]?.groupCode === "SG");

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
      case "moto": return !!sale.vehicle.plate && !!sale.vehicle.modelYear && !!sale.packageCode;
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
            <select id="cNewDocType" title="Tipo de documento">
              <option value="CC">CC · Cédula de ciudadanía</option>
              <option value="NIT">NIT · Empresa</option>
              <option value="CE">CE · Cédula de extranjería</option>
              <option value="TI">TI · Tarjeta de identidad</option>
              <option value="PA">PA · Pasaporte</option>
              <option value="PEP">PEP · Permiso especial</option>
            </select>
            <input id="cNewDoc" placeholder="Número de documento" />
            <input id="cName" placeholder="Nombre completo" />
            <input id="cPhone" placeholder="Celular (3XXXXXXXXX)" inputmode="numeric" maxlength="13" />
            <button class="btn primary" id="cSave">Guardar y continuar</button>
          </div>`, false);
      case "moto":
        return card(key, "2 · Moto", `
          <div class="row" style="align-items:flex-start">
            <div class="lookup" style="flex:2 1 200px">
              <input id="vPlate" autocomplete="off" placeholder="Placa" maxlength="8" style="text-transform:uppercase" />
              <div id="vehicleSuggest" class="suggest hidden"></div>
            </div>
            <input id="vYear" type="number" placeholder="Año modelo *" min="1980" max="2035" required style="flex:1 1 120px" />
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
            <input type="text" inputmode="numeric" data-payamt="${i}" value="${pay.amount ? money(pay.amount) : ""}" placeholder="$0" />
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
        // Con cupón/descuento el cliente debe ser DIRECTO: no se ofrece referido.
        const hasCupon = sale.payments.some((p) => p.methodCode === "DESCUENTO_FENIX");
        const referidoBtn = hasCupon
          ? `<button class="bigchoice blue" disabled style="opacity:.45;cursor:not-allowed"><span class="bc-ico">🤝</span><span class="bc-main">REFERIDO</span><span class="bc-sub">No aplica con cupón</span></button>`
          : `<button class="bigchoice blue" data-ally="referido"><span class="bc-ico">🤝</span><span class="bc-main">REFERIDO</span><span class="bc-sub">Lo trajo un convenio</span></button>`;
        return card(key, "6 · ¿Cómo llegó el cliente?", `
          ${hasCupon ? `<div class="hint" style="margin-bottom:8px">🎟️ Esta venta tiene cupón/descuento: el cliente debe ser <b>directo</b>.</div>` : ""}
          <div class="bigchoices">
            <button class="bigchoice green" data-ally="usuario"><span class="bc-ico">🧑</span><span class="bc-main">DIRECTO</span><span class="bc-sub">Cliente fidelizado</span></button>
            ${referidoBtn}
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
      case "rtmHoy": {
        const sg = hasSupergiros();
        const pendienteBtn = sg
          ? `<button class="bigchoice amber" disabled style="opacity:.45;cursor:not-allowed"><span class="bc-ico">⏳</span><span class="bc-main">QUEDA PENDIENTE</span><span class="bc-sub">No aplica con SuperGiros</span></button>`
          : `<button class="bigchoice amber" data-today="no"><span class="bc-ico">⏳</span><span class="bc-main">QUEDA PENDIENTE</span><span class="bc-sub">Va a provisión</span></button>`;
        return card(key, "7 · ¿Cuándo hace la RTM?", `
          ${sg ? `<div class="hint" style="margin-bottom:8px">💳 Pago por SuperGiros: la RTM debe realizarse <b>hoy</b> (genera PIN). No puede quedar pendiente.</div>` : ""}
          <div class="bigchoices">
            <button class="bigchoice green" data-today="si"><span class="bc-ico">✅</span><span class="bc-main">HOY MISMO</span><span class="bc-sub">Genera PIN ahora</span></button>
            ${pendienteBtn}
          </div>`, false);
      }
      case "pin":
        return card(key, "7b · PIN SuperFlex", `
          <label class="fld">PIN generado (19 o 20 digitos)
            <input id="pinNumber" inputmode="numeric" maxlength="20" placeholder="00000000000000000000" value="${esc(sale.pinNumber)}" />
          </label>
          <div class="hint">Obligatorio porque la RTM se realiza hoy. Debe ser numerico de 19 o 20 digitos (SICOV).</div>
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
              <input id="provPin_${p.saleId}" inputmode="numeric" maxlength="20" placeholder="PIN 19-20 digitos" style="max-width:180px" />
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
      case "resumen": {
        const canBackdate = api.currentUser()?.role === "admin" || !!api.cachedPerms()?.canBackdate;
        const dateField = canBackdate ? `
          <label class="fld" style="max-width:220px;margin-bottom:10px">Fecha de la venta <span class="hint">(facturar día anterior)</span>
            <input id="saleDate" type="date" value="${esc(sale.saleDate)}" max="${todayIso()}" />
          </label>
          ${sale.saleDate !== todayIso() ? `<div class="hint" style="color:#b45309;margin-bottom:8px">⚠️ Esta venta se registrará con fecha <b>${esc(sale.saleDate)}</b> (día operativo distinto a hoy).</div>` : ""}` : "";
        return card(key, "8 · Resumen y registro", `
          ${dateField}
          <div class="hint">Revisa el resumen a la derecha.</div>
          <button class="btn success big" id="registerBtn">Registrar venta</button>`, false);
      }
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

  // Pantalla limpia al terminar: oculta los pasos editables para que no se reedite
  // ni se reenvie la venta anterior por error.
  function renderCompleted() {
    const s = sale.registered.sale;
    const facturada = s.dianStatus === "facturada";
    return `<div class="step done done-screen" style="text-align:center;padding:28px 18px">
      <div style="font-size:46px;line-height:1">✅</div>
      <h2 style="margin:10px 0 2px">Venta ${esc(s.saleNumber)} registrada</h2>
      <p class="hint">${esc(s.clientName)}${s.plate ? " · " + esc(s.plate) : ""}</p>
      <div class="amount total" style="justify-content:center;max-width:260px;margin:8px auto"><span>Total</span><b>${money(s.total)}</b></div>
      ${facturada
        ? `<div class="pill ok" style="display:inline-block;margin:8px 0">Factura ${esc(s.invoiceNumber)}</div>
           <div style="margin:12px 0"><button class="btn primary big" id="printInvoiceBtn">🖨️ Imprimir factura</button></div>`
        : `<div style="margin:12px 0;display:flex;gap:10px;justify-content:center;flex-wrap:wrap">
             <button class="btn big" id="printSaleBtn">🖨️ Imprimir venta ${esc(s.saleNumber)}</button>
             <button class="btn primary big" id="invoiceBtn">Emitir factura</button>
           </div>
           <p class="hint">Imprime el comprobante interno de la venta; si emites la factura, ahí sí se imprime la factura.</p>`}
      <div style="margin-top:18px"><button class="btn success big" id="newSale">🧾 Hacer otra venta</button></div>
    </div>`;
  }

  // Comprobante imprimible: abre una ventana limpia con la factura y lanza el diálogo de impresión.
  // No muestra los métodos de pago (el cupón/descuento NO debe aparecer en la factura).
  function printInvoice() {
    const s = sale.registered.sale;
    const facturada = s.dianStatus === "facturada";
    const lines = sale.registered.lines || (sale.packageCode ? computeLines(sale.packageCode).map((l) => ({ description: l.name, quantity: l.quantity || 1, unitPrice: l.unitPrice, total: l.total })) : []);
    const rows = lines.map((l) => `<tr><td>${esc(l.description)}</td><td class="c">${l.quantity || 1}</td><td class="r">${money(l.unitPrice)}</td><td class="r">${money(l.total)}</td></tr>`).join("");
    const fecha = new Date().toLocaleString("es-CO", { dateStyle: "medium", timeStyle: "short" });
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>Factura ${esc(s.invoiceNumber || s.saleNumber)}</title>
      <style>
        *{font-family:Arial,Helvetica,sans-serif;box-sizing:border-box}
        body{margin:0;padding:16px;color:#111}
        .doc{max-width:520px;margin:0 auto}
        h1{font-size:18px;margin:0}
        .muted{color:#555;font-size:12px}
        .head{border-bottom:2px solid #111;padding-bottom:8px;margin-bottom:10px}
        .grid{display:flex;justify-content:space-between;font-size:13px;margin:2px 0}
        table{width:100%;border-collapse:collapse;margin-top:10px;font-size:13px}
        th,td{padding:6px 4px;border-bottom:1px solid #ddd;text-align:left}
        th{border-bottom:1px solid #111}
        td.r,th.r{text-align:right} td.c,th.c{text-align:center}
        .tot{display:flex;justify-content:space-between;font-size:14px;margin:3px 0}
        .tot.big{font-weight:bold;font-size:16px;border-top:2px solid #111;padding-top:6px;margin-top:6px}
        .foot{margin-top:18px;font-size:11px;color:#666;text-align:center}
        @media print{body{padding:0}}
      </style></head>
      <body onload="window.print()">
        <div class="doc">
          <div class="head">
            <h1>RTM Motos · Girardot</h1>
            <div class="muted">Revisión Tecnomecánica</div>
            <div class="muted">${facturada && s.invoiceNumber ? "Factura " + esc(s.invoiceNumber) : "Comprobante de venta (documento interno)"} · ${esc(s.saleNumber)}</div>
          </div>
          <div class="grid"><span>Fecha</span><b>${esc(fecha)}</b></div>
          <div class="grid"><span>Cliente</span><b>${esc(s.clientName)}</b></div>
          <div class="grid"><span>Documento</span><b>${esc(s.clientDoc || "")}</b></div>
          ${s.plate ? `<div class="grid"><span>Placa / modelo</span><b>${esc(s.plate)}${s.modelYear ? " · " + s.modelYear : ""}</b></div>` : ""}
          <table>
            <thead><tr><th>Concepto</th><th class="c">Cant.</th><th class="r">V. unit.</th><th class="r">Total</th></tr></thead>
            <tbody>${rows || '<tr><td colspan="4">—</td></tr>'}</tbody>
          </table>
          <div style="margin-top:10px">
            <div class="tot"><span>Base</span><span>${money(s.totalBase)}</span></div>
            <div class="tot"><span>IVA</span><span>${money(s.totalIva)}</span></div>
            <div class="tot big"><span>Total</span><span>${money(s.total)}</span></div>
          </div>
          ${s.pinNumber ? `<div class="muted" style="margin-top:10px">PIN RUNT: ${esc(s.pinNumber)}</div>` : ""}
          <div class="foot">Gracias por su visita</div>
        </div>
      </body></html>`;
    const w = window.open("", "_blank", "width=560,height=720");
    if (!w) { toast("Permite las ventanas emergentes para imprimir"); return; }
    w.document.write(html);
    w.document.close();
    w.focus();
  }

  function renderWizard() {
    if (sale.registered) {
      $("wizard").innerHTML = renderCompleted();
      wireWizard();
      return;
    }
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
  }
  function renderReceipt(reg) {
    const s = reg.sale;
    const facturada = s.dianStatus === "facturada";
    return `<div class="receipt">
      <div><b>${esc(s.saleNumber)}</b> · ${esc(s.clientName)}</div>
      <div class="hint">Estado RTM: ${esc(s.rtmStatus)} · ${facturada ? `Factura ${esc(s.invoiceNumber)}` : "Sin facturar"}</div>
    </div>`;
  }

  // ---------- Wiring ----------
  function wireWizard() {
    $("newSale")?.addEventListener("click", () => { sale = blankSale(); render(); });
    $("invoiceBtn")?.addEventListener("click", emitInvoice);
    $("printInvoiceBtn")?.addEventListener("click", printInvoice);
    $("printSaleBtn")?.addEventListener("click", printInvoice); // sin factura imprime el comprobante de venta (VTA)
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
        if (!year) return toast("Ingresa el año del modelo");
        if (year < 1980 || year > 2035) return toast("El año del modelo no es válido");
        const range = rangeFromModel(year);
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

    // Pago mixto — el nuevo metodo arranca con lo que falta (no el total completo).
    // El cupón/descuento arranca VACÍO ($0): la cajera escribe el valor del cupón.
    document.querySelectorAll("[data-pay]").forEach((b) => b.addEventListener("click", () => {
      const code = b.dataset.pay;
      const { total } = saleTotals();
      const remaining = Math.max(0, total - paidAmount());
      sale.payments.push({ methodCode: code, amount: code === "DESCUENTO_FENIX" ? 0 : remaining });
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
        // Venta directa: NO lleva descuento automatico. El descuento solo existe si la
        // cajera agrego un cupon (DESCUENTO_FENIX) en los pagos.
        sale.allyType = "usuario"; sale.allyName = "USUARIO"; sale.discountApplied = false; sale.allyAnswered = true; render();
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
      if (b.dataset.today === "no" && hasSupergiros()) { toast("Pago por SuperGiros: la RTM no puede quedar pendiente, debe hacerse hoy."); return; }
      sale.rtmToday = b.dataset.today === "si"; sale.rtmTodayAnswered = true; sale.pinNumber = ""; render();
    }));

    $("pinNext")?.addEventListener("click", () => {
      const pin = ($("pinNumber").value || "").trim();
      if (!PIN_RE.test(pin)) return toast("El PIN debe tener 19 o 20 digitos numericos");
      sale.pinNumber = pin;
      render();
    });

    $("saleDate")?.addEventListener("change", (e) => { sale.saleDate = e.target.value || todayIso(); render(); });
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
      if (/^\d+$/.test(val)) {
        $("cNewDoc").value = val;
        // Sugerencia de tipo: 6-10 digitos = CC, mas largo (NIT) = NIT. El usuario puede cambiarlo.
        $("cNewDocType").value = /^\d{6,10}$/.test(val) ? "CC" : "NIT";
        $("cName").focus();
      } else { $("cName").value = val; $("cNewDoc").focus(); }
    } catch (e) { toast(e.message); }
  }
  async function saveNewClient() {
    const docNumber = $("cNewDoc").value.trim();
    const name = $("cName").value.trim();
    if (!docNumber || !name) return toast("Documento y nombre obligatorios");
    const docType = $("cNewDocType")?.value || (/^\d{6,10}$/.test(docNumber) ? "CC" : "NIT");
    const phone = normalizeCoPhone($("cPhone").value);
    if (!isValidName(name)) return toast("El nombre debe tener al menos 3 caracteres y no ser solo numeros.");
    if (!isValidDoc(docNumber, docType)) return toast(docType === "NIT" ? "El NIT debe tener 9 o 10 digitos (solo numeros)." : "La cedula debe tener entre 6 y 10 digitos (solo numeros).");
    if (!phone) return toast("El telefono es obligatorio.");
    if (!CO_MOBILE_RE.test(phone)) return toast("Telefono invalido: debe ser un celular de 10 digitos que empiece en 3.");
    try {
      const c = await api.saveClient({ docNumber, name, phone, docType });
      selectClient(c);
    } catch (e) { toast(e.message); }
  }
  async function registerSale() {
    try {
      const body = {
        date: sale.saleDate || todayIso(),
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
      if (!PIN_RE.test(pinNumber)) return toast("El PIN debe tener 19 o 20 digitos numericos");
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
      printInvoice(); // muestra el comprobante para imprimir apenas se emite
    } catch (e) { toast(e.message); }
  }

  function render() { renderWizard(); renderSummary(); }
  return { render };
}
