import { $, esc, money, readCop, todayIso, confirmDialog } from "../utils.js";

// Nomina: empleados + calculo de la quincena + pago. Pago quincenal (dia 15 y 30/31).
// Descuento empleado = 8% (salud 4% + pension 4%) sobre el salario base (IBC).
export function createNominaModule(context) {
  const { api, toast } = context;
  let editing = null;

  async function renderNomina(c) {
    if (!c) return;
    c.innerHTML = `
      <div class="card">
        <div class="card-head"><h2>Empleados</h2></div>
        <div class="form-grid">
          <label class="fld">Nombre *<input id="emName" placeholder="Nombre completo" /></label>
          <label class="fld">Cargo<input id="emRole" placeholder="Ej: Operadora CDA, Inspector Técnico" /></label>
          <label class="fld">Salario base (mes)<input id="emBase" inputmode="numeric" value="1750905" /></label>
          <label class="fld">Aux. transporte (mes)<input id="emTransp" inputmode="numeric" value="249095" /></label>
          <label class="fld">Aux. alimentación (mes)<input id="emAlim" inputmode="numeric" value="0" /></label>
          <label class="fld">Paga por<select id="emMethod"><option value="banco">Banco</option><option value="efectivo">Efectivo</option></select></label>
        </div>
        <div class="row form-actions">
          <button class="btn success" id="emSave">Agregar empleado</button>
          <button class="btn ghost hidden" id="emCancel">Cancelar edición</button>
        </div>
        <div id="emBody"></div>
      </div>
      <div class="card">
        <div class="card-head"><h2>Quincena (cálculo y pago)</h2>
          <button class="btn success" id="emPay">Pagar quincena</button>
        </div>
        <p class="hint">Devengado = mitad del salario base + mitad de auxilios. Descuento empleado = 8% (salud 4% + pensión 4%) sobre el salario base. El pago genera un gasto por empleado en su caja (banco/efectivo), naturaleza Nómina.</p>
        <div id="emQuincena"></div>
      </div>`;
    $("emSave").addEventListener("click", saveEmployeeUI);
    $("emCancel").addEventListener("click", resetForm);
    $("emPay").addEventListener("click", payQuincenaUI);
    await loadEmployees();
    await loadQuincena();
  }

  function resetForm() {
    editing = null;
    ["emName", "emRole"].forEach((id) => { $(id).value = ""; });
    $("emBase").value = "1750905"; $("emTransp").value = "249095"; $("emAlim").value = "0"; $("emMethod").value = "banco";
    $("emSave").textContent = "Agregar empleado";
    $("emCancel").classList.add("hidden");
  }

  async function loadEmployees() {
    try {
      const { items } = await api.employees();
      $("emBody").innerHTML = `<table class="data"><thead><tr><th>Nombre</th><th>Cargo</th><th class="r">Salario base</th><th class="r">Aux. transp.</th><th class="r">Aux. alim.</th><th>Paga por</th><th>Estado</th><th></th></tr></thead><tbody>${
        items.map((e) => `<tr style="${e.active ? "" : "opacity:.5"}">
          <td><b>${esc(e.name)}</b></td><td>${esc(e.role || "")}</td>
          <td class="r">${money(e.salaryBase)}</td><td class="r">${money(e.auxTransporte)}</td><td class="r">${money(e.auxAlimentacion)}</td>
          <td><span class="pill ${e.paymentMethod === "banco" ? "" : "ok"}">${e.paymentMethod === "banco" ? "Banco" : "Efectivo"}</span></td>
          <td><span class="pill ${e.active ? "ok" : "danger"}">${e.active ? "activo" : "inactivo"}</span></td>
          <td><button class="link" data-emedit="${e.id}">editar</button> ${e.active ? `<button class="link" data-emdel="${e.id}">desactivar</button>` : ""}</td>
        </tr>`).join("") || '<tr><td class="hint" colspan="8">Sin empleados</td></tr>'
      }</tbody></table>`;
      const byId = Object.fromEntries(items.map((e) => [e.id, e]));
      $("emBody").querySelectorAll("[data-emedit]").forEach((b) => b.addEventListener("click", () => {
        const e = byId[b.dataset.emedit]; if (!e) return;
        editing = e.id;
        $("emName").value = e.name; $("emRole").value = e.role || "";
        $("emBase").value = e.salaryBase; $("emTransp").value = e.auxTransporte; $("emAlim").value = e.auxAlimentacion;
        $("emMethod").value = e.paymentMethod;
        $("emSave").textContent = "Guardar cambios";
        $("emCancel").classList.remove("hidden");
        $("emName").focus();
      }));
      $("emBody").querySelectorAll("[data-emdel]").forEach((b) => b.addEventListener("click", async () => {
        if (!(await confirmDialog("El empleado deja de aparecer en la quincena. No se borra (conserva historial).", { title: "¿Desactivar empleado?", okText: "Desactivar", danger: true }))) return;
        try { await api.deleteEmployee(Number(b.dataset.emdel)); toast("Empleado desactivado"); loadEmployees(); loadQuincena(); }
        catch (e) { toast(e.message); }
      }));
    } catch (e) { $("emBody").innerHTML = `<p class="hint">${esc(e.message)}</p>`; }
  }

  async function saveEmployeeUI() {
    const name = $("emName").value.trim();
    if (!name) return toast("El nombre es obligatorio");
    const body = {
      name, role: $("emRole").value.trim(),
      salaryBase: readCop("emBase"), auxTransporte: readCop("emTransp"), auxAlimentacion: readCop("emAlim"),
      paymentMethod: $("emMethod").value
    };
    try {
      if (editing) await api.updateEmployee(editing, body); else await api.saveEmployee(body);
      toast(editing ? "Empleado actualizado" : "Empleado agregado");
      resetForm(); loadEmployees(); loadQuincena();
    } catch (e) { toast(e.message); }
  }

  async function loadQuincena() {
    const box = $("emQuincena");
    if (!box) return;
    try {
      const { rows, totals } = await api.nominaQuincena();
      box.innerHTML = `
        <div class="kpis">
          <div class="kpi"><span>Total devengado (quincena)</span><b>${money(totals.devengado)}</b></div>
          <div class="kpi"><span>Total descuentos</span><b>${money(totals.deduccion)}</b></div>
          <div class="kpi"><span>Total a pagar (neto)</span><b>${money(totals.neto)}</b></div>
          <div class="kpi"><span>Por banco / efectivo</span><b>${money(totals.banco)} / ${money(totals.efectivo)}</b></div>
        </div>
        <table class="data"><thead><tr><th>Empleado</th><th>Paga por</th><th class="r">Base/2</th><th class="r">Aux/2</th><th class="r">Devengado</th><th class="r">Descuento 8%</th><th class="r">Neto</th></tr></thead><tbody>${
          rows.map((r) => `<tr><td><b>${esc(r.name)}</b><br><span class="hint">${esc(r.role)}</span></td>
            <td>${r.paymentMethod === "banco" ? "Banco" : "Efectivo"}</td>
            <td class="r">${money(r.baseQ)}</td><td class="r">${money(r.transpQ + r.alimQ)}</td>
            <td class="r">${money(r.devengado)}</td><td class="r">${money(r.deduccion)}</td><td class="r"><b>${money(r.neto)}</b></td></tr>`).join("") || '<tr><td class="hint" colspan="7">Sin empleados activos</td></tr>'
        }</tbody><tfoot><tr><td colspan="4"><b>Totales</b></td><td class="r"><b>${money(totals.devengado)}</b></td><td class="r"><b>${money(totals.deduccion)}</b></td><td class="r"><b>${money(totals.neto)}</b></td></tr></tfoot></table>`;
    } catch (e) { box.innerHTML = `<p class="hint">${esc(e.message)}</p>`; }
  }

  async function payQuincenaUI() {
    let q;
    try { q = await api.nominaQuincena(); } catch (e) { return toast(e.message); }
    if (!q.rows.length) return toast("No hay empleados activos");
    const period = todayIso().slice(0, 7) + (new Date().getDate() <= 15 ? "-Q1" : "-Q2");
    if (!(await confirmDialog(
      `Se pagará la quincena ${period} a ${q.rows.length} empleado(s):\n\nNeto total: ${money(q.totals.neto)}\nPor banco: ${money(q.totals.banco)}\nPor efectivo: ${money(q.totals.efectivo)}\n\nSe registra como gasto en cada caja. ¿Continuar?`,
      { title: "Pagar quincena", okText: "Pagar quincena", danger: true }
    ))) return;
    try {
      const r = await api.payNomina({ date: todayIso(), period });
      toast(`Quincena pagada · ${money(r.total)} en ${r.detalle.length} pago(s)`);
      loadQuincena();
    } catch (e) { toast(e.message); }
  }

  return { renderNomina };
}
