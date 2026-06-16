import { $, esc, money, todayIso, downloadBlob } from "../utils.js";

export function createClosingReportModule(context) {
  const { api, toast, editSale } = context;

  // ---- Helpers compartidos por Cierre del día y Consolidado (mismo formato Excel) ----
  const PLAN_COLS = `<thead><tr><th>ITEM</th><th>FACT</th><th>TIPO DOC</th><th>NUM. DOC</th><th>CLIENTE</th><th>TELEFONOS</th><th>REFERIDOS</th><th>PLACA</th><th>MODELO</th><th>N°PIN ADQUIRIDO</th><th class="r">TOTAL</th><th>METODO DE PAGO</th><th class="r">DEDUCCIONES CONVENIOS</th><th class="r">SICOV SERV HOM</th><th class="r">IVA SICOV</th><th class="r">RECAUDO</th><th class="r">IVA RECAUDO</th><th class="r">ANSV</th><th class="r">FUPA</th><th class="r">COSTE TRANSACCION</th><th class="r">IVA de FACT</th><th class="r">Sustratos</th><th class="r">COSTOS TOTAL</th><th>OBSERVACIONES</th><th></th></tr></thead>`;
  function planillaRowsHtml(rows) {
    return (rows || []).map((r, i) => `<tr>
      <td>${i + 1}</td><td><b>${esc(r.factura || "-")}</b></td><td>${esc(r.tipoDoc)}</td><td>${esc(r.numDoc)}</td>
      <td>${esc(r.cliente)}</td><td>${esc(r.telefonos)}</td><td>${esc(r.referidos)}</td><td>${esc(r.placa)}</td>
      <td>${esc(String(r.modelo || ""))}</td><td>${esc(r.pin)}</td>
      <td class="r"><b>${money(r.total)}</b></td><td>${esc(r.metodoPago)}</td>
      <td class="r">${money(r.deduccionesConvenios)}</td><td class="r">${money(r.sicov)}</td><td class="r">${money(r.ivaSicov)}</td>
      <td class="r">${money(r.recaudo)}</td><td class="r">${money(r.ivaRecaudo)}</td><td class="r">${money(r.fnsv)}</td>
      <td class="r">${money(r.fupa)}</td><td class="r">${money(r.costeTransaccion)}</td><td class="r">${money(r.ivaFact)}</td>
      <td class="r">${money(r.sustratos)}</td><td class="r"><b>${money(r.costosTotal)}</b></td>
      <td>${esc(r.observaciones)}</td>
      <td>${r.id && editSale ? `<button class="link" data-editsale="${r.id}">editar</button>` : ""}</td>
    </tr>`).join("");
  }
  function planillaTableHtml(rows, totals, { searchId, bodyId } = {}) {
    const pt = totals || {};
    const search = searchId ? `<div class="row" style="margin:6px 0 10px"><input id="${searchId}" type="search" placeholder="🔎 Buscar transacción (cliente, placa, factura, cédula, convenio, PIN)…" style="max-width:520px" /></div>` : "";
    return `${search}<div style="overflow-x:auto"><table class="data xls-plan" style="font-size:.84em;white-space:nowrap">
      ${PLAN_COLS}
      <tbody ${bodyId ? `id="${bodyId}"` : ""}>${planillaRowsHtml(rows) || '<tr><td class="hint" colspan="25">Sin ventas en el rango</td></tr>'}</tbody>
      ${(rows || []).length ? `<tfoot><tr><td colspan="10"><b>Totales</b></td><td class="r"><b>${money(pt.total)}</b></td><td></td><td class="r"><b>${money(pt.deduccionesConvenios)}</b></td><td colspan="9"></td><td class="r"><b>${money(pt.costosTotal)}</b></td><td colspan="2"></td></tr></tfoot>` : ""}
    </table></div>`;
  }
  // Bloques estilo Excel (INGRESOS/RESUMEN/EGRESOS/DATAFONO/RTM PEND/ENTREGAS/CAJA MENOR + dispersión).
  function closingExcelBlocks(c, { fupas = {}, expenses = [], dispersion = [], pendientes = [] } = {}) {
    const by = c.byMethod || {};
    const val = (k) => by[k] || 0;
    const fila = (label, value, cls = "") => `<tr class="${cls}"><td>${esc(label)}</td><td class="r">${money(value)}</td></tr>`;
    const SG_METODOS = ["DATAFONO SG", "QR SG"];
    const CM_METODOS = ["EFECTIVO", "QR CM", "ALIADOS DE INV. GORA SAS", "DATAFONO CM", "TRANSFERENCIA DIRECTA", "ADDI"];
    const listados = new Set([...SG_METODOS, ...CM_METODOS, "DESCUENTO_FENIX"]);
    const otros = Object.keys(by).filter((k) => !listados.has(k) && by[k] > 0);
    const ingresos = `${SG_METODOS.map((k) => fila(k, val(k))).join("")}${fila("Subtotal SG", c.subtotalSG, "sub")}${CM_METODOS.map((k) => fila(k, val(k))).join("")}${otros.map((k) => fila(k, val(k))).join("")}${fila("Subtotal CM", c.subtotalCM, "sub")}${fila("TOTAL", c.ingresosTotal, "tot")}`;
    const resumen = `${fila("DESCUENTOS FIDELIZACIÓN", c.fidelizacion)}${fila("DESCUENTOS REFERIDOS", c.referidos)}
      <tr><td>RTM FACTURADAS</td><td class="r">${c.rtmFacturadas}</td></tr>
      <tr><td>RTM REALIZADAS</td><td class="r">${c.rtmRealizadas}</td></tr>
      <tr><td>RTM PENDIENTES</td><td class="r">${c.rtmPendientes}</td></tr>
      <tr><td>FUPAS INICIO</td><td class="r">${fupas.inicio ?? "-"}</td></tr>
      <tr><td>FUPAS FINAL</td><td class="r">${fupas.fin ?? "-"}</td></tr>`;
    const gastosRows = expenses.map((g) => fila(g.concepto, g.valor)).join("");
    const totalGastos = expenses.reduce((a, g) => a + (g.valor || 0), 0);
    const egresos = `${fila("REFERIDOS", c.egresos.referidos)}${fila("ALIADOS DE INV. GORA SAS", c.egresos.gora)}${fila("ADDI", c.egresos.addi)}${fila("FIDELIZADOS", c.egresos.fidelizados)}${fila("TOTAL", c.totalEgresosCredito, "sub")}
      <tr><td colspan="2" style="text-align:center;font-weight:800;background:#fce4d6">GASTOS</td></tr>
      ${gastosRows || '<tr><td colspan="2" class="hint" style="text-align:center">Sin gastos registrados</td></tr>'}
      ${fila("TOTAL GASTOS", totalGastos, "sub")}${fila("TOTAL EGRESOS", c.totalEgresosCredito + totalGastos, "tot")}`;
    const datafonoSg = `${fila("DATAFONO SG (tarjetas)", val("DATAFONO SG"))}${fila("QR SUPERGIROS", val("QR SG"))}${fila("TOTAL", c.subtotalSG, "sub")}`;
    const pendRows = pendientes.map((s) => `<tr><td>${esc(s.documento)}</td><td class="r">${money(s.provision || s.bruto)}</td><td>${esc(s.placa || "")}</td></tr>`).join("");
    const pendTotal = pendientes.reduce((a, s) => a + (s.provision || s.bruto || 0), 0);
    const entregas = `${fila("EFECTIVO", c.efectivoEntregar)}${fila("JASPER", c.jasper)}${fila("DIFERENCIA JASPER", c.diferenciaJasper, "sub")}`;
    const cajaMenor = `${fila("PLANILLA CAJA MENOR", c.efectivoEntregar)}${fila("A PROVISION", c.provision)}${fila("TOTAL", c.efectivoEntregar + c.provision, "ok")}`;
    const dispRows = (dispersion || []).map((g) => `<tr><td>${esc(g.grupo)}</td><td class="r">${g.cantidad || 0}</td><td class="r">${money(g.recaudoBruto)}</td><td class="r">${money((g.servicioRecaudo || 0) + (g.ivaServicio || 0))}</td><td class="r">${money((g.servicioHomologado || 0) + (g.ivaHomologado || 0))}</td><td class="r">${money(g.ansv)}</td><td class="r">${money((g.adqTransaccion || 0) + (g.ica || 0))}</td><td class="r"><b>${money(g.netoEstimado)}</b></td></tr>`).join("");
    return `
      <div class="xls-grid">
        <div class="xls-block"><h4>INGRESOS</h4><table><tbody>${ingresos}</tbody></table></div>
        <div class="xls-block"><h4>RESUMEN</h4><table><tbody>${resumen}</tbody></table></div>
        <div class="xls-block"><h4>RESUMEN EGRESOS Y CREDITO</h4><table><tbody>${egresos}</tbody></table></div>
        <div class="xls-block"><h4>DATAFONO SG</h4><table><tbody>${datafonoSg}</tbody></table>
          <h4>RTM PENDIENTES</h4>
          <table><thead><tr><th style="text-align:left;padding:6px 10px">CC</th><th style="text-align:right;padding:6px 10px">VALOR</th><th style="text-align:left;padding:6px 10px">PLACA</th></tr></thead>
          <tbody>${pendRows || '<tr><td colspan="3" class="hint" style="text-align:center">Sin RTM pendientes</td></tr>'}
          <tr class="sub"><td>Total</td><td class="r">${money(pendTotal)}</td><td>${pendientes.length}</td></tr></tbody></table></div>
        <div class="xls-block"><h4>ENTREGAS</h4><table><tbody>${entregas}</tbody></table></div>
        <div class="xls-block"><h4>CAJA MENOR</h4><table><tbody>${cajaMenor}</tbody></table></div>
      </div>
      <p class="hint">JASPER = ventas ${money(c.salesTotal)} − Supergiros directo ${money(c.subtotalSG)} − provisión ${money(c.provision)}. Efectivo a entregar = efectivo ${money(c.efectivo)} − fidelización ${money(c.fidelizacion)} − referidos ${money(c.referidos)}. Los gastos NO restan del efectivo a entregar (salen de caja menor).</p>
      <h3>Dispersión estimada Supergiros</h3>
      <table class="data"><thead><tr><th>Grupo</th><th class="r">Cant.</th><th class="r">Recaudo</th><th class="r">Serv. recaudo</th><th class="r">Homologado</th><th class="r">ANSV</th><th class="r">ADQ/ICA</th><th class="r">Neto</th></tr></thead><tbody>${dispRows || '<tr><td class="hint" colspan="8">Sin pagos para dispersar</td></tr>'}</tbody></table>`;
  }
  // Filtra las filas de la planilla por texto (cliente, placa, factura, cédula, convenio, PIN).
  function filterPlanRows(rows, q) {
    const s = String(q || "").trim().toLowerCase();
    if (!s) return rows;
    return rows.filter((r) => [r.cliente, r.placa, r.factura, r.numDoc, r.referidos, r.pin, r.metodoPago]
      .some((v) => String(v || "").toLowerCase().includes(s)));
  }

  // Vista "Cierre del día" en el FORMATO DE LA PLANILLA EXCEL del cliente:
  // planilla venta por venta + bloques INGRESOS / RESUMEN / EGRESOS Y CREDITO /
  // DATAFONO SG / RTM PENDIENTES / ENTREGAS-CAJA MENOR.
  async function loadClosing() {
    const date = $("closingDate").value || todayIso();
    const gastos = Number($("closingGastos").value) || 0;
    try {
      const [d, plan] = await Promise.all([api.closingDetail(date, gastos), api.reportDetail(date, date)]);
      const c = d.closing;
      const titulo = new Date(date + "T12:00:00").toLocaleDateString("es-CO", { weekday: "long", day: "numeric", month: "long", year: "numeric" }).toUpperCase();
      const pendientes = (d.detail || []).filter((s) => s.rtmEstado === "pending");

      $("closingBody").innerHTML = `
        <div class="xls-title">${esc(titulo)}</div>
        ${planillaTableHtml(plan.rows || [], plan.totals || {})}
        ${closingExcelBlocks(c, { fupas: d.fupas, expenses: d.expenses, dispersion: d.dispersion, pendientes })}`;
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

  let reportPlanRows = []; // filas de la planilla del rango (para el buscador)
  function wireEditSale(scope) {
    if (!editSale || !scope) return;
    scope.querySelectorAll("[data-editsale]").forEach((b) => b.addEventListener("click", () => editSale(Number(b.dataset.editsale))));
  }

  // CONSOLIDADO = mismo formato del Cierre del día pero para un RANGO de fechas, con
  // buscador de transacción. Aquí van todos los filtros y resúmenes del periodo.
  async function loadReport() {
    const from = $("repFrom").value;
    const to = $("repTo").value;
    if (!from || !to) return;
    try {
      const [range, plan] = await Promise.all([api.closingRange(from, to), api.reportDetail(from, to)]);
      const c = range.closing || {};
      reportPlanRows = plan.rows || [];
      $("reportBody").innerHTML = `
        <div class="xls-title">CONSOLIDADO · ${esc(from)} → ${esc(to)}</div>
        <div class="row" style="justify-content:flex-end;gap:8px;margin:8px 0">
          <button class="btn ghost" id="exportRepDetalle">Exportar planilla Excel</button>
          <button class="btn ghost" id="exportRepResumen">Exportar resumen Excel</button>
        </div>
        ${planillaTableHtml(reportPlanRows, plan.totals || {}, { searchId: "repSearch", bodyId: "repPlanBody" })}
        ${closingExcelBlocks(c, { fupas: range.fupas, expenses: range.expenses, dispersion: range.dispersion, pendientes: range.pendientes })}
        <h3 style="margin-top:18px">Mapa de calor — horas y días pico</h3>
        <div id="heatmapBox" class="hint">Cargando…</div>`;
      // Buscador de transacción: filtra la planilla en vivo.
      const search = $("repSearch");
      if (search) search.addEventListener("input", () => {
        const body = $("repPlanBody");
        if (!body) return;
        const filtered = filterPlanRows(reportPlanRows, search.value);
        body.innerHTML = planillaRowsHtml(filtered) || '<tr><td class="hint" colspan="25">Sin coincidencias</td></tr>';
        wireEditSale(body);
      });
      wireEditSale($("repPlanBody"));
      $("exportRepDetalle")?.addEventListener("click", async () => {
        try { await downloadBlob(await api.exportConsolidadoDetalle(from, to), `consolidado-detallado-${from}_${to}.xlsx`); } catch (e) { toast(e.message); }
      });
      $("exportRepResumen")?.addEventListener("click", async () => {
        try { await downloadBlob(await api.exportConsolidado(from, to), `consolidado-${from}_${to}.xlsx`); } catch (e) { toast(e.message); }
      });
      loadHeatmap(from, to);
    } catch (e) { toast(e.message); }
  }

  // Planilla venta por venta, igual a como el cliente la lleva en su Excel.
  async function loadReportDetalle(from, to) {
    const box = $("repDetalleBox");
    if (!box) return;
    try {
      const { rows, totals } = await api.reportDetail(from, to);
      const tr = rows.map((r) => `<tr>
        <td>${esc(r.fecha)}</td><td>${esc(r.factura)}</td><td>${esc(r.tipoDoc)}</td><td>${esc(r.numDoc)}</td>
        <td>${esc(r.cliente)}</td><td>${esc(r.telefonos)}</td><td>${esc(r.referidos)}</td><td>${esc(r.placa)}</td>
        <td>${esc(String(r.modelo || ""))}</td><td>${esc(r.pin)}</td>
        <td class="r"><b>${money(r.total)}</b></td><td>${esc(r.metodoPago)}</td>
        <td class="r">${money(r.deduccionesConvenios)}</td><td class="r">${money(r.sicov)}</td><td class="r">${money(r.ivaSicov)}</td>
        <td class="r">${money(r.recaudo)}</td><td class="r">${money(r.ivaRecaudo)}</td><td class="r">${money(r.fnsv)}</td>
        <td class="r">${money(r.fupa)}</td><td class="r">${money(r.costeTransaccion)}</td><td class="r">${money(r.ivaFact)}</td>
        <td class="r">${money(r.sustratos)}</td><td class="r"><b>${money(r.costosTotal)}</b></td>
        <td>${esc(r.observaciones)}</td>
        <td class="r"><b class="${r.dispersion < 0 ? "neg" : ""}">${money(r.dispersion)}</b></td>
      </tr>`).join("");
      box.classList.remove("hint");
      box.innerHTML = `
        <p class="hint">${rows.length} venta(s) en el rango · desliza horizontalmente para ver todas las columnas. La columna Dispersion = Total − costos de recaudo (SICOV, recaudo, FNSV, coste transacción); FUPA, sustratos e IVA de factura no restan ahí.</p>
        <div style="overflow-x:auto"><table class="data" style="font-size:.85em;white-space:nowrap">
          <thead><tr><th>FECHA</th><th>FACT</th><th>TIPO DOC</th><th>NUM. DOC</th><th>CLIENTE</th><th>TELEFONOS</th><th>REFERIDOS</th><th>PLACA</th><th>MODELO</th><th>N°PIN</th><th class="r">TOTAL</th><th>METODO DE PAGO</th><th class="r">DEDUC. CONVENIOS</th><th class="r">SICOV SERV HOM</th><th class="r">IVA SICOV</th><th class="r">RECAUDO</th><th class="r">IVA RECAUDO</th><th class="r">FNSV</th><th class="r">FUPA</th><th class="r">COSTE TRANSAC.</th><th class="r">IVA de FACT</th><th class="r">Sustratos</th><th class="r">COSTOS TOTAL</th><th>OBSERVACIONES</th><th class="r">Dispersion</th></tr></thead>
          <tbody>${tr || '<tr><td class="hint" colspan="25">Sin ventas en el rango</td></tr>'}</tbody>
          ${rows.length ? `<tfoot><tr><td colspan="10"><b>Totales</b></td><td class="r"><b>${money(totals.total)}</b></td><td></td><td class="r"><b>${money(totals.deduccionesConvenios)}</b></td><td colspan="9"></td><td class="r"><b>${money(totals.costosTotal)}</b></td><td></td><td class="r"><b>${money(totals.dispersion)}</b></td></tr></tfoot>` : ""}
        </table></div>`;
    } catch (e) { box.innerHTML = `<span class="hint">${esc(e.message)}</span>`; }
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
