import { $, esc, money, todayIso, downloadBlob } from "../utils.js";

export function createClosingReportModule(context) {
  const { api, toast, editSale } = context;
  async function loadClosing() {
    const date = $("closingDate").value || todayIso();
    const gastos = Number($("closingGastos").value) || 0;
    try {
      const { closing, detail, dispersion } = await api.closingDetail(date, gastos);
      const c = closing;
      const methods = Object.entries(c.byMethod).map(([k, v]) => `<tr><td>${esc(k)}</td><td class="r">${(c.countByMethod && c.countByMethod[k]) || 0}</td><td class="r">${money(v)}</td></tr>`).join("");
      const rows = detail.slice(0, 80).map((s) => `<tr><td>${esc(s.item)}</td><td>${esc(s.ventaInterna)}</td><td>${esc(s.facturaPosDian || "-")}</td><td>${esc(s.cliente)}</td><td>${esc(s.placa || "")}</td><td>${esc(s.tipoCliente)} / ${esc(s.referido || "")}</td><td>${esc(s.rtmEstado)}</td><td>${esc(s.pinRegistrado || "-")}</td><td class="r">${money(s.efectivoReal)}</td><td class="r">${money(s.bancosTarjetaQr)}</td><td class="r">${money(s.valorComision)}</td><td class="r">${money(s.costosTotal)}</td><td class="r">${money(s.base)}</td><td class="r">${money(s.iva)}</td><td class="r">${money(s.bruto)}</td><td>${s.id && editSale ? `<button class="link" data-editsale="${s.id}">editar</button>` : ""}</td></tr>`).join("");
      const dispRows = (dispersion || []).map((d) => `<tr><td>${esc(d.grupo)}</td><td class="r">${d.cantidad || 0}</td><td class="r">${money(d.recaudoBruto)}</td><td class="r">${money((d.servicioRecaudo || 0) + (d.ivaServicio || 0))}</td><td class="r">${money((d.servicioHomologado || 0) + (d.ivaHomologado || 0))}</td><td class="r">${money(d.ansv)}</td><td class="r">${money((d.adqTransaccion || 0) + (d.ica || 0))}</td><td class="r"><b>${money(d.netoEstimado)}</b></td></tr>`).join("");
      $("closingBody").innerHTML = `
        <div class="kpis">
          <div class="kpi"><span>Ventas</span><b>${money(c.salesTotal)}</b></div>
          <div class="kpi"><span>JASPER (gira Supergiros)</span><b>${money(c.jasper)}</b></div>
          <div class="kpi"><span>Provision</span><b>${money(c.provision)}</b></div>
          <div class="kpi"><span>Efectivo a entregar</span><b>${money(c.efectivoEntregar)}</b></div>
          <div class="kpi"><span>RTM realizadas</span><b>${c.rtmRealizadas}/${c.rtmFacturadas}</b></div>
          <div class="kpi"><span>Cartera abierta</span><b>${money(c.receivableOpen)}</b></div>
        </div>
        <div class="grid2">
          <div><h3>Ingresos por metodo</h3><table class="data"><thead><tr><th>Metodo</th><th class="r">Cant.</th><th class="r">Valor</th></tr></thead><tbody>${methods || '<tr><td class="hint" colspan="3">Sin pagos</td></tr>'}</tbody></table>
            <div class="amount"><span>Subtotal SG</span><b>${money(c.subtotalSG)}</b></div>
            <div class="amount"><span>Subtotal CM</span><b>${money(c.subtotalCM)}</b></div></div>
          <div><h3>Deducciones (van a provisiones)</h3>
            <div class="amount"><span>Fidelización / cupón</span><b>${money(c.fidelizacion)}</b></div>
            <div class="amount"><span>Referidos (comisión)</span><b>${money(c.referidos)}</b></div>
            <div class="amount"><span>GORA</span><b>${money(c.egresos.gora)}</b></div>
            <div class="amount"><span>ADDI</span><b>${money(c.egresos.addi)}</b></div>
            <div class="amount total"><span>Total comisiones a provisiones</span><b>${money(c.deducciones)}</b></div></div>
        </div>
        <h3>Desglose (de donde sale cada numero)</h3>
        <div class="amount"><span>Ventas RTM ${money(c.salesTotal)} − Supergiros directo ${money(c.subtotalSG)} − Provisión ${money(c.provision)}</span><b>JASPER ${money(c.jasper)}</b></div>
        <div class="amount"><span>Efectivo ${money(c.efectivo)} − Fideliz./cupón ${money(c.fidelizacion)} − Referidos ${money(c.referidos)}</span><b>Efectivo a entregar (caja menor) ${money(c.efectivoEntregar)}</b></div>
        <div class="amount"><span>Comisiones/descuentos a provisiones</span><b>${money(c.deducciones)}</b></div>
        <div class="amount total"><span>JASPER ${money(c.jasper)} − Efectivo entregado ${money(c.efectivoEntregar)}</span><b>Diferencia ${money(c.diferenciaJasper)} (≈ comisiones que cubre el CDA)</b></div>
        <p class="hint">Los gastos NO restan del efectivo a entregar: salen de caja menor. Gastos del día: ${money(c.gastosRegistrados || 0)} (módulo Gastos)${(c.gastosManual || 0) > 0 ? ` + ${money(c.gastosManual)} extra` : ""}.</p>
        <h3>Dispersion estimada Supergiros</h3>
        <table class="data"><thead><tr><th>Grupo</th><th class="r">Cant.</th><th class="r">Recaudo</th><th class="r">Serv. recaudo</th><th class="r">Homologado</th><th class="r">ANSV</th><th class="r">ADQ/ICA</th><th class="r">Neto</th></tr></thead><tbody>${dispRows || '<tr><td class="hint" colspan="8">Sin pagos para dispersar</td></tr>'}</tbody></table>
        <h3>Detalle del dia</h3>
        <p class="hint">Vista rapida. El boton "Detalle Excel" descarga la planilla completa con pagos, costos, movimientos de caja y gastos.</p>
        <table class="data"><thead><tr><th>#</th><th>Venta</th><th>Factura</th><th>Cliente</th><th>Placa</th><th>Tipo/ref.</th><th>RTM</th><th>PIN</th><th class="r">Efectivo</th><th class="r">Bancos</th><th class="r">Comision</th><th class="r">Costos</th><th class="r">Base</th><th class="r">IVA</th><th class="r">Total</th><th>Acción</th></tr></thead><tbody>${rows || '<tr><td class="hint" colspan="16">Sin ventas</td></tr>'}</tbody></table>`;
      if (editSale) $("closingBody").querySelectorAll("[data-editsale]").forEach((b) => b.addEventListener("click", () => editSale(Number(b.dataset.editsale))));
    } catch (e) { toast(e.message); }
  }
  async function exportClosingUI() {
    try {
      const date = $("closingDate").value || todayIso();
      const gastos = Number($("closingGastos").value) || 0;
      const blob = await api.exportClosing(date, gastos);
      await downloadBlob(blob, `cierre-${date}.xlsx`);
    } catch (e) { toast(e.message); }
  }
  async function exportClosingDetailUI() {
    try {
      const date = $("closingDate").value || todayIso();
      const gastos = Number($("closingGastos").value) || 0;
      const blob = await api.exportClosingDetail(date, gastos);
      await downloadBlob(blob, `detalle-dia-${date}.xlsx`);
    } catch (e) { toast(e.message); }
  }
  async function exportReportUI() {
    try {
      const from = $("repFrom").value, to = $("repTo").value;
      if (!from || !to) return toast("Elige el rango de fechas");
      const blob = await api.exportConsolidado(from, to);
      await downloadBlob(blob, `consolidado-${from}_${to}.xlsx`);
    } catch (e) { toast(e.message); }
  }

  async function freezeClosing() {
    try {
      await api.saveClosing({ date: $("closingDate").value || todayIso(), gastos: Number($("closingGastos").value) || 0 });
      toast("Cierre del día guardado · dispersado a caja menor y por pagar Supergiros");
    } catch (e) { toast(e.message); }
  }

  async function loadReport() {
    const from = $("repFrom").value;
    const to = $("repTo").value;
    if (!from || !to) return;
    try {
      const { days, totals: t } = await api.report(from, to);
      const rows = days.map((d) => `<tr><td>${esc(d.date)}</td><td class="r">${money(d.salesTotal)}</td><td class="r">${money(d.jasper)}</td><td class="r">${money(d.provision)}</td><td class="r">${money(d.deducciones)}</td><td class="r">${money(d.efectivoEntregar)}</td><td class="r">${d.rtmRealizadas}/${d.rtmFacturadas}</td></tr>`).join("");
      $("reportBody").innerHTML = `
        <div class="kpis">
          <div class="kpi"><span>Ventas del periodo</span><b>${money(t.salesTotal)}</b></div>
          <div class="kpi"><span>JASPER total</span><b>${money(t.jasper)}</b></div>
          <div class="kpi"><span>Provision</span><b>${money(t.provision)}</b></div>
          <div class="kpi"><span>Deducciones</span><b>${money(t.deducciones)}</b></div>
          <div class="kpi"><span>Efectivo entregado</span><b>${money(t.efectivoEntregar)}</b></div>
          <div class="kpi"><span>RTM realizadas</span><b>${t.rtmRealizadas}/${t.rtmFacturadas}</b></div>
        </div>
        <table class="data"><thead><tr><th>Dia</th><th class="r">Ventas</th><th class="r">Jasper</th><th class="r">Provision</th><th class="r">Deducciones</th><th class="r">Efectivo</th><th class="r">RTM</th></tr></thead>
        <tbody>${rows || '<tr><td class="hint" colspan="7">Sin ventas en el rango</td></tr>'}</tbody>
        <tfoot><tr><td><b>Total</b></td><td class="r"><b>${money(t.salesTotal)}</b></td><td class="r"><b>${money(t.jasper)}</b></td><td class="r"><b>${money(t.provision)}</b></td><td class="r"><b>${money(t.deducciones)}</b></td><td class="r"><b>${money(t.efectivoEntregar)}</b></td><td></td></tr></tfoot>
        </table>
        <h3 style="margin-top:18px">Mapa de calor — horas y días pico</h3>
        <div id="heatmapBox" class="hint">Cargando…</div>`;
      loadHeatmap(from, to);
    } catch (e) { toast(e.message); }
  }
  // Color de celda segun intensidad (0..1): de gris claro a verde fuerte.
  function heatColor(ratio) {
    if (ratio <= 0) return "#eef2f7";
    const r = Math.round(232 - 200 * ratio);
    const g = Math.round(244 - 70 * ratio);
    const b = Math.round(247 - 200 * ratio);
    return `rgb(${r},${g},${b})`;
  }
  async function loadHeatmap(from, to, boxId = "heatmapBox") {
    try {
      const d = await api.heatmap(from, to);
      const hours = [];
      for (let h = d.hourMin; h <= d.hourMax; h++) hours.push(h);
      const head = `<tr><th></th>${hours.map((h) => `<th>${String(h).padStart(2, "0")}h</th>`).join("")}<th>Total</th></tr>`;
      const body = d.rows.map((row) => {
        const cells = hours.map((h) => {
          const v = row.hours[h] || 0;
          const ratio = d.max ? v / d.max : 0;
          return `<td class="cell" style="background:${heatColor(ratio)};color:${ratio > 0.55 ? "#fff" : "#0b3d20"}" title="${row.day} ${String(h).padStart(2, "0")}:00 · ${v}">${v || ""}</td>`;
        }).join("");
        return `<tr><td class="day">${row.day}</td>${cells}<td class="day">${row.total}</td></tr>`;
      }).join("");
      $(boxId).innerHTML = `
        <div class="row" style="gap:18px;margin-bottom:8px">
          <div class="pill ok">Día pico: ${esc(d.peakDay || "-")}</div>
          <div class="pill ok">Hora pico: ${esc(d.peakHour || "-")}</div>
          <span class="hint">${d.total} RTM en el rango · más oscuro = más movimiento</span>
        </div>
        <div style="overflow-x:auto"><table class="heatmap">${head}${body}</table></div>`;
    } catch (e) { $(boxId).innerHTML = `<span class="hint">${esc(e.message)}</span>`; }
  }
  return { loadClosing, exportClosingUI, exportClosingDetailUI, exportReportUI, freezeClosing, loadReport, loadHeatmap };
}
