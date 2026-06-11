import { $, esc, readCop, todayIso, downloadBlob } from "../utils.js";

export function createFupaModule(context) {
  const { api, toast } = context;
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
  return { renderFupa };
}
