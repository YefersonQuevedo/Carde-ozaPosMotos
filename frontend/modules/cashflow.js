import { $, esc, money, readCop, todayIso, downloadBlob } from "../utils.js";

export function createCashflowModule(context) {
  const { api, toast } = context;
  // ---------- Ingresos (plantilla) ----------
  let incomeBoxes = [];
  function isBankBox(b) {
    const kind = String(b.kind || "").toLowerCase();
    return kind === "banco" || kind === "bancos" || String(b.name || "").toLowerCase().includes("banco");
  }
  function isIncomeBox(b) {
    const kind = String(b.kind || "");
    const name = String(b.name || "").toLowerCase();
    return kind === "caja_menor" || kind === "otra" || kind.startsWith("provision_") || isBankBox(b) || name.includes("provision");
  }
  function incomeBoxName(code) {
    return incomeBoxes.find((b) => b.code === code)?.name || code || "";
  }
  // Fuente (Bancos/Efectivo) de un movimiento, segun su caja o su campo source.
  function fuenteOf(item, boxes) {
    if (item.source === "bancos") return "Bancos";
    const box = (boxes || []).find((b) => b.code === item.boxCode);
    return box && isBankBox(box) ? "Bancos" : "Efectivo";
  }
  // Tabla consolidada por naturaleza (Bancos | Efectivo | Total | % | # mov.).
  // variant: "ing" (verde) | "egr" (rojo).
  function consolidadoTable(data, title, variant) {
    const rows = (data.rows || []).map((r) => `<tr>
      <td><b>${esc(r.name)}</b></td>
      <td class="r">${r.bancos ? money(r.bancos) : "-"}</td>
      <td class="r">${r.efectivo ? money(r.efectivo) : "-"}</td>
      <td class="r"><b>${money(r.total)}</b></td>
      <td class="r">${r.pct ? r.pct.toFixed(1) + "%" : "0,0%"}</td>
      <td class="r">${r.count}</td>
    </tr>`).join("");
    const t = data.totals || {};
    return `<div style="overflow-x:auto"><table class="data con-table con-${variant}">
        <caption>${esc(title)}</caption>
        <thead><tr><th>NATURALEZA</th><th class="r">BANCOS</th><th class="r">EFECTIVO</th><th class="r">TOTAL</th><th class="r">% DEL TOTAL</th><th class="r"># MOV.</th></tr></thead>
        <tbody>${rows || '<tr><td class="hint" colspan="6">Sin movimientos en el rango</td></tr>'}</tbody>
        <tfoot><tr><td><b>TOTAL</b></td><td class="r"><b>${money(t.bancos || 0)}</b></td><td class="r"><b>${money(t.efectivo || 0)}</b></td><td class="r"><b>${money(t.total || 0)}</b></td><td class="r"><b>100%</b></td><td class="r"><b>${t.count || 0}</b></td></tr></tfoot>
      </table></div>`;
  }
  async function renderIngresos(c) {
    if (!c) return;
    const today = todayIso();
    try { expenseNatures = ((await api.expenseNatures()).items) || expenseNatures || []; } catch { expenseNatures = expenseNatures || []; }
    try { incomeBoxes = (((await api.cashBoxes()).boxes) || []).filter(isIncomeBox); } catch { incomeBoxes = []; }
    const natOpts = (expenseNatures || [])
      .filter((n) => ["ingreso", "ambos"].includes(String(n.kind || "").toLowerCase()))
      .map((n) => `<option value="${esc(n.code)}">${esc(n.name)}</option>`)
      .join("");
    const boxOpts = incomeBoxes.map((b) => `<option value="${esc(b.code)}"${b.code === "CAJA_MENOR" ? " selected" : ""}>${esc(b.name)}</option>`).join("");
    c.innerHTML = `<div class="card">
        <div class="card-head"><h2>Registrar ingreso</h2></div>
        <div class="form-grid">
          <label class="fld">Fecha<input type="date" id="inDate" value="${today}" /></label>
          <label class="fld">Valor *<input id="inValue" inputmode="numeric" placeholder="$" /></label>
          <label class="fld">Concepto / motivo *<input id="inObs" placeholder="Ej: retiro del banco, reposicion, ajuste de caja" /></label>
          <label class="fld">Naturaleza de ingreso<span class="row" style="gap:6px"><select id="inNature" style="flex:1"><option value="">Sin naturaleza</option>${natOpts}</select><button class="btn ghost" id="inAddNature" type="button" title="Agregar naturaleza">+</button></span></label>
          <label class="fld">Caja destino<select id="inBox">${boxOpts}</select></label>
        </div>
        <div class="row form-actions"><button class="btn success" id="inSave">Registrar ingreso</button></div>
      </div>
      <div class="card">
        <div class="card-head">
          <h2>Ingresos — Planilla Bancos y Efectivo</h2>
          <div class="row">
            <label class="rng">Desde <input type="date" id="inFrom" value="${today.slice(0, 8)}01" /></label>
            <label class="rng">Hasta <input type="date" id="inTo" value="${today}" /></label>
            <select id="inBoxFilter"><option value="">Todas las cajas</option>${boxOpts}</select>
            <button class="btn primary" id="inLoad">Ver</button>
            <button class="btn ghost" id="inExport">Exportar Excel</button>
          </div>
        </div>
        <div id="inTotal" class="pill warn"></div>
        <div id="inBody"></div>
      </div>
      <div class="card">
        <div class="card-head"><h2>Consolidado de ingresos por naturaleza</h2></div>
        <p class="hint">Total del periodo separado en Bancos y Efectivo. Las naturalezas en cero también se listan, igual que en la planilla del cliente.</p>
        <div id="inConsol"><p class="hint">Cargando…</p></div>
      </div>`;
    $("inSave").addEventListener("click", addIncomeUI);
    $("inLoad").addEventListener("click", loadIncome);
    $("inExport").addEventListener("click", exportIncomeUI);
    $("inAddNature").addEventListener("click", () => addNatureUI("in"));
    await loadIncome();
  }
  async function loadIncome() {
    try {
      const params = { from: $("inFrom").value, to: $("inTo").value };
      if ($("inBoxFilter").value) params.boxCode = $("inBoxFilter").value;
      const { items, total, count, bySource } = await api.income(params);
      const natName = Object.fromEntries((expenseNatures || []).map((n) => [n.code, n.name]));
      const bancos = (bySource || {}).bancos || 0;
      const efectivo = (bySource || {}).efectivo || 0;
      $("inTotal").textContent = `${count} ingreso(s) · TOTAL ${money(total)} · Bancos ${money(bancos)} · Efectivo ${money(efectivo)}`;
      $("inBody").innerHTML = `<table class="data"><thead><tr><th>Fecha</th><th class="r">Valor</th><th>Observación</th><th>Naturaleza</th><th>Fuente</th><th>Caja</th><th>Registró</th><th></th></tr></thead><tbody>${
        items.map((i) => {
          const manual = i.sourceTable === "cashMovement";
          const nature = i.natureCode === "MOVIMIENTO_CAJA" ? "Movimiento de caja" : (natName[i.natureCode] || i.natureCode || "");
          const fuente = fuenteOf(i, incomeBoxes);
          return `<tr><td>${esc(i.date)}</td><td class="r">${money(i.value)}</td><td>${esc(i.observation || "")}</td><td>${esc(nature)}</td><td><span class="pill ${fuente === "Bancos" ? "" : "ok"}">${fuente}</span></td><td>${esc(incomeBoxName(i.boxCode))}</td><td class="hint">${esc(i.createdBy || "")}</td><td><button class="link" data-delinc="${esc(i.id)}" data-source="${manual ? "cashMovement" : "income"}" data-cashid="${i.cashMovementId || ""}">anular</button></td></tr>`;
        }).join("") || '<tr><td class="hint" colspan="8">Sin ingresos en el rango</td></tr>'
      }</tbody></table>`;
      $("inBody").querySelectorAll("[data-delinc]").forEach((b) => b.addEventListener("click", () => delIncomeUI(b.dataset.delinc, b.dataset.source, Number(b.dataset.cashid || 0))));
      loadIncomeConsolidado();
    } catch (e) { toast(e.message); }
  }
  async function loadIncomeConsolidado() {
    const box = $("inConsol");
    if (!box) return;
    try {
      const data = await api.incomeConsolidado({ from: $("inFrom").value, to: $("inTo").value });
      box.innerHTML = consolidadoTable(data, "CONSOLIDADO DE INGRESOS", "ing");
    } catch (e) { box.innerHTML = `<p class="hint">${esc(e.message)}</p>`; }
  }
  async function addIncomeUI() {
    const value = readCop("inValue");
    const observation = $("inObs").value.trim();
    if (value <= 0) return toast("Ingresa el valor");
    if (!observation) return toast("El concepto o motivo es obligatorio");
    try {
      await api.addIncome({ date: $("inDate").value || todayIso(), value, observation, natureCode: $("inNature").value, boxCode: $("inBox").value || "CAJA_MENOR" });
      toast("Ingreso registrado");
      $("inValue").value = ""; $("inObs").value = "";
      loadIncome();
    } catch (e) { toast(e.message); }
  }
  async function delIncomeUI(id, sourceTable = "income", cashMovementId = 0) {
    if (sourceTable === "cashMovement") {
      if (!confirm("¿Anular este ingreso?")) return;
      try { await api.voidCashMovement(cashMovementId); toast("Ingreso anulado"); loadIncome(); }
      catch (e) { toast(e.message); }
      return;
    }
    if (!confirm("Â¿Anular este ingreso?")) return;
    try { await api.deleteIncome(id); toast("Ingreso anulado"); loadIncome(); }
    catch (e) { toast(e.message); }
  }
  async function exportIncomeUI() {
    try {
      const params = { from: $("inFrom").value, to: $("inTo").value };
      if ($("inBoxFilter").value) params.boxCode = $("inBoxFilter").value;
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
        <h2>Egresos — Planilla Bancos y Efectivo</h2>
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
      <div class="card-head"><h2>Consolidado de egresos por naturaleza</h2></div>
      <p class="hint">Total del periodo separado en Bancos y Efectivo. Las naturalezas en cero también se listan.</p>
      <div id="gxConsol"><p class="hint">Cargando…</p></div>
    </div>
    <div class="card">
      <div class="card-head">
        <h2>Reporte ejecutivo por naturaleza (incluye facturas de proveedor e IVA)</h2>
        <div class="row"><button class="btn ghost" id="gxNatureExport">Excel naturalezas</button></div>
      </div>
      <div id="gxNatureBody"></div>
    </div>`;
    $("gxSave").addEventListener("click", addGastoUI);
    $("gxLoad").addEventListener("click", loadGastos);
    $("gxExport").addEventListener("click", exportGastosUI);
    $("gxNatureExport").addEventListener("click", exportNatureReportUI);
    $("gxAddNature").addEventListener("click", () => addNatureUI("gx"));
    loadGastos();
  }
  // Agregar una naturaleza sin salir del formulario: mini-panel modal (reemplaza el
  // prompt nativo). El catalogo completo (editar/desactivar/eliminar) vive en
  // Configuracion -> "Naturalezas de ingresos y gastos".
  // target: "in" (formulario de ingresos) | "gx" (formulario de gastos).
  function addNatureUI(target) {
    const prev = document.getElementById("natModalOverlay");
    if (prev) prev.remove();
    const defKind = target === "in" ? "ingreso" : "gasto";
    const ov = document.createElement("div");
    ov.id = "natModalOverlay";
    ov.style.cssText = "position:fixed;inset:0;background:rgba(15,23,42,.45);display:flex;align-items:center;justify-content:center;z-index:9999;backdrop-filter:blur(2px)";
    ov.innerHTML = `
      <div style="background:#fff;border-radius:14px;box-shadow:0 18px 50px rgba(0,0,0,.25);max-width:480px;width:92%;padding:22px 24px" role="dialog" aria-modal="true">
        <h3 style="margin:0 0 12px;font-size:1.05rem">➕ Nueva naturaleza</h3>
        <div class="form-grid">
          <label class="fld">Nombre *<input id="nmName" placeholder="Ej: Papelería, Marketing, Retiro de efectivo" /></label>
          <label class="fld">Tipo<select id="nmKind">
            <option value="ingreso"${defKind === "ingreso" ? " selected" : ""}>Ingreso</option>
            <option value="gasto"${defKind === "gasto" ? " selected" : ""}>Gasto</option>
            <option value="ambos">Ambos</option>
          </select></label>
          <label class="chk" style="align-self:end"><input type="checkbox" id="nmTax" /> Relevante para impuestos (IVA)</label>
        </div>
        <p class="hint">El catálogo completo (editar, desactivar, eliminar) se administra en <b>Configuración → Naturalezas de ingresos y gastos</b>.</p>
        <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:10px">
          <button class="btn ghost" data-act="cancel">Cancelar</button>
          <button class="btn success" data-act="save">Guardar</button>
        </div>
      </div>`;
    const close = () => { ov.remove(); document.removeEventListener("keydown", onKey); };
    const onKey = (e) => { if (e.key === "Escape") close(); };
    ov.addEventListener("click", (e) => { if (e.target === ov) close(); });
    ov.querySelector('[data-act="cancel"]').addEventListener("click", close);
    ov.querySelector('[data-act="save"]').addEventListener("click", async () => {
      const name = ov.querySelector("#nmName").value.trim();
      if (!name) return toast("El nombre es obligatorio");
      const kind = ov.querySelector("#nmKind").value;
      try {
        const r = await api.saveExpenseNature({ name, kind, taxRelevant: ov.querySelector("#nmTax").checked });
        expenseNatures = ((await api.expenseNatures()).items) || expenseNatures;
        // Refresca SOLO el desplegable correspondiente (no se pierde lo demas del formulario).
        if (target === "in") {
          const sel = $("inNature");
          if (sel) {
            const opts = expenseNatures
              .filter((n) => ["ingreso", "ambos"].includes(String(n.kind || "").toLowerCase()))
              .map((n) => `<option value="${esc(n.code)}">${esc(n.name)}</option>`).join("");
            sel.innerHTML = `<option value="">Sin naturaleza</option>${opts}`;
            if (r.item) sel.value = r.item.code;
          }
        } else {
          const sel = $("gxCategory");
          if (sel) {
            sel.innerHTML = `<option value="">Sin naturaleza</option>${natureOptions()}`;
            if (r.item) sel.value = r.item.code;
          }
        }
        toast(kind === "gasto" && target === "in" ? "Naturaleza agregada (tipo gasto: aparece en Gastos)" : "Naturaleza agregada");
        close();
      } catch (e) { toast(e.message); }
    });
    document.addEventListener("keydown", onKey);
    document.body.appendChild(ov);
    ov.querySelector("#nmName").focus();
  }
  async function loadGastos() {
    try {
      const from = $("gxFrom").value, to = $("gxTo").value;
      const { items, total, count } = await api.expenses({ from, to });
      const natName = Object.fromEntries((expenseNatures || []).map((n) => [n.code, n.name]));
      const bancos = items.filter((e) => fuenteOf(e, gastosBoxes) === "Bancos").reduce((a, e) => a + e.amount, 0);
      $("gxTotal").textContent = `${count} gasto(s) · TOTAL ${money(total)} · Bancos ${money(bancos)} · Efectivo ${money(total - bancos)}`;
      $("gxBody").innerHTML = `<table class="data"><thead><tr><th>Fecha</th><th>Concepto / observación</th><th>Naturaleza</th><th>Fuente</th><th>Caja</th><th>Nota</th><th>Registró</th><th class="r">Valor</th><th></th></tr></thead><tbody>${
        items.map((e) => {
          const fuente = fuenteOf(e, gastosBoxes);
          const nat = natName[e.category] || e.category || "";
          return `<tr><td>${esc(e.date)}</td><td>${esc(e.concept)}</td><td>${esc(nat)}</td><td><span class="pill ${fuente === "Bancos" ? "" : "ok"}">${fuente}</span></td><td>${esc(e.boxCode)}</td><td class="hint">${esc(e.note || "")}</td><td class="hint">${esc(e.createdBy || "")}</td><td class="r">${money(e.amount)}</td><td><button class="link" data-delgasto="${e.id}">anular</button></td></tr>`;
        }).join("") || '<tr><td class="hint" colspan="9">Sin gastos en el rango</td></tr>'
      }</tbody></table>`;
      $("gxBody").querySelectorAll("[data-delgasto]").forEach((b) => b.addEventListener("click", () => delGastoUI(Number(b.dataset.delgasto))));
      loadExpenseConsolidado();
      loadNatureReport();
    } catch (e) { toast(e.message); }
  }
  async function loadExpenseConsolidado() {
    const box = $("gxConsol");
    if (!box) return;
    try {
      const data = await api.expenseConsolidado({ from: $("gxFrom").value, to: $("gxTo").value });
      box.innerHTML = consolidadoTable(data, "CONSOLIDADO DE EGRESOS", "egr");
    } catch (e) { box.innerHTML = `<p class="hint">${esc(e.message)}</p>`; }
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
    if (!confirm("Â¿Anular este gasto? Se devuelve el dinero a la caja.")) return;
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
  return { renderIngresos, renderGastos };
}
