import { $, esc, money, readCop, todayIso, downloadBlob } from "../utils.js";

export function createCashflowModule(context) {
  const { api, toast } = context;
  // ---------- Ingresos (plantilla) ----------
  let incomeBoxes = [];
  async function renderIngresos(c) {
    if (!c) return;
    const today = todayIso();
    try { expenseNatures = ((await api.expenseNatures()).items) || expenseNatures || []; } catch { expenseNatures = expenseNatures || []; }
    try { incomeBoxes = ((await api.cashBoxes()).boxes) || []; } catch { incomeBoxes = []; }
    const natOpts = (expenseNatures || []).map((n) => `<option value="${esc(n.code)}">${esc(n.name)}</option>`).join("");
    const boxOpts = incomeBoxes.map((b) => `<option value="${esc(b.code)}"${b.code === "CAJA_MENOR" ? " selected" : ""}>${esc(b.name)}</option>`).join("");
    c.innerHTML = `<div class="card">
        <div class="card-head"><h2>Registrar ingreso</h2></div>
        <div class="form-grid">
          <label class="fld">Fecha<input type="date" id="inDate" value="${today}" /></label>
          <label class="fld">Valor *<input id="inValue" inputmode="numeric" placeholder="$" /></label>
          <label class="fld">Observacion<input id="inObs" placeholder="Ej: Semana 27 abril, abono SOAT…" /></label>
          <label class="fld">Naturaleza<span class="row" style="gap:6px"><select id="inNature" style="flex:1"><option value="">Sin naturaleza</option>${natOpts}</select><button class="btn ghost" id="inAddNature" type="button" title="Agregar tipo">+</button></span></label>
          <label class="fld">Fuente<select id="inSource"><option value="efectivo">Efectivo</option><option value="bancos">Bancos</option></select></label>
          <label class="fld">Caja (a dónde entra)<select id="inBox">${boxOpts}</select></label>
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
      await api.addIncome({ date: $("inDate").value || todayIso(), value, observation: $("inObs").value.trim(), natureCode: $("inNature").value, source: $("inSource").value, boxCode: $("inBox").value || "CAJA_MENOR" });
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
  return { renderIngresos, renderGastos };
}
