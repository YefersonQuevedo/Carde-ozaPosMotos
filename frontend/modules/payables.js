import { $, esc, money, readCop, todayIso, downloadBlob } from "../utils.js";

export function createPayablesModule(context) {
  const { api, toast, editSale } = context;
  let expenseNatures = [];
  let boxes = [];
  let creditors = [];
  const PAY_FREQ = ["unico", "mensual", "bimestral", "cuotas"];
  const PAY_BADGE = { pagado: "ok", parcial: "warn", pendiente: "danger" };

  function currentFilters() {
    return {
      creditor: $("pyfCreditor")?.value || "",
      from: $("pyfFrom")?.value || "",
      to: $("pyfTo")?.value || "",
      status: $("pyfStatus")?.value || ""
    };
  }
  function cleanFilters() {
    const f = currentFilters();
    return Object.fromEntries(Object.entries(f).filter(([, v]) => v));
  }
  function boxBalanceOf(code) {
    const b = boxes.find((x) => x.code === code);
    return b ? b.balance : 0;
  }

  async function renderPayables(c) {
    if (!c) return;
    try { expenseNatures = ((await api.expenseNatures()).items) || expenseNatures || []; } catch { expenseNatures = expenseNatures || []; }
    try { boxes = ((await api.cashBoxes()).boxes) || []; } catch { boxes = []; }
    const natOpts = (expenseNatures || []).map((n) => `<option value="${esc(n.code)}">${esc(n.name)}</option>`).join("");
    c.innerHTML = `
      <div class="card">
        <div class="card-head"><h2>Tablero de caja</h2>
          <button class="btn success" id="cmIngresoBtn">+ Ingresar dinero a caja menor</button>
        </div>
        <div id="pyKpis" class="kpis"></div>
        <div id="cmIngresoForm"></div>
        <p class="hint">La caja menor recibe el efectivo de los cierres del día y los retiros del banco; de ahí salen los pagos a Supergiros (Jasper) y los gastos.</p>
      </div>
      <div class="card">
        <div class="card-head"><h2>Cierre del día — turnos y dispersión</h2>
          <div class="row">
            <input type="date" id="dcDate" value="${todayIso()}" />
            <button class="btn primary" id="dcLoad">Ver</button>
          </div>
        </div>
        <p class="hint">Al cerrar el día se dispersa: el efectivo a entregar entra a caja menor y el Jasper queda como deuda con Supergiros para pagarla desde acá.</p>
        <div id="dcBody"><p class="hint">Cargando…</p></div>
      </div>
      <div class="card">
        <div class="card-head"><h2>Detalle de movimientos</h2>
          <div class="row">
            <select id="ledBox">${boxes.map((b) => `<option value="${esc(b.code)}"${b.code === "CAJA_MENOR" ? " selected" : ""}>${esc(b.name)}</option>`).join("")}</select>
            <label class="rng">Desde <input type="date" id="ledFrom" /></label>
            <label class="rng">Hasta <input type="date" id="ledTo" /></label>
            <button class="btn primary" id="ledLoad">Ver</button>
          </div>
        </div>
        <div id="ledTotals" class="pill"></div>
        <div id="ledBody"></div>
      </div>
      <div class="card">
        <div class="card-head"><h2>Nueva obligacion</h2></div>
        <div class="form-grid">
          <label class="fld">Concepto *<input id="pyConcept" placeholder="Ej: Arriendo junio, cuota equipo…" /></label>
          <label class="fld">Acreedor / proveedor<input id="pyCreditor" placeholder="Ej: SUPERGIROS, GORA, arrendador" /></label>
          <label class="fld">Naturaleza<select id="pyCategory"><option value="">Sin naturaleza</option>${natOpts}</select></label>
          <label class="fld">Total *<input id="pyTotal" inputmode="numeric" placeholder="$" /></label>
          <label class="fld">Frecuencia<select id="pyFreq">${PAY_FREQ.map((f) => `<option value="${f}">${f}</option>`).join("")}</select></label>
          <label class="fld">Fecha estimada<input type="date" id="pyDue" /></label>
        </div>
        <div class="row form-actions"><button class="btn success" id="pySave">Agregar</button></div>
      </div>
      <div class="card">
        <div class="card-head"><h2>Cuentas por pagar</h2>
          <div class="row">
            <select id="pyfCreditor"><option value="">Todo proveedor</option></select>
            <label class="rng">Desde <input type="date" id="pyfFrom" /></label>
            <label class="rng">Hasta <input type="date" id="pyfTo" /></label>
            <select id="pyfStatus"><option value="">Todo estado</option><option value="pendiente">Pendiente</option><option value="parcial">Parcial</option><option value="pagado">Pagado</option></select>
            <button class="btn primary" id="pyFilter">Filtrar</button>
            <button class="btn ghost" id="pyExport">Exportar Excel</button>
          </div>
        </div>
        <div id="pyTotals" class="pill warn"></div>
        <div id="pyBody"></div>
        <div id="pyDrill" style="margin-top:12px"></div>
      </div>`;
    $("pySave").addEventListener("click", addPayableUI);
    $("pyFilter").addEventListener("click", loadPayables);
    $("pyExport").addEventListener("click", async () => { try { await downloadBlob(await api.exportPayables(cleanFilters()), "cuentas-por-pagar.xlsx"); } catch (e) { toast(e.message); } });
    $("ledLoad").addEventListener("click", loadLedger);
    $("dcLoad").addEventListener("click", loadDayClose);
    $("cmIngresoBtn").addEventListener("click", toggleCmIngreso);
    await loadPayables();
    await loadDayClose();
    await loadLedger();
  }

  // Consolidado de los turnos del día + estado de la dispersión (cuadre con Jasper).
  // Aquí se cierra el día: el efectivo entra a caja menor y el Jasper queda por pagar.
  async function loadDayClose() {
    const box = $("dcBody");
    if (!box) return;
    const date = $("dcDate")?.value || todayIso();
    try {
      const d = await api.closingDay(date);
      const c = d.closing || {};
      const shifts = d.shifts || [];
      const cerrados = shifts.filter((s) => s.status === "cerrado");
      const abiertos = shifts.filter((s) => s.status === "abierto");
      const sum = (k) => cerrados.reduce((a, s) => a + (s[k] || 0), 0);
      const tEsperado = sum("expectedCash"), tContado = cerrados.reduce((a, s) => a + (s.countedCash ?? 0), 0),
        tDiff = sum("cashDiff"), tVentas = sum("salesTotal"), tJasper = sum("jasper");

      const rows = shifts.map((s) => `<tr>
        <td><b>#${s.number}</b></td>
        <td><span class="pill ${s.status === "abierto" ? "warn" : "ok"}">${esc(s.status)}</span></td>
        <td>${esc(s.openedBy || "")}</td>
        <td class="r">${money(s.expectedCash)}</td>
        <td class="r">${s.countedCash == null ? "-" : money(s.countedCash)}</td>
        <td class="r">${s.status === "cerrado" ? `<b class="${s.cashDiff < 0 ? "neg" : ""}">${money(s.cashDiff)}</b>` : "-"}</td>
        <td class="r">${money(s.salesTotal)}</td>
        <td class="r">${money(s.jasper)}</td>
        <td><button class="link" data-dcshift="${s.id}" data-num="${s.number}">ver ventas ▸</button></td>
      </tr>`).join("");

      // Cuadre: la suma de los turnos cerrados debe dar el consolidado del día.
      // Si no cuadra (ventas editadas, turno sin cerrar) se avisa para revisar el detalle.
      const jasperDia = Math.round(c.jasper || 0);
      const efectivoDia = Math.round(c.efectivoEntregar || 0);
      const cuadraJasper = tJasper === jasperDia && abiertos.length === 0;
      const cuadre = abiertos.length
        ? `<span class="pill warn">Hay ${abiertos.length} turno(s) abierto(s): ciérralos para cuadrar</span>`
        : cuadraJasper
          ? `<span class="pill ok">✓ Cuadra: suma de turnos = consolidado del día</span>`
          : `<span class="pill danger">⚠ No cuadra: turnos Jasper ${money(tJasper)} vs día ${money(jasperDia)} — revisa el detalle del consolidado</span>`;

      // Estado de la dispersión del día.
      let estado;
      if (d.snapshot) {
        const pay = d.payable;
        estado = `<span class="pill ok">Día cerrado y dispersado</span> ${pay
          ? `<span class="pill ${pay.status === "pagado" ? "ok" : "warn"}">Jasper ${money(pay.totalAmount)} · ${esc(pay.status)}${pay.pending > 0 ? ` (pendiente ${money(pay.pending)})` : ""}</span>`
          : '<span class="hint">sin deuda Jasper (día sin RTM)</span>'}`;
      } else {
        estado = `<span class="pill danger">Día SIN cerrar: el dinero no se ha dispersado ni existe la deuda Jasper</span>`;
      }

      box.innerHTML = `
        <div class="kpis">
          <div class="kpi"><span>Ventas del día</span><b>${money(c.salesTotal || 0)}</b></div>
          <div class="kpi"><span>Efectivo a entregar (a caja menor)</span><b>${money(efectivoDia)}</b></div>
          <div class="kpi"><span>Jasper (deuda Supergiros)</span><b>${money(jasperDia)}</b></div>
          <div class="kpi"><span>Provisión</span><b>${money(c.provision || 0)}</b></div>
        </div>
        <div style="overflow-x:auto"><table class="data"><thead><tr><th>Turno</th><th>Estado</th><th>Abrió</th><th class="r">Esperado</th><th class="r">Contado</th><th class="r">Dif.</th><th class="r">Ventas</th><th class="r">Jasper</th><th></th></tr></thead>
        <tbody>${rows || '<tr><td class="hint" colspan="9">Sin turnos este día</td></tr>'}</tbody>
        ${cerrados.length ? `<tfoot><tr><td colspan="3"><b>Total turnos cerrados</b></td><td class="r"><b>${money(tEsperado)}</b></td><td class="r"><b>${money(tContado)}</b></td><td class="r"><b class="${tDiff < 0 ? "neg" : ""}">${money(tDiff)}</b></td><td class="r"><b>${money(tVentas)}</b></td><td class="r"><b>${money(tJasper)}</b></td><td></td></tr></tfoot>` : ""}
        </table></div>
        <div class="row" style="gap:8px;margin-top:10px;flex-wrap:wrap">${cuadre} ${estado}</div>
        <div class="row form-actions" style="margin-top:10px">
          <button class="btn ${d.snapshot ? "" : "success"}" id="dcClose">${d.snapshot ? "Re-cerrar día (actualizar dispersión)" : "Cerrar día y dispersar"}</button>
        </div>
        <div id="dcShiftSales"></div>`;

      $("dcClose").addEventListener("click", () => closeDayUI(date, abiertos.length));
      box.querySelectorAll("[data-dcshift]").forEach((b) => b.addEventListener("click", () => loadShiftSales(Number(b.dataset.dcshift), b.dataset.num, "dcShiftSales")));
    } catch (e) { box.innerHTML = `<p class="hint">${esc(e.message)}</p>`; }
  }

  async function closeDayUI(date, openCount) {
    if (openCount > 0 && !confirm(`Hay ${openCount} turno(s) abierto(s). Las ventas que entren después NO quedarán en esta dispersión (tocaría re-cerrar el día). ¿Cerrar el día igual?`)) return;
    if (!confirm(`¿Cerrar el día ${date}? El efectivo a entregar entra a caja menor y el Jasper queda como deuda con Supergiros.`)) return;
    try {
      await api.saveClosing({ date });
      toast("Día cerrado · efectivo a caja menor · deuda Jasper creada");
      await loadPayables();
      await loadDayClose();
    } catch (e) { toast(e.message); }
  }

  async function loadLedger() {
    const params = { boxCode: $("ledBox")?.value || "CAJA_MENOR" };
    if ($("ledFrom")?.value) params.from = $("ledFrom").value;
    if ($("ledTo")?.value) params.to = $("ledTo").value;
    try {
      const { rows, opening, ingresos, egresos, closing } = await api.cashLedger(params);
      const isAdmin = api.currentUser()?.role === "admin";
      $("ledTotals").textContent = `Saldo inicial ${money(opening)} · Ingresos ${money(ingresos)} · Egresos ${money(egresos)} · Saldo final ${money(closing)}`;
      $("ledBody").innerHTML = `<table class="data"><thead><tr><th>Fecha</th><th>Concepto</th><th>Origen</th><th>Quién</th><th class="r">Ingreso</th><th class="r">Egreso</th><th class="r">Saldo</th><th></th></tr></thead><tbody>${
        rows.map((m) => `<tr style="${m.voided ? "opacity:.5;text-decoration:line-through" : ""}">
          <td>${esc(m.date)}</td><td>${esc(m.note || "")}${m.voided ? ' <span class="pill danger" style="text-decoration:none">anulado</span>' : ""}</td><td class="hint">${esc(m.refType || "")}${m.refId ? " #" + m.refId : ""}</td>
          <td>${esc(m.createdBy || "")}</td>
          <td class="r">${m.type === "ingreso" ? money(m.amount) : ""}</td>
          <td class="r">${m.type === "egreso" ? money(m.amount) : ""}</td>
          <td class="r"><b>${money(m.balance)}</b></td>
          <td>${isAdmin && m.refType === "manual" && !m.voided ? `<button class="link" data-ledvoid="${m.id}">anular</button>` : ""}</td>
        </tr>`).join("") || '<tr><td class="hint" colspan="8">Sin movimientos en el rango</td></tr>'
      }</tbody></table>`;
      $("ledBody").querySelectorAll("[data-ledvoid]").forEach((b) => b.addEventListener("click", async () => {
        if (!confirm("¿Anular este movimiento? Se crea una reversa por el mismo valor (nada se borra).")) return;
        try { await api.voidCashMovement(Number(b.dataset.ledvoid)); toast("Movimiento anulado"); await loadPayables(); await loadLedger(); }
        catch (e) { toast(e.message); }
      }));
    } catch (e) { toast(e.message); }
  }

  // Drill-down: día (cuenta por pagar de dispersión) → turnos del día.
  async function loadDayTurnos(date) {
    const box = $("pyDrill");
    if (!box) return;
    box.innerHTML = `<p class="hint">Cargando turnos del ${esc(date)}…</p>`;
    try {
      const { items } = await api.shifts({ from: date, to: date });
      const rows = items.map((s) => `<tr>
        <td><b>#${s.number}</b></td>
        <td><span class="pill ${s.status === "abierto" ? "ok" : ""}">${esc(s.status)}</span></td>
        <td>${esc(s.openedBy || "")}</td>
        <td class="r">${money(s.expectedCash)}</td>
        <td class="r">${s.countedCash == null ? "-" : money(s.countedCash)}</td>
        <td class="r">${s.status === "cerrado" ? money(s.cashDiff) : "-"}</td>
        <td class="r">${money(s.salesTotal)}</td>
        <td class="r">${money(s.jasper)}</td>
        <td><button class="btn ghost sm" data-shift="${s.id}" data-num="${s.number}">ver ventas ▸</button></td>
      </tr>`).join("");
      box.innerHTML = `
        <div class="card" style="background:#f7f9fc;border:1px solid #e6ebf2">
          <div class="card-head"><h3>Turnos del día ${esc(date)}</h3><button class="link" id="pyDrillClose">cerrar ✕</button></div>
          <div style="overflow-x:auto"><table class="data"><thead><tr><th>Turno</th><th>Estado</th><th>Abrió</th><th class="r">Esperado</th><th class="r">Contado</th><th class="r">Dif.</th><th class="r">Ventas</th><th class="r">Jasper</th><th></th></tr></thead>
          <tbody>${rows || '<tr><td class="hint" colspan="9">Sin turnos ese día</td></tr>'}</tbody></table></div>
          <div id="pyShiftSales"></div>
        </div>`;
      $("pyDrillClose").addEventListener("click", () => { box.innerHTML = ""; });
      box.querySelectorAll("[data-shift]").forEach((b) => b.addEventListener("click", () => loadShiftSales(Number(b.dataset.shift), b.dataset.num)));
    } catch (e) { toast(e.message); }
  }

  // Drill-down: turno → todas sus ventas (con link a editar para corregir).
  async function loadShiftSales(shiftId, num, targetId = "pyShiftSales") {
    const box = $(targetId);
    if (!box) return;
    box.innerHTML = `<p class="hint">Cargando ventas del turno #${esc(num)}…</p>`;
    const isAdmin = api.currentUser()?.role === "admin";
    try {
      const items = await api.listSales({ shiftId });
      const rows = items.map((s) => `<tr>
        <td>${esc(s.saleNumber)}</td><td>${esc(s.invoiceNumber || "-")}</td>
        <td>${esc(s.clientName)}</td><td>${esc(s.plate || "")}</td>
        <td>${esc(s.allyType)}${s.allyName && s.allyName !== "USUARIO" ? " · " + esc(s.allyName) : ""}</td>
        <td>${esc(s.rtmStatus)}</td>
        <td class="r"><b>${money(s.total)}</b></td>
        <td><span class="pill ${s.status === "anulada" ? "danger" : "ok"}">${esc(s.status)}</span></td>
        <td>${isAdmin && editSale && s.status !== "anulada" ? `<button class="link" data-editsale="${s.id}">editar</button>` : ""}</td>
      </tr>`).join("");
      const tot = items.filter((s) => s.status !== "anulada").reduce((a, s) => a + s.total, 0);
      box.innerHTML = `<h4 style="margin:12px 0 6px">Ventas del turno #${esc(num)} (${items.length}) · Total ${money(tot)}</h4>
        <div style="overflow-x:auto"><table class="data"><thead><tr><th>Venta</th><th>Factura</th><th>Cliente</th><th>Placa</th><th>Tipo</th><th>RTM</th><th class="r">Total</th><th>Estado</th><th></th></tr></thead>
        <tbody>${rows || '<tr><td class="hint" colspan="9">Sin ventas en este turno</td></tr>'}</tbody></table></div>`;
      if (isAdmin && editSale) box.querySelectorAll("[data-editsale]").forEach((b) => b.addEventListener("click", () => editSale(Number(b.dataset.editsale))));
    } catch (e) { toast(e.message); }
  }

  function renderKpis() {
    const saldoCaja = boxBalanceOf("CAJA_MENOR");
    const debeSG = (window.__pyItems || []).filter((p) => (p.creditor || "").toUpperCase() === "SUPERGIROS" && p.status !== "pagado").reduce((a, p) => a + p.pending, 0);
    const pendienteTotal = (window.__pyTotals || {}).pending || 0;
    const faltante = Math.max(0, pendienteTotal - saldoCaja);
    const boxPills = boxes.filter((b) => b.code !== "CAJA_MENOR").map((b) => `<div class="kpi"><span>${esc(b.name)}</span><b>${money(b.balance)}</b></div>`).join("");
    $("pyKpis").innerHTML = `
      <div class="kpi" style="border:2px solid ${saldoCaja < 0 ? "#c0392b" : "#1e7e34"};border-radius:8px"><span>💵 Saldo caja menor</span><b style="font-size:1.3em;color:${saldoCaja < 0 ? "#c0392b" : "#1e7e34"}">${money(saldoCaja)}</b></div>
      <div class="kpi"><span>Debo a Supergiros</span><b>${money(debeSG)}</b></div>
      <div class="kpi"><span>Total por pagar</span><b>${money(pendienteTotal)}</b></div>
      <div class="kpi"><span>Faltante p/ cubrir</span><b style="${faltante > 0 ? "color:#c0392b" : ""}">${money(faltante)}</b></div>
      ${boxPills}`;
  }

  // Ingreso rapido de dinero a caja menor (retiro del banco / reposicion):
  // "cuando yo saco plata del banco no figura en el cierre, toca poderle hacer un ingreso".
  function toggleCmIngreso() {
    const box = $("cmIngresoForm");
    if (box.innerHTML) { box.innerHTML = ""; return; }
    box.innerHTML = `
      <div class="row" style="margin:8px 0;flex-wrap:wrap;gap:8px">
        <input id="cmAmount" inputmode="numeric" placeholder="Monto $" style="max-width:160px" />
        <input type="date" id="cmDate" value="${todayIso()}" />
        <input id="cmNote" placeholder="Nota (ej: retiro del banco para pagar Supergiros)" style="flex:1;min-width:220px" />
        <button class="btn success" id="cmSave">Ingresar a caja menor</button>
      </div>`;
    $("cmSave").addEventListener("click", async () => {
      const amount = readCop("cmAmount");
      if (amount <= 0) return toast("Ingresa el monto");
      try {
        await api.addCashMovement({ boxCode: "CAJA_MENOR", type: "ingreso", amount, note: ($("cmNote").value || "").trim() || "Ingreso a caja menor", date: $("cmDate").value || todayIso() });
        toast(`Ingresaron ${money(amount)} a caja menor`);
        box.innerHTML = "";
        await loadPayables();
        await loadLedger();
      } catch (e) { toast(e.message); }
    });
  }

  async function loadPayables() {
    try {
      try { boxes = ((await api.cashBoxes()).boxes) || boxes; } catch { /* mantiene */ }
      const res = await api.payables(cleanFilters());
      const { items, totals } = res;
      window.__pyItems = items; window.__pyTotals = totals;
      // Refresca el desplegable de proveedores (sin perder la seleccion).
      if (Array.isArray(res.creditors)) {
        creditors = res.creditors;
        const sel = $("pyfCreditor");
        if (sel) {
          const cur = sel.value;
          sel.innerHTML = `<option value="">Todo proveedor</option>` + creditors.map((cr) => `<option value="${esc(cr)}">${esc(cr)}</option>`).join("");
          sel.value = cur;
        }
      }
      renderKpis();
      $("pyTotals").textContent = `Pendiente ${money(totals.pending)} · Total ${money(totals.total)} · Pagado ${money(totals.paid)}`;
      $("pyBody").innerHTML = `<table class="data"><thead><tr><th>Concepto</th><th>Proveedor</th><th>Naturaleza</th><th>Frec.</th><th>Vence</th><th>Estado</th><th class="r">Total</th><th class="r">Pendiente</th><th></th></tr></thead><tbody>${
        items.map((p) => {
          // Las cuentas de dispersión (por día) se pueden abrir para ver sus turnos y ventas.
          const drill = p.dueDate && (p.category === "dispersion" || p.refType === "closing");
          const concepto = drill
            ? `<button class="link" data-day="${esc(p.dueDate)}" style="font-weight:700">${esc(p.concept)}</button> <span class="hint">▾ turnos</span>`
            : `<b>${esc(p.concept)}</b>`;
          return `<tr>
          <td>${concepto}${p.refType === "closing" ? ' <span class="pill">auto</span>' : ""}</td><td>${esc(p.creditor || "")}</td><td>${esc(p.category || "")}</td>
          <td>${esc(p.frequency)}</td><td>${esc(p.dueDate || "")}</td>
          <td><span class="pill ${PAY_BADGE[p.status] || ""}">${esc(p.status)}</span></td>
          <td class="r">${money(p.totalAmount)}</td><td class="r"><b>${money(p.pending)}</b></td>
          <td>${p.status !== "pagado" ? `<button class="btn primary sm" data-pay="${p.id}">Pagar</button> ` : ""}${p.paidAmount > 0 ? `<button class="link" data-abonos="${p.id}">abonos</button> ` : ""}<button class="link" data-delpay="${p.id}">eliminar</button></td>
        </tr>`; }).join("") || '<tr><td class="hint" colspan="9">Sin cuentas por pagar</td></tr>'
      }</tbody></table>`;
      $("pyBody").querySelectorAll("[data-pay]").forEach((b) => b.addEventListener("click", () => openPayablePanel(Number(b.dataset.pay))));
      $("pyBody").querySelectorAll("[data-abonos]").forEach((b) => b.addEventListener("click", () => openPayablePanel(Number(b.dataset.abonos))));
      $("pyBody").querySelectorAll("[data-delpay]").forEach((b) => b.addEventListener("click", () => delPayableUI(Number(b.dataset.delpay))));
      $("pyBody").querySelectorAll("[data-day]").forEach((b) => b.addEventListener("click", () => loadDayTurnos(b.dataset.day)));
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

  // Panel de pago + historial de abonos con comprobante (Supergiros firma con huella:
  // el comprobante subido es la prueba de que la cajera sí pagó lo que dijo que pagó).
  async function openPayablePanel(id) {
    const box = $("pyDrill");
    if (!box) return;
    box.innerHTML = `<p class="hint">Cargando cuenta…</p>`;
    try {
      const p = await api.payable(id);
      const pays = (p.payments || []).map((a) => `<tr>
        <td>${esc(a.paidDate)}</td>
        <td>${esc(a.paidBy || "")}</td>
        <td>${a.voucherPath ? `<a class="link" href="${esc(a.voucherPath)}" target="_blank">ver comprobante</a>` : '<span class="hint">sin archivo</span>'}</td>
        <td>${esc(a.note || "")}</td>
        <td class="r"><b>${money(a.amount)}</b></td>
        <td><button class="link" data-delabono="${a.id}">anular</button></td>
      </tr>`).join("");
      const isSG = (p.creditor || "").toUpperCase() === "SUPERGIROS";
      box.innerHTML = `
        <div class="card" style="background:#f7f9fc;border:1px solid #e6ebf2">
          <div class="card-head"><h3>${esc(p.concept)} · ${esc(p.creditor || "")}</h3><button class="link" id="ppClose">cerrar ✕</button></div>
          <div class="kpis">
            <div class="kpi"><span>Total</span><b>${money(p.totalAmount)}</b></div>
            <div class="kpi"><span>Pagado</span><b>${money(p.paidAmount)}</b></div>
            <div class="kpi"><span>Pendiente</span><b>${money(p.pending)}</b></div>
            <div class="kpi"><span>Saldo caja menor</span><b>${money(boxBalanceOf("CAJA_MENOR"))}</b></div>
          </div>
          ${p.pending > 0 ? `
          <h4 style="margin:10px 0 6px">Registrar pago (egreso de caja menor)</h4>
          ${isSG ? '<p class="hint">Supergiros se paga COMPLETO (no reciben pagos parciales).</p>' : ""}
          <div class="form-grid">
            <label class="fld">Valor<input id="ppAmount" inputmode="numeric" value="${p.pending}" /></label>
            <label class="fld">Fecha<input type="date" id="ppDate" value="${todayIso()}" /></label>
            <label class="fld">Quién paga<input id="ppBy" placeholder="Responsable" /></label>
            <label class="fld">Comprobante (firmado)<input id="ppVoucher" type="file" accept="image/*,.pdf" /></label>
            <label class="fld">Nota<input id="ppNote" placeholder="Opcional" /></label>
          </div>
          <div class="row form-actions"><button class="btn success" id="ppPay">Pagar</button></div>` : '<p class="hint">✓ Cuenta pagada por completo.</p>'}
          <h4 style="margin:14px 0 6px">Historial de abonos</h4>
          <table class="data"><thead><tr><th>Fecha</th><th>Quién</th><th>Comprobante</th><th>Nota</th><th class="r">Valor</th><th></th></tr></thead>
          <tbody>${pays || '<tr><td class="hint" colspan="6">Sin abonos</td></tr>'}</tbody></table>
        </div>`;
      $("ppClose").addEventListener("click", () => { box.innerHTML = ""; });
      $("ppPay")?.addEventListener("click", () => payPayableUI(p));
      box.querySelectorAll("[data-delabono]").forEach((b) => b.addEventListener("click", () => delAbonoUI(id, Number(b.dataset.delabono))));
    } catch (e) { toast(e.message); }
  }

  async function payPayableUI(p) {
    const amount = readCop("ppAmount");
    if (amount <= 0) return toast("Valor invalido");
    if (amount > p.pending && !confirm(`El valor supera el pendiente (${money(p.pending)}). ¿Registrar igual?`)) return;
    const body = { amount, paidDate: $("ppDate")?.value || todayIso(), boxCode: "CAJA_MENOR", paidBy: ($("ppBy")?.value || "").trim() || null, note: ($("ppNote")?.value || "").trim() || null };
    try {
      const file = $("ppVoucher")?.files?.[0];
      if (file) {
        const up = await api.uploadFile(file);
        body.voucherPath = up.url || up.path;
      }
      await api.payPayable(p.id, body);
      toast("Pago registrado (egreso de caja menor)");
      await loadPayables();
      openPayablePanel(p.id);
    } catch (e) {
      if (/insuficientes/i.test(e.message) && confirm(`${e.message}.\n¿Registrar el pago de todos modos (caja menor quedará en negativo)?`)) {
        try { await api.payPayable(p.id, { ...body, force: true }); toast("Pago registrado (forzado)"); await loadPayables(); openPayablePanel(p.id); }
        catch (e2) { toast(e2.message); }
      } else { toast(e.message); }
    }
  }

  async function delAbonoUI(id, paymentId) {
    if (!confirm("¿Anular este abono? El dinero vuelve a la caja y la cuenta queda pendiente por ese valor.")) return;
    try {
      await api.deletePayablePayment(id, paymentId);
      toast("Abono anulado · dinero devuelto a la caja");
      await loadPayables();
      openPayablePanel(id);
    } catch (e) { toast(e.message); }
  }

  async function delPayableUI(id) {
    if (!confirm("¿Eliminar esta obligacion y sus abonos? Se revierte el egreso de caja.")) return;
    try { await api.deletePayable(id); toast("Eliminada"); loadPayables(); }
    catch (e) { toast(e.message); }
  }
  return { renderPayables };
}
