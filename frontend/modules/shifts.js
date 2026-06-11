import { $, esc, money, readCop, todayIso, downloadBlob } from "../utils.js";

export function createShiftsModule(context) {
  const { api, toast, onShiftChange } = context;
  let current = null; // { shift, closing } | { shift: null }

  async function refresh() {
    try { current = await api.currentShift(); } catch { current = { shift: null }; }
    if (typeof onShiftChange === "function") onShiftChange(current.shift || null);
    return current;
  }

  async function renderShifts(c) {
    if (!c) return;
    await refresh();
    const open = current.shift && current.shift.status === "abierto" ? current.shift : null;
    const cl = current.closing;
    const month0 = todayIso().slice(0, 8) + "01";

    c.innerHTML = `
      <div class="card">
        <div class="card-head"><h2>Turno actual</h2></div>
        <div id="shiftCurrent">${open ? openHtml(open, cl) : closedHtml()}</div>
      </div>
      <div class="card">
        <div class="card-head"><h2>Historial de turnos</h2>
          <div class="row">
            <label class="rng">Desde <input type="date" id="shFrom" value="${month0}" /></label>
            <label class="rng">Hasta <input type="date" id="shTo" value="${todayIso()}" /></label>
            <button class="btn primary" id="shLoad">Ver</button>
            <button class="btn ghost" id="shExport">Exportar Excel</button>
          </div>
        </div>
        <div id="shBody"></div>
      </div>`;

    wireCurrent();
    $("shLoad").addEventListener("click", loadHistory);
    $("shExport").addEventListener("click", async () => { try { await downloadBlob(await api.exportShifts({ from: $("shFrom").value, to: $("shTo").value }), "turnos.xlsx"); } catch (e) { toast(e.message); } });
    loadHistory();
  }

  function closedHtml() {
    return `<p class="hint">No hay ningún turno abierto. Abre uno para poder facturar.</p>
      <div class="form-grid">
        <label class="fld">Base inicial (efectivo)<input id="shOpenCash" inputmode="numeric" placeholder="$ con cuánto abre la caja" /></label>
        <label class="fld">Responsable<input id="shOpenBy" placeholder="Quién abre el turno" /></label>
      </div>
      <div class="row form-actions"><button class="btn success" id="shOpenBtn">Abrir turno</button></div>`;
  }

  function openHtml(s, cl) {
    const k = cl || {};
    return `
      <div class="row" style="gap:12px;margin-bottom:10px">
        <span class="pill ok">Turno #${s.number} · ${esc(s.businessDate)} · ABIERTO</span>
        ${s.openedBy ? `<span class="hint">Abrió: ${esc(s.openedBy)}</span>` : ""}
        <span class="hint">Base inicial: ${money(s.openingCash)}</span>
      </div>
      <div class="kpis">
        <div class="kpi"><span>Ventas del turno</span><b>${money(k.salesTotal || 0)}</b></div>
        <div class="kpi"><span>Efectivo a entregar</span><b>${money(k.efectivoEntregar || 0)}</b></div>
        <div class="kpi"><span>Supergiros (Jasper)</span><b>${money(k.jasper || 0)}</b></div>
        <div class="kpi"><span>RTM realizadas</span><b>${(k.rtmRealizadas || 0)}/${(k.rtmFacturadas || 0)}</b></div>
      </div>
      <h3>Cerrar turno (arqueo)</h3>
      <div class="form-grid">
        <label class="fld">Efectivo contado físicamente<input id="shCountCash" inputmode="numeric" placeholder="$ lo que hay en caja" /></label>
        <label class="fld">Cierra (responsable)<input id="shCloseBy" placeholder="Quién cierra" /></label>
        <div class="fld" style="align-self:end"><div id="shArqueo" class="hint">Esperado a entregar: ${money(k.efectivoEntregar || 0)}</div></div>
      </div>
      <div class="row form-actions"><button class="btn danger" id="shCloseBtn">Cerrar turno y dispersar</button></div>`;
  }

  function wireCurrent() {
    const openBtn = $("shOpenBtn");
    if (openBtn) openBtn.addEventListener("click", openShiftUI);
    const closeBtn = $("shCloseBtn");
    if (closeBtn) closeBtn.addEventListener("click", closeShiftUI);
    const count = $("shCountCash");
    if (count) count.addEventListener("input", () => {
      const exp = (current.closing && current.closing.efectivoEntregar) || 0;
      const got = Math.round(Number(String(count.value).replace(/[^\d]/g, "")) || 0);
      const diff = got - exp;
      const txt = diff === 0 ? "cuadra exacto" : diff > 0 ? `sobran ${money(diff)}` : `faltan ${money(-diff)}`;
      $("shArqueo").innerHTML = `Esperado: ${money(exp)} · Contado: ${money(got)} · <b>${txt}</b>`;
    });
  }

  async function openShiftUI() {
    try {
      await api.openShift({ openingCash: readCop("shOpenCash"), openedBy: ($("shOpenBy").value || "").trim() });
      toast("Turno abierto");
      await renderShifts($("shiftsRoot"));
    } catch (e) { toast(e.message); }
  }

  async function closeShiftUI() {
    const s = current.shift;
    if (!s) return;
    if (!confirm("¿Cerrar el turno? Se hará el arqueo y la dispersión a caja menor.")) return;
    try {
      const r = await api.closeShift(s.id, { countedCash: readCop("shCountCash") || null, closedBy: ($("shCloseBy").value || "").trim() });
      const a = r.arqueo || {};
      const diff = a.cashDiff || 0;
      toast(diff === 0 ? "Turno cerrado · arqueo cuadra" : diff > 0 ? `Turno cerrado · sobran ${money(diff)}` : `Turno cerrado · faltan ${money(-diff)}`);
      await renderShifts($("shiftsRoot"));
    } catch (e) { toast(e.message); }
  }

  async function loadHistory() {
    try {
      const { items } = await api.shifts({ from: $("shFrom").value, to: $("shTo").value });
      $("shBody").innerHTML = `<table class="data"><thead><tr><th>Fecha</th><th>#</th><th>Estado</th><th>Abrió</th><th class="r">Base</th><th class="r">Esperado</th><th class="r">Contado</th><th class="r">Diferencia</th><th class="r">Ventas</th><th class="r">Jasper</th><th>Cerró</th></tr></thead><tbody>${
        items.map((s) => `<tr>
          <td>${esc(s.businessDate)}</td><td>${s.number}</td>
          <td><span class="pill ${s.status === "abierto" ? "ok" : ""}">${esc(s.status)}</span></td>
          <td>${esc(s.openedBy || "")}</td><td class="r">${money(s.openingCash)}</td>
          <td class="r">${money(s.expectedCash)}</td><td class="r">${s.countedCash == null ? "-" : money(s.countedCash)}</td>
          <td class="r">${s.status === "cerrado" ? `<b class="${s.cashDiff < 0 ? "neg" : ""}">${money(s.cashDiff)}</b>` : "-"}</td>
          <td class="r">${money(s.salesTotal)}</td><td class="r">${money(s.jasper)}</td><td>${esc(s.closedBy || "")}</td>
        </tr>`).join("") || '<tr><td class="hint" colspan="11">Sin turnos en el rango</td></tr>'
      }</tbody></table>`;
    } catch (e) { toast(e.message); }
  }

  return { renderShifts, refresh, getCurrent: () => current };
}
