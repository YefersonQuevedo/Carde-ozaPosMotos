import { $, esc, money, todayIso, downloadBlob } from "../utils.js";

export function createClosingReportModule(context) {
  const { api, toast, editSale } = context;

  // Costos/dispersión guardan 3 decimales; por defecto se ven redondeados y el botón
  // "👁 decimales" los revela. money3 muestra los 3 decimales.
  let showDecimals = false;
  const money3 = (v) => new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", minimumFractionDigits: 3, maximumFractionDigits: 3 }).format(Number(v) || 0);
  const fmtCost = (v) => (showDecimals ? money3(v) : money(v));
  const eyeBtn = () => `<button class="btn ghost sm" id="toggleDecimals">${showDecimals ? "🙈 ocultar decimales" : "👁 ver decimales"}</button>`;

  // ---- Filtro por medios de pago (compartido por Cierre y Consolidado) ----
  // Por defecto TODOS. El dinero se prorratea por el método; los conteos (RTM) cuentan
  // la venta si usó el método. currentMethods()=null cuando están todos (= sin filtro).
  let pmList = [];                 // [{ code, name }]
  const pmChecked = new Set();     // códigos marcados
  let pmLoaded = false;
  let pmOpen = false;              // estado abierto/cerrado del desplegable (persiste entre recargas)
  async function ensurePaymentMethods() {
    if (pmLoaded) return;
    try {
      const cat = await api.catalog();
      pmList = ((cat.paymentMethods || cat.methods || []).map((m) => ({ code: m.code, name: m.name })));
    } catch { pmList = []; }
    pmList.forEach((m) => pmChecked.add(m.code));
    pmLoaded = true;
  }
  function currentMethods() {
    if (!pmLoaded || pmChecked.size === 0 || pmChecked.size === pmList.length) return null; // todos = sin filtro
    return [...pmChecked];
  }
  function methodsFilterHtml() {
    if (!pmList.length) return "";
    const total = pmList.length, sel = pmChecked.size;
    const label = (sel === 0 || sel === total) ? "Todos" : `${sel} de ${total}`;
    const boxes = pmList.map((m) => `<label style="display:block;padding:3px 4px;white-space:nowrap"><input type="checkbox" class="pm-chk" value="${esc(m.code)}" ${pmChecked.has(m.code) ? "checked" : ""}/> ${esc(m.name)}</label>`).join("");
    return `<details class="methods-filter" ${pmOpen ? "open" : ""} style="position:relative">
      <summary style="cursor:pointer;user-select:none;border:1px solid #cbd5e1;border-radius:8px;padding:6px 10px;background:#fff;display:inline-block">🔎 Medios de pago: <b>${label}</b></summary>
      <div style="position:absolute;z-index:50;margin-top:4px;background:#fff;border:1px solid #cbd5e1;border-radius:10px;box-shadow:0 10px 30px rgba(0,0,0,.15);padding:10px;max-height:280px;overflow:auto;min-width:230px">
        <div class="row" style="gap:6px;margin-bottom:6px"><button type="button" class="btn ghost sm" data-pm="all">Todos</button><button type="button" class="btn ghost sm" data-pm="none">Ninguno</button></div>
        ${boxes}
      </div>
    </details>`;
  }
  function methodsActiveHint() {
    const m = currentMethods();
    if (!m) return "";
    const names = m.map((code) => (pmList.find((x) => x.code === code)?.name || code)).join(", ");
    return `<div class="pill warn" style="margin:6px 0;display:block">Filtro activo — <b>${esc(names)}</b>: el dinero se muestra prorrateado y el cuadro de transacciones lista las ventas que usaron esos métodos.</div>`;
  }
  function wireMethodsFilter(reload) {
    const det = document.querySelector(".methods-filter");
    if (!det) return;
    det.addEventListener("toggle", () => { pmOpen = det.open; });
    det.querySelectorAll(".pm-chk").forEach((c) => c.addEventListener("change", () => {
      if (c.checked) pmChecked.add(c.value); else pmChecked.delete(c.value);
      reload();
    }));
    det.querySelector('[data-pm="all"]')?.addEventListener("click", () => { pmList.forEach((m) => pmChecked.add(m.code)); reload(); });
    det.querySelector('[data-pm="none"]')?.addEventListener("click", () => { pmChecked.clear(); reload(); });
  }

  // ---- Helpers compartidos por Cierre del día y Consolidado (mismo formato Excel) ----
  const PLAN_COLS = `<thead><tr><th>ITEM</th><th>FACT</th><th>TIPO DOC</th><th>NUM. DOC</th><th>CLIENTE</th><th>TELEFONOS</th><th>REFERIDOS</th><th>PLACA</th><th>MODELO</th><th>N°PIN ADQUIRIDO</th><th class="r">TOTAL</th><th>METODO DE PAGO</th><th class="r">DEDUCCIONES CONVENIOS</th><th class="r">SICOV SERV HOM</th><th class="r">IVA SICOV</th><th class="r">RECAUDO</th><th class="r">IVA RECAUDO</th><th class="r">ANSV</th><th class="r">FUPA</th><th class="r">COSTE TRANSACCION</th><th class="r">IVA de FACT</th><th class="r">Sustratos</th><th class="r">COSTOS TOTAL</th><th>OBSERVACIONES</th><th></th></tr></thead>`;
  function planillaRowsHtml(rows, { selectable } = {}) {
    return (rows || []).map((r, i) => `<tr>
      ${selectable ? `<td style="text-align:center"><input type="checkbox" class="sel-sale" data-selid="${r.id}" /></td>` : ""}
      <td>${i + 1}</td><td><b>${esc(r.factura || "-")}</b></td><td>${esc(r.tipoDoc)}</td><td>${esc(r.numDoc)}</td>
      <td>${esc(r.cliente)}</td><td>${esc(r.telefonos)}</td><td>${esc(r.referidos)}</td><td>${esc(r.placa)}</td>
      <td>${esc(String(r.modelo || ""))}</td><td>${esc(r.pin)}</td>
      <td class="r"><b>${money(r.total)}</b></td><td>${esc(r.metodoPago)}</td>
      <td class="r">${money(r.deduccionesConvenios)}</td><td class="r">${fmtCost(r.sicov)}</td><td class="r">${fmtCost(r.ivaSicov)}</td>
      <td class="r">${fmtCost(r.recaudo)}</td><td class="r">${fmtCost(r.ivaRecaudo)}</td><td class="r">${fmtCost(r.fnsv)}</td>
      <td class="r">${fmtCost(r.fupa)}</td><td class="r">${fmtCost(r.costeTransaccion)}</td><td class="r">${fmtCost(r.ivaFact)}</td>
      <td class="r">${fmtCost(r.sustratos)}</td><td class="r"><b>${fmtCost(r.costosTotal)}</b></td>
      <td>${esc(r.observaciones)}</td>
      <td>${r.id && editSale ? `<button class="link" data-editsale="${r.id}">editar</button>` : ""}</td>
    </tr>`).join("");
  }
  function planillaTableHtml(rows, totals, { searchId, bodyId, selectable } = {}) {
    const pt = totals || {};
    const search = searchId ? `<div class="row" style="margin:6px 0 10px"><input id="${searchId}" type="search" placeholder="🔎 Buscar transacción (cliente, placa, factura, cédula, convenio, PIN)…" style="max-width:520px" /></div>` : "";
    const thead = selectable ? PLAN_COLS.replace("<tr>", `<tr><th style="width:30px;text-align:center"><input type="checkbox" id="selAll" title="Seleccionar todas" /></th>`) : PLAN_COLS;
    const emptyColspan = selectable ? 26 : 25;
    const footLabel = selectable ? 11 : 10;
    return `${search}<div style="overflow-x:auto"><table class="data xls-plan" style="font-size:.84em;white-space:nowrap">
      ${thead}
      <tbody ${bodyId ? `id="${bodyId}"` : ""}>${planillaRowsHtml(rows, { selectable }) || `<tr><td class="hint" colspan="${emptyColspan}">Sin ventas en el rango</td></tr>`}</tbody>
      ${(rows || []).length ? `<tfoot><tr><td colspan="${footLabel}"><b>Totales</b></td><td class="r"><b>${money(pt.total)}</b></td><td></td><td class="r"><b>${money(pt.deduccionesConvenios)}</b></td><td colspan="9"></td><td class="r"><b>${money(pt.costosTotal)}</b></td><td colspan="2"></td></tr></tfoot>` : ""}
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
    const dispRows = (dispersion || []).map((g) => `<tr><td>${esc(g.grupo)}</td><td class="r">${g.cantidad || 0}</td><td class="r">${money(g.recaudoBruto)}</td><td class="r">${fmtCost((g.servicioRecaudo || 0) + (g.ivaServicio || 0))}</td><td class="r">${fmtCost((g.servicioHomologado || 0) + (g.ivaHomologado || 0))}</td><td class="r">${fmtCost(g.ansv)}</td><td class="r">${fmtCost((g.adqTransaccion || 0) + (g.ica || 0))}</td><td class="r"><b>${money(g.netoEstimado)}</b></td></tr>`).join("");
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
      await ensurePaymentMethods();
      const methods = currentMethods();
      const [d, plan] = await Promise.all([api.closingDetail(date, gastos, methods), api.reportDetail(date, date, methods)]);
      const c = d.closing;
      const titulo = new Date(date + "T12:00:00").toLocaleDateString("es-CO", { weekday: "long", day: "numeric", month: "long", year: "numeric" }).toUpperCase();
      const pendientes = (d.detail || []).filter((s) => s.rtmEstado === "pending");

      $("closingBody").innerHTML = `
        <div class="xls-title">${esc(titulo)}</div>
        <div class="row" style="justify-content:space-between;align-items:center;gap:8px;margin:6px 0">${methodsFilterHtml()}${eyeBtn()}</div>
        ${methodsActiveHint()}
        ${planillaTableHtml(plan.rows || [], plan.totals || {})}
        ${closingExcelBlocks(c, { fupas: d.fupas, expenses: d.expenses, dispersion: d.dispersion, pendientes })}`;
      $("toggleDecimals")?.addEventListener("click", () => { showDecimals = !showDecimals; loadClosing(); });
      wireMethodsFilter(loadClosing);
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
      await ensurePaymentMethods();
      const methods = currentMethods();
      const [range, plan] = await Promise.all([api.closingRange(from, to, methods), api.reportDetail(from, to, methods)]);
      const c = range.closing || {};
      reportPlanRows = plan.rows || [];
      $("reportBody").innerHTML = `
        <div class="xls-title">CONSOLIDADO · ${esc(from)} → ${esc(to)}</div>
        ${methodsActiveHint()}
        <div class="row" style="justify-content:flex-end;gap:8px;margin:8px 0;flex-wrap:wrap">
          ${methodsFilterHtml()}
          ${eyeBtn()}
          <button class="btn primary" id="pdfSeleccion">📄 PDF de selección (contabilidad)</button>
          <button class="btn ghost" id="exportRepDetalle">Exportar planilla Excel</button>
          <button class="btn ghost" id="exportRepResumen">Exportar resumen Excel</button>
        </div>
        <p class="hint" id="selCount" style="margin:0 0 6px">Marca las ventas con el chulo de la izquierda para exportarlas a PDF.</p>
        ${planillaTableHtml(reportPlanRows, plan.totals || {}, { searchId: "repSearch", bodyId: "repPlanBody", selectable: true })}
        ${closingExcelBlocks(c, { fupas: range.fupas, expenses: range.expenses, dispersion: range.dispersion, pendientes: range.pendientes })}
        <h3 style="margin-top:18px">Mapa de calor — horas y días pico</h3>
        <div id="heatmapBox" class="hint">Cargando…</div>`;
      // Conteo de seleccionadas (chulos) para el PDF de contabilidad.
      const updateSelCount = () => {
        const n = $("repPlanBody")?.querySelectorAll(".sel-sale:checked").length || 0;
        const lbl = $("selCount");
        if (lbl) lbl.textContent = n ? `${n} venta(s) seleccionada(s) para PDF.` : "Marca las ventas con el chulo de la izquierda para exportarlas a PDF.";
      };
      const wireSelect = (scope) => scope?.querySelectorAll(".sel-sale").forEach((c) => c.addEventListener("change", updateSelCount));
      // Buscador de transacción: filtra la planilla en vivo (conserva chulos + selección).
      const search = $("repSearch");
      if (search) search.addEventListener("input", () => {
        const body = $("repPlanBody");
        if (!body) return;
        const filtered = filterPlanRows(reportPlanRows, search.value);
        body.innerHTML = planillaRowsHtml(filtered, { selectable: true }) || '<tr><td class="hint" colspan="26">Sin coincidencias</td></tr>';
        wireEditSale(body); wireSelect(body); updateSelCount();
        const all = $("selAll"); if (all) all.checked = false;
      });
      wireEditSale($("repPlanBody"));
      wireSelect($("repPlanBody"));
      $("selAll")?.addEventListener("change", (e) => {
        $("repPlanBody")?.querySelectorAll(".sel-sale").forEach((c) => { c.checked = e.target.checked; });
        updateSelCount();
      });
      $("pdfSeleccion")?.addEventListener("click", () => exportSeleccionPdf(from, to));
      $("toggleDecimals")?.addEventListener("click", () => { showDecimals = !showDecimals; loadReport(); });
      wireMethodsFilter(loadReport);
      $("exportRepDetalle")?.addEventListener("click", async () => {
        try { await downloadBlob(await api.exportConsolidadoDetalle(from, to), `consolidado-detallado-${from}_${to}.xlsx`); } catch (e) { toast(e.message); }
      });
      $("exportRepResumen")?.addEventListener("click", async () => {
        try { await downloadBlob(await api.exportConsolidado(from, to), `consolidado-${from}_${to}.xlsx`); } catch (e) { toast(e.message); }
      });
      loadHeatmap(from, to);
    } catch (e) { toast(e.message); }
  }

  // Exporta a PDF (impresión del navegador → "Guardar como PDF") las ventas marcadas,
  // para enviarlas a contabilidad. Documento horizontal con el detalle de cada una.
  function exportSeleccionPdf(from, to) {
    const ids = [...document.querySelectorAll(".sel-sale:checked")].map((c) => Number(c.dataset.selid));
    if (!ids.length) return toast("Marca al menos una venta (chulo de la izquierda) para el PDF");
    const sel = reportPlanRows.filter((r) => ids.includes(r.id));
    const fecha = new Date().toLocaleString("es-CO", { dateStyle: "medium", timeStyle: "short" });
    const cols = [
      ["#", (r, i) => i + 1], ["Fecha", (r) => r.fecha], ["Factura", (r) => r.factura || "-"],
      ["Cliente", (r) => r.cliente], ["Doc", (r) => r.numDoc], ["Placa", (r) => r.placa || ""],
      ["Modelo", (r) => r.modelo || ""], ["N°PIN", (r) => r.pin || ""], ["Total", (r) => money(r.total), 1],
      ["Método", (r) => r.metodoPago || ""], ["Deduc. conv.", (r) => money(r.deduccionesConvenios), 1],
      ["SICOV", (r) => fmtCost(r.sicov), 1], ["IVA SICOV", (r) => fmtCost(r.ivaSicov), 1],
      ["Recaudo", (r) => fmtCost(r.recaudo), 1], ["IVA Rec.", (r) => fmtCost(r.ivaRecaudo), 1],
      ["ANSV", (r) => fmtCost(r.fnsv), 1], ["FUPA", (r) => fmtCost(r.fupa), 1],
      ["Coste trans.", (r) => fmtCost(r.costeTransaccion), 1], ["IVA fact.", (r) => fmtCost(r.ivaFact), 1],
      ["Sustratos", (r) => fmtCost(r.sustratos), 1], ["Costos total", (r) => fmtCost(r.costosTotal), 1]
    ];
    const th = cols.map(([h, , r]) => `<th class="${r ? "r" : ""}">${esc(h)}</th>`).join("");
    const trs = sel.map((row, i) => `<tr>${cols.map(([, fn, r]) => `<td class="${r ? "r" : ""}">${esc(String(fn(row, i)))}</td>`).join("")}</tr>`).join("");
    const tTotal = sel.reduce((a, r) => a + (Number(r.total) || 0), 0);
    const tDed = sel.reduce((a, r) => a + (Number(r.deduccionesConvenios) || 0), 0);
    const tCostos = sel.reduce((a, r) => a + (Number(r.costosTotal) || 0), 0);
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>Reporte contabilidad ${esc(from)} a ${esc(to)}</title>
      <style>
        @page{size:landscape;margin:10mm}
        *{font-family:Arial,Helvetica,sans-serif;box-sizing:border-box}
        body{margin:0;padding:14px;color:#111}
        h1{font-size:16px;margin:0 0 2px} .muted{color:#555;font-size:11px}
        table{width:100%;border-collapse:collapse;margin-top:12px;font-size:10px}
        th,td{border:1px solid #ccc;padding:3px 4px;text-align:left}
        th{background:#ed7d31;color:#fff} td.r,th.r{text-align:right}
        tfoot td{font-weight:bold;background:#fce4d6}
      </style></head><body onload="window.print()">
      <h1>RTM Motos · Girardot — Reporte para contabilidad</h1>
      <div class="muted">Período ${esc(from)} a ${esc(to)} · ${sel.length} venta(s) seleccionada(s) · generado ${esc(fecha)}</div>
      <table><thead><tr>${th}</tr></thead><tbody>${trs}</tbody>
      <tfoot><tr><td colspan="8">TOTALES</td><td class="r">${money(tTotal)}</td><td></td><td class="r">${money(tDed)}</td><td colspan="9"></td><td class="r">${money(tCostos)}</td></tr></tfoot>
      </table></body></html>`;
    const w = window.open("", "_blank", "width=1100,height=800");
    if (!w) return toast("Permite las ventanas emergentes para generar el PDF");
    w.document.write(html); w.document.close(); w.focus();
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
