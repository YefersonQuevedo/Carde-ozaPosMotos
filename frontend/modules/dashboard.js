import { $, esc, money, todayIso, downloadBlob, moduleStub } from "../utils.js";

export function createDashboardModule(context) {
  const { api, toast, loadHeatmap } = context;
  function renderDashboard(c) {
    moduleStub(c, { title: "Dashboard / KPIs", owner: "Codex · K1–K4",
      items: ["Indice de reportes generales", "KPIs mensuales + comparacion ano anterior", "Provision de IVA (bimestral)", "Resumen de motos entre fechas + exportar Excel"] });
  }
  renderDashboard = function (c) {
    if (!c) return;
    const from = $("dashFrom")?.value || todayIso().slice(0, 8) + "01";
    const to = $("dashTo")?.value || todayIso();
    c.innerHTML = `
      <div class="card">
        <div class="card-head">
          <h2>Dashboard / KPIs</h2>
          <div class="row filters">
            <input id="dashFrom" type="date" value="${esc(from)}" />
            <input id="dashTo" type="date" value="${esc(to)}" />
            <button class="btn primary" id="dashLoad">Actualizar</button>
            <button class="btn" id="dashExport">Excel</button>
          </div>
        </div>
        <div id="dashBody"><p class="hint">Cargando indicadores...</p></div>
      </div>`;
    $("dashLoad").addEventListener("click", loadDashboard);
    $("dashExport").addEventListener("click", exportDashboardUI);
    loadDashboard();
  };

  function dashCompareRow(label, actual, previous, isMoney = true) {
    const diff = (Number(actual) || 0) - (Number(previous) || 0);
    const fmt = isMoney ? money : (n) => String(Math.round(Number(n) || 0));
    return `<tr><td>${esc(label)}</td><td class="r">${fmt(actual)}</td><td class="r">${fmt(previous)}</td><td class="r"><b>${fmt(diff)}</b></td></tr>`;
  }

  async function loadDashboard() {
    try {
      const from = $("dashFrom").value;
      const to = $("dashTo").value;
      const { current, previous } = await api.dashboard(from, to);
      const k = current.kpis;
      const p = previous.kpis;
      const compare = [
        dashCompareRow("RTM facturadas", k.rtmFacturadas, p.rtmFacturadas, false),
        dashCompareRow("RTM realizadas", k.rtmRealizadas, p.rtmRealizadas, false),
        dashCompareRow("Ventas brutas", k.salesTotal, p.salesTotal),
        dashCompareRow("Ticket promedio", k.ticketPromedio, p.ticketPromedio),
        dashCompareRow("Jasper estimado", k.jasper, p.jasper),
        dashCompareRow("Deducciones", k.deducciones, p.deducciones),
        dashCompareRow("Dispersion neta esperada", k.dispersionNeta, p.dispersionNeta),
        dashCompareRow("Dispersion efectivo", k.dispersionEfectivoNeto, p.dispersionEfectivoNeto),
        dashCompareRow("Dispersion bancos/QR/tarjeta", k.dispersionBancosNeto, p.dispersionBancosNeto),
        dashCompareRow("IVA provisionado", k.ivaProvision, p.ivaProvision),
        dashCompareRow("Utilidad bruta aprox.", k.utilidadBruta, p.utilidadBruta)
      ].join("");
      const ranges = current.byRange.map((r) => `<tr><td>${esc(r.key)}</td><td class="r">${r.count}</td><td class="r">${r.realized}</td><td class="r">${r.pending}</td><td class="r">${money(r.total)}</td></tr>`).join("");
      // Metodos de pago: solo el % del valor (favoritismo), sin cantidad ni valor.
      // Se excluye el cupon/descuento: no es un metodo de pago real.
      const realMethods = (current.byMethod || []).filter((m) => !/descuento|cup[oó]n/i.test(m.method || ""));
      const methodTotal = realMethods.reduce((s, m) => s + (Number(m.value) || 0), 0) || 1;
      const methods = realMethods
        .slice()
        .sort((a, b) => (b.value || 0) - (a.value || 0))
        .map((m) => {
          const pct = Math.round(((Number(m.value) || 0) / methodTotal) * 1000) / 10;
          return `<tr><td>${esc(m.method)}</td><td class="r"><b>${pct}%</b></td></tr>`;
        }).join("");
      const dispersion = (current.byDispersion || []).map((d) => `<tr><td>${esc(d.grupo)}</td><td class="r">${d.cantidad || 0}</td><td class="r">${money(d.recaudoBruto)}</td><td class="r">${money((d.servicioRecaudo || 0) + (d.ivaServicio || 0) + (d.servicioHomologado || 0) + (d.ivaHomologado || 0) + (d.ansv || 0) + (d.adqTransaccion || 0) + (d.ica || 0))}</td><td class="r"><b>${money(d.netoEstimado)}</b></td></tr>`).join("");
      // Horas pico: solo el conteo de RTM (sin valores de venta, por pedido del cliente).
      const heatmap = (current.byHourHeatmap || []).slice(0, 12).map((h) => `<tr><td>${esc(h.day)}</td><td>${esc(h.label)}</td><td class="r">${h.count}</td></tr>`).join("");
      const days = current.byDay.map((d) => `<tr><td>${esc(d.date)}</td><td class="r">${d.count}</td><td class="r">${d.realized}</td><td class="r">${d.pending}</td><td class="r">${money(d.total)}</td></tr>`).join("");
      $("dashBody").innerHTML = `
        <div class="kpis">
          <div class="kpi"><span>Ventas brutas</span><b>${money(k.salesTotal)}</b></div>
          <div class="kpi"><span>RTM realizadas</span><b>${k.rtmRealizadas}/${k.rtmFacturadas}</b></div>
          <div class="kpi"><span>Ticket promedio</span><b>${money(k.ticketPromedio)}</b></div>
          <div class="kpi"><span>Directo / referido</span><b>${k.directPct}% / ${k.referredPct}%</b><small>${k.directSales} directo · ${k.referredSales} referido</small></div>
          <div class="kpi"><span>Jasper estimado</span><b>${money(k.jasper)}</b></div>
          <div class="kpi"><span>Dispersion neta</span><b>${money(k.dispersionNeta)}</b></div>
          <div class="kpi"><span>Efectivo / bancos</span><b>${money(k.dispersionEfectivoNeto)} / ${money(k.dispersionBancosNeto)}</b></div>
          <div class="kpi"><span>IVA provisionado</span><b>${money(k.ivaProvision)}</b></div>
          <div class="kpi"><span>Utilidad bruta aprox.</span><b>${money(k.utilidadBruta)}</b></div>
        </div>
        <div class="split">
          <div>
            <h3>Comparacion contra año anterior</h3>
            <table class="data"><thead><tr><th>Indicador</th><th class="r">Actual</th><th class="r">Año anterior</th><th class="r">Diferencia</th></tr></thead><tbody>${compare}</tbody></table>
            <h3>Resumen de motos por rango</h3>
            <table class="data"><thead><tr><th>Rango</th><th class="r">Total</th><th class="r">Realizadas</th><th class="r">Pendientes</th><th class="r">Ventas</th></tr></thead><tbody>${ranges || '<tr><td class="hint" colspan="5">Sin motos en el rango</td></tr>'}</tbody></table>
            <h3>Mapa de calor</h3>
            <div id="dashHeatmapBox" class="hint">Cargando...</div>
            <h3>Horas pico</h3>
            <table class="data"><thead><tr><th>Dia</th><th>Hora</th><th class="r">RTM</th></tr></thead><tbody>${heatmap || '<tr><td class="hint" colspan="3">Sin ventas con hora</td></tr>'}</tbody></table>
          </div>
          <div>
            <h3>Dispersion estimada Supergiros</h3>
            <table class="data"><thead><tr><th>Grupo</th><th class="r">Cant.</th><th class="r">Bruto</th><th class="r">Deducciones</th><th class="r">Neto</th></tr></thead><tbody>${dispersion || '<tr><td class="hint" colspan="5">Sin dispersion calculada</td></tr>'}</tbody></table>
            <h3>Metodos de pago <small class="hint">(% del valor · favoritismo)</small></h3>
            <table class="data"><thead><tr><th>Metodo</th><th class="r">% del valor</th></tr></thead><tbody>${methods || '<tr><td class="hint" colspan="2">Sin pagos</td></tr>'}</tbody></table>
            <h3>Dias</h3>
            <table class="data"><thead><tr><th>Dia</th><th class="r">RTM</th><th class="r">Hechas</th><th class="r">Pend.</th><th class="r">Ventas</th></tr></thead><tbody>${days || '<tr><td class="hint" colspan="5">Sin dias</td></tr>'}</tbody></table>
          </div>
        </div>`;
      loadHeatmap(from, to, "dashHeatmapBox");
    } catch (e) { toast(e.message); }
  }

  async function exportDashboardUI() {
    try {
      const from = $("dashFrom").value;
      const to = $("dashTo").value;
      const blob = await api.exportDashboard(from, to);
      await downloadBlob(blob, `dashboard-${from}_${to}.xlsx`);
    } catch (e) { toast(e.message); }
  }
  return { renderDashboard };
}
