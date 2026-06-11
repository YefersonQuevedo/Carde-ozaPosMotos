import { $, esc, money, todayIso, downloadBlob } from "../utils.js";

export function createCallsModule(context) {
  const { api, toast, switchView, loadClientDetail } = context;
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
  return { renderLlamadas, loadDirectoReferido };
}
