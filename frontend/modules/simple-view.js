import { $, esc, money, readCop, todayIso, confirmDialog } from "../utils.js";

// MODO SIMPLE (secretaria): una mini-app dentro de su propia seccion, con navegacion
// interna y una pantalla SIMPLE por cada modulo. No reemplaza al programa completo
// (el admin sigue viendo todo el menu); es una segunda interfaz minimalista.
// "Facturar" delega en el asistente de venta real (ya es guiado paso a paso).
export function createSimpleModule(context) {
  const { api, toast, go } = context;
  let root = null;
  let cache = { boxes: [], natures: [] };

  const HOME_TILES = [
    { screen: "facturar", icon: "🧾", title: "Facturar", sub: "Registrar una venta", color: "#1bb760" },
    { screen: "ventas", icon: "📁", title: "Ventas de hoy", sub: "Ver lo facturado", color: "#2457c5" },
    { screen: "clientes", icon: "👤", title: "Clientes", sub: "Buscar cliente", color: "#2457c5" },
    { screen: "llamadas", icon: "📞", title: "Llamadas RTM", sub: "Vencimientos", color: "#7c4dff" },
    { screen: "caja", icon: "💼", title: "Caja", sub: "Saldos del negocio", color: "#0a7d5a" }
  ];

  // Entrada desde el router de la app. Siempre arranca en el inicio del modo simple.
  function renderSimple(container) {
    if (!container) return;
    root = container;
    show("home");
  }

  function show(screen) {
    if (!root) return;
    const screens = { home: scrHome, ventas: scrVentas, ingreso: scrIngreso, gasto: scrGasto, caja: scrCaja, clientes: scrClientes, llamadas: scrLlamadas };
    if (screen === "facturar") { go("venta"); return; } // usa el asistente real (ya es guiado)
    (screens[screen] || scrHome)();
  }

  // Cabecera comun de las sub-pantallas (con boton Inicio).
  function header(title, sub = "") {
    return `<div class="simple-bar">
      <button class="simple-back" id="spBack">← Inicio</button>
      <div class="simple-bar-title">${esc(title)}${sub ? `<small>${esc(sub)}</small>` : ""}</div>
    </div>`;
  }
  function wireBack() { const b = $("spBack"); if (b) b.addEventListener("click", () => show("home")); }

  // ---------- INICIO ----------
  async function scrHome() {
    const today = todayIso();
    const user = api.currentUser?.();
    const fecha = new Date(today + "T12:00:00").toLocaleDateString("es-CO", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
    root.innerHTML = `
      <div class="simple-wrap">
        <div class="simple-hero">
          <div>
            <div class="simple-hello">Hola${user?.name ? ", " + esc(user.name.split(" ")[0]) : ""} 👋</div>
            <div class="simple-date">${esc(fecha)}</div>
          </div>
        </div>
        <div class="simple-kpis" id="simpleKpis">
          <div class="simple-kpi"><span>Ventas de hoy</span><b>…</b></div>
          <div class="simple-kpi"><span>Servicios (RTM) hoy</span><b>…</b></div>
          <div class="simple-kpi"><span>Efectivo a entregar (hoy)</span><b>…</b></div>
        </div>
        <h3 class="simple-h">¿Qué quieres hacer?</h3>
        <div class="simple-tiles">
          ${HOME_TILES.map((t) => `<button class="simple-tile" data-screen="${t.screen}" style="--tile:${t.color}">
            <span class="simple-ico">${t.icon}</span><span class="simple-title">${esc(t.title)}</span><span class="simple-sub">${esc(t.sub)}</span>
          </button>`).join("")}
        </div>
        <p class="hint" style="text-align:center;margin-top:20px">Modo simple. El menú completo sigue disponible a la izquierda.</p>
      </div>`;
    root.querySelectorAll("[data-screen]").forEach((b) => b.addEventListener("click", () => show(b.dataset.screen)));
    try {
      const [dayRes, boxesRes] = await Promise.all([
        api.closingDay(today).catch(() => ({ closing: {} })),
        api.cashBoxes().catch(() => ({ boxes: [] }))
      ]);
      cache.boxes = boxesRes?.boxes || [];
      const cl = dayRes?.closing || {};
      const kpis = $("simpleKpis");
      if (kpis) kpis.innerHTML = `
        <div class="simple-kpi"><span>Ventas de hoy</span><b>${money(cl.salesTotal || 0)}</b></div>
        <div class="simple-kpi"><span>Servicios (RTM) hoy</span><b>${(cl.rtmRealizadas || 0)}/${(cl.rtmFacturadas || 0)}</b></div>
        <div class="simple-kpi"><span>Efectivo a entregar (hoy)</span><b>${money(cl.efectivoEntregar || 0)}</b></div>`;
    } catch (e) { toast(e.message); }
  }

  // ---------- VENTAS DE HOY (solo lectura) ----------
  async function scrVentas() {
    root.innerHTML = `${header("Ventas de hoy")}<div class="simple-card"><div id="spVentasBody"><p class="hint">Cargando…</p></div></div>`;
    wireBack();
    try {
      const today = todayIso();
      const items = await api.listSales({ date: today });
      const list = Array.isArray(items) ? items : (items.items || []);
      const activas = list.filter((s) => s.status !== "anulada");
      const total = activas.reduce((a, s) => a + (s.total || 0), 0);
      $("spVentasBody").innerHTML = `
        <div class="simple-kpis">
          <div class="simple-kpi"><span>Ventas activas</span><b>${activas.length}</b></div>
          <div class="simple-kpi"><span>Total facturado</span><b>${money(total)}</b></div>
        </div>
        <table class="data"><thead><tr><th>Venta</th><th>Cliente</th><th>Placa</th><th>RTM</th><th class="r">Total</th></tr></thead><tbody>${
          list.map((s) => `<tr style="${s.status === "anulada" ? "opacity:.5;text-decoration:line-through" : ""}">
            <td>${esc(s.saleNumber)}</td><td>${esc(s.clientName)}</td><td>${esc(s.plate || "")}</td>
            <td>${s.rtmStatus === "done" ? "✅ hecha" : s.rtmStatus === "pending" ? "⏳ pendiente" : esc(s.rtmStatus)}</td>
            <td class="r"><b>${money(s.total)}</b></td></tr>`).join("") || '<tr><td class="hint" colspan="5">Aún no hay ventas hoy</td></tr>'
        }</tbody></table>`;
    } catch (e) { $("spVentasBody").innerHTML = `<p class="hint">${esc(e.message)}</p>`; }
  }

  // ---------- INGRESO ----------
  async function ensureCatalog() {
    if (!cache.boxes.length) { try { cache.boxes = ((await api.cashBoxes()).boxes) || []; } catch { cache.boxes = []; } }
    if (!cache.natures.length) { try { cache.natures = ((await api.expenseNatures()).items) || []; } catch { cache.natures = []; } }
  }
  function isIncomeBox(b) {
    const kind = String(b.kind || "").toLowerCase();
    const name = String(b.name || "").toLowerCase();
    return kind === "caja_menor" || kind === "otra" || kind === "banco" || kind.startsWith("provision_") || name.includes("banco") || name.includes("provision");
  }
  async function scrIngreso() {
    root.innerHTML = `${header("Registrar ingreso")}<div class="simple-card" id="spIngBody"><p class="hint">Cargando…</p></div>`;
    wireBack();
    await ensureCatalog();
    const boxOpts = cache.boxes.filter(isIncomeBox).map((b) => `<option value="${esc(b.code)}"${b.code === "CAJA_MENOR" ? " selected" : ""}>${esc(b.name)}</option>`).join("");
    const natOpts = cache.natures.filter((n) => ["ingreso", "ambos"].includes(String(n.kind || "").toLowerCase())).map((n) => `<option value="${esc(n.code)}">${esc(n.name)}</option>`).join("");
    $("spIngBody").innerHTML = `
      <label class="simple-fld">¿Cuánto entró?<input id="spInValue" inputmode="numeric" placeholder="$" /></label>
      <label class="simple-fld">¿Por qué? (motivo)<input id="spInObs" placeholder="Ej: retiro del banco, abono…" /></label>
      <label class="simple-fld">Tipo de ingreso<select id="spInNat"><option value="">Sin clasificar</option>${natOpts}</select></label>
      <label class="simple-fld">¿A dónde entra?<select id="spInBox">${boxOpts}</select></label>
      <button class="btn success simple-bigbtn" id="spInSave">Guardar ingreso</button>`;
    $("spInSave").addEventListener("click", async () => {
      const value = readCop("spInValue");
      const observation = $("spInObs").value.trim();
      if (value <= 0) return toast("Escribe el valor");
      if (!observation) return toast("Escribe el motivo");
      try {
        await api.addIncome({ date: todayIso(), value, observation, natureCode: $("spInNat").value || null, boxCode: $("spInBox").value || "CAJA_MENOR" });
        toast(`Ingreso de ${money(value)} guardado`);
        $("spInValue").value = ""; $("spInObs").value = "";
      } catch (e) { toast(e.message); }
    });
  }

  // ---------- GASTO ----------
  async function scrGasto() {
    root.innerHTML = `${header("Registrar gasto")}<div class="simple-card" id="spGxBody"><p class="hint">Cargando…</p></div>`;
    wireBack();
    await ensureCatalog();
    const boxOpts = cache.boxes.map((b) => `<option value="${esc(b.code)}"${b.code === "CAJA_MENOR" ? " selected" : ""}>${esc(b.name)}</option>`).join("");
    const natOpts = cache.natures.filter((n) => ["gasto", "ambos"].includes(String(n.kind || "").toLowerCase())).map((n) => `<option value="${esc(n.code)}">${esc(n.name)}</option>`).join("");
    $("spGxBody").innerHTML = `
      <label class="simple-fld">¿Cuánto se gastó?<input id="spGxAmount" inputmode="numeric" placeholder="$" /></label>
      <label class="simple-fld">¿En qué? (concepto)<input id="spGxConcept" placeholder="Ej: papelería, almuerzo…" /></label>
      <label class="simple-fld">Tipo de gasto<select id="spGxNat"><option value="">Sin clasificar</option>${natOpts}</select></label>
      <label class="simple-fld">¿De qué caja sale?<select id="spGxBox">${boxOpts}</select></label>
      <button class="btn danger simple-bigbtn" id="spGxSave">Guardar gasto</button>`;
    $("spGxSave").addEventListener("click", async () => {
      const amount = readCop("spGxAmount");
      const concept = $("spGxConcept").value.trim();
      if (amount <= 0) return toast("Escribe el valor");
      if (!concept) return toast("Escribe el concepto");
      try {
        await api.addExpense({ date: todayIso(), concept, amount, category: $("spGxNat").value || "", boxCode: $("spGxBox").value || "CAJA_MENOR" });
        toast(`Gasto de ${money(amount)} guardado`);
        $("spGxAmount").value = ""; $("spGxConcept").value = "";
      } catch (e) { toast(e.message); }
    });
  }

  // ---------- CAJA (saldos + cerrar día/dispersar + pagar Supergiros) ----------
  async function scrCaja() {
    root.innerHTML = `${header("Caja")}
      <div class="simple-bar" style="margin-top:-6px">
        <label class="simple-fld" style="margin:0;font-weight:700">Día&nbsp;<input type="date" id="spCajaDate" value="${todayIso()}" style="display:inline-block;width:auto;margin:0;padding:8px 10px;font-size:14px" /></label>
        <button class="btn primary" id="spCajaVer">Ver</button>
      </div>
      <div class="simple-card" id="spCajaBody"><p class="hint">Cargando…</p></div>`;
    wireBack();
    $("spCajaVer").addEventListener("click", () => loadCaja($("spCajaDate").value || todayIso()));
    await loadCaja(todayIso());
  }
  async function loadCaja(date) {
    const box = $("spCajaBody");
    if (!box) return;
    box.innerHTML = `<p class="hint">Cargando…</p>`;
    try {
      const [boxesRes, day] = await Promise.all([api.cashBoxes(), api.closingDay(date)]);
      cache.boxes = boxesRes.boxes || [];
      const c = day.closing || {};
      const snap = day.snapshot;
      const pay = day.payable; // deuda Supergiros (Jasper) del día

      const saldos = `<div class="simple-kpis">${
        cache.boxes.map((b) => `<div class="simple-kpi"><span>${esc(b.name)}</span><b>${money(b.balance || 0)}</b></div>`).join("")
      }</div>`;

      const cierre = `
        <h3 class="simple-h" style="text-align:left;margin-top:18px">Cierre del día ${esc(date)}</h3>
        <div class="simple-kpis">
          <div class="simple-kpi"><span>Ventas del día</span><b>${money(c.salesTotal || 0)}</b></div>
          <div class="simple-kpi"><span>Efectivo a caja menor</span><b>${money(c.efectivoEntregar || 0)}</b></div>
          <div class="simple-kpi"><span>Jasper (deuda Supergiros)</span><b>${money(c.jasper || 0)}</b></div>
        </div>
        ${snap
          ? `<div class="simple-note ok">✅ Día cerrado y dispersado. El efectivo entró a caja menor y se creó la deuda con Supergiros.</div>`
          : `<div class="simple-note off">⚠️ Día SIN cerrar. El dinero todavía no se ha dispersado.</div>`}
        <button class="btn ${snap ? "" : "success"} simple-bigbtn" id="spDisperse">${snap ? "Re-cerrar día (actualizar dispersión)" : "Cerrar día y dispersar"}</button>`;

      const deuda = pay
        ? `<h3 class="simple-h" style="text-align:left;margin-top:18px">Deuda con Supergiros</h3>
           <div class="simple-kpis">
             <div class="simple-kpi"><span>Total Jasper</span><b>${money(pay.totalAmount || 0)}</b></div>
             <div class="simple-kpi"><span>Pagado</span><b>${money(pay.paidAmount || 0)}</b></div>
             <div class="simple-kpi"><span>Pendiente</span><b>${money(pay.pending || 0)}</b></div>
           </div>
           ${pay.pending > 0
             ? `<button class="btn danger simple-bigbtn" id="spPaySG">Pagar a Supergiros ${money(pay.pending)} (sale de caja menor)</button>`
             : `<div class="simple-note ok">✅ Supergiros pagado por completo.</div>`}`
        : (snap ? `<p class="hint">Este día no generó deuda con Supergiros (sin RTM).</p>` : "");

      box.innerHTML = saldos + cierre + deuda + `<p class="hint" style="margin-top:14px">Los saldos de arriba son actuales; el cierre y la deuda son del día seleccionado.</p>`;

      $("spDisperse").addEventListener("click", async () => {
        if (!(await confirmDialog(`El efectivo a entregar entra a caja menor y el Jasper queda como deuda con Supergiros.`, { title: `¿Cerrar y dispersar el día ${date}?`, okText: "Cerrar y dispersar" }))) return;
        try {
          await api.saveClosing({ date });
          toast("Día cerrado · efectivo a caja menor · deuda Supergiros creada");
          loadCaja(date);
        } catch (e) { toast(e.message); }
      });
      const paySG = $("spPaySG");
      if (paySG) paySG.addEventListener("click", async () => {
        if (!(await confirmDialog(`Se registrará el pago de ${money(pay.pending)} a Supergiros, saliendo de caja menor.`, { title: "¿Pagar a Supergiros?", okText: "Pagar", danger: true }))) return;
        const body = { amount: pay.pending, paidDate: todayIso(), boxCode: "CAJA_MENOR", paidBy: api.currentUser?.()?.name || null };
        try {
          await api.payPayable(pay.id, body);
          toast("Pago a Supergiros registrado");
          loadCaja(date);
        } catch (e) {
          if (/insuficient/i.test(e.message) && (await confirmDialog(`${e.message}.\n¿Pagar igual? La caja menor quedará en negativo.`, { title: "Fondos insuficientes", okText: "Pagar igual", danger: true }))) {
            try { await api.payPayable(pay.id, { ...body, force: true }); toast("Pago registrado (forzado)"); loadCaja(date); }
            catch (e2) { toast(e2.message); }
          } else { toast(e.message); }
        }
      });
    } catch (e) { box.innerHTML = `<p class="hint">${esc(e.message)}</p>`; }
  }

  // ---------- CLIENTES (buscar) ----------
  async function scrClientes() {
    root.innerHTML = `${header("Clientes")}<div class="simple-card">
      <label class="simple-fld">Buscar por nombre o cédula<input id="spCliQ" placeholder="Escribe y espera…" autocomplete="off" /></label>
      <div id="spCliBody"><p class="hint">Escribe para buscar.</p></div></div>`;
    wireBack();
    let t;
    $("spCliQ").addEventListener("input", (e) => {
      clearTimeout(t);
      const q = e.target.value.trim();
      if (q.length < 2) { $("spCliBody").innerHTML = `<p class="hint">Escribe al menos 2 letras.</p>`; return; }
      t = setTimeout(async () => {
        try {
          const items = await api.findClients(q);
          const list = Array.isArray(items) ? items : (items.items || []);
          $("spCliBody").innerHTML = `<table class="data"><thead><tr><th>Cliente</th><th>Cédula/NIT</th><th>Teléfono</th></tr></thead><tbody>${
            list.map((c) => `<tr><td><b>${esc(c.name)}</b></td><td>${esc(c.docNumber)}</td><td>${esc(c.phone || "")}</td></tr>`).join("") || '<tr><td class="hint" colspan="3">Sin resultados</td></tr>'
          }</tbody></table>`;
        } catch (e) { $("spCliBody").innerHTML = `<p class="hint">${esc(e.message)}</p>`; }
      }, 350);
    });
  }

  // ---------- LLAMADAS (vencimientos RTM por contactar) ----------
  async function scrLlamadas() {
    root.innerHTML = `${header("Llamadas RTM", "vencimientos próximos 30 días")}<div class="simple-card" id="spLlBody"><p class="hint">Cargando…</p></div>`;
    wireBack();
    try {
      const { items } = await api.calls();
      $("spLlBody").innerHTML = `<p class="hint">${(items || []).length} cliente(s) con RTM por vencer.</p>
        <table class="data"><thead><tr><th>Vence</th><th>Cliente</th><th>Placa</th><th>Teléfono</th></tr></thead><tbody>${
          (items || []).map((c) => `<tr><td>${esc(c.dueDate)}</td><td>${esc(c.clientName)}</td><td>${esc(c.plate || "")}</td><td>${esc(c.phone || "")}</td></tr>`).join("") || '<tr><td class="hint" colspan="4">Nada por vencer</td></tr>'
        }</tbody></table>`;
    } catch (e) { $("spLlBody").innerHTML = `<p class="hint">${esc(e.message)}</p>`; }
  }

  return { renderSimple };
}
