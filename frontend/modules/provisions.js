import { $, esc, money, readCop, todayIso, downloadBlob } from "../utils.js";

export function createProvisionsModule(context) {
  const { api, toast } = context;
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
  return { renderProvisiones };
}
