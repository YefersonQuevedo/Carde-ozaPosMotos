import { $, esc, money, readCop, todayIso, downloadBlob } from "../utils.js";

export function createReceivablesModule(context) {
  const { api, toast } = context;
  async function loadCartera() {
    const prev = {
      provider: $("carteraProvider")?.value || "TODOS",
      status: $("carteraStatus")?.value || "abierta",
      from: $("carteraFrom")?.value || "",
      to: $("carteraTo")?.value || "",
      clientDoc: $("carteraClientDoc")?.value || "",
      invoiceNumber: $("carteraInvoice")?.value || ""
    };
    const params = Object.fromEntries(Object.entries(prev).filter(([, v]) => v !== ""));
    try {
      const { items = [], grouped = [], totals = {}, open = 0 } = await api.receivables(params);
      $("carteraOpen").textContent = `Pendiente: ${money(open)}`;
      $("carteraBody").innerHTML = `
        <div class="row filters">
          <select id="carteraProvider">
            <option value="TODOS" ${prev.provider === "TODOS" ? "selected" : ""}>Todos</option>
            <option value="GORA" ${prev.provider === "GORA" ? "selected" : ""}>GORA</option>
            <option value="ADDI" ${prev.provider === "ADDI" ? "selected" : ""}>ADDI</option>
            <option value="Credito propio" ${prev.provider === "Credito propio" ? "selected" : ""}>Credito propio</option>
          </select>
          <select id="carteraStatus">
            <option value="abierta" ${prev.status === "abierta" ? "selected" : ""}>Abierta</option>
            <option value="pagada" ${prev.status === "pagada" ? "selected" : ""}>Pagada</option>
            <option value="todas" ${prev.status === "todas" ? "selected" : ""}>Todas</option>
          </select>
          <input id="carteraFrom" type="date" value="${esc(prev.from)}" />
          <input id="carteraTo" type="date" value="${esc(prev.to)}" />
          <input id="carteraClientDoc" placeholder="Cedula/NIT" value="${esc(prev.clientDoc)}" />
          <input id="carteraInvoice" placeholder="# factura" value="${esc(prev.invoiceNumber)}" />
          <button class="btn primary" id="carteraFilter">Filtrar</button>
          <button class="btn" id="carteraExport">Excel</button>
        </div>
        <div class="kpis">
          <div class="kpi"><span>Facturado</span><b>${money(totals.amount)}</b></div>
          <div class="kpi"><span>Abonado neto</span><b>${money(totals.paidNet)}</b></div>
          <div class="kpi"><span>ICA + retencion</span><b>${money((totals.ica || 0) + (totals.retefuente || 0))}</b></div>
          <div class="kpi"><span>Pendiente</span><b>${money(totals.pending)}</b></div>
        </div>
        <div class="split">
          <div>
            <h3>Facturas</h3>
            <table class="data">
              <thead><tr><th>Proveedor</th><th># factura</th><th>Cliente</th><th>Doc</th><th>Placa</th><th>Fecha</th><th class="r">Monto</th><th class="r">Pendiente</th><th></th></tr></thead>
              <tbody>${
                items.map((r) => `<tr>
                  <td>${esc(r.provider)}</td><td>${esc(r.invoiceNumber || "-")}</td><td>${esc(r.clientName || "")}</td><td>${esc(r.clientDoc)}</td>
                  <td>${esc(r.plate || "")}</td><td>${esc(r.dueFrom)}</td><td class="r">${money(r.amount)}</td><td class="r"><b>${money(r.pending)}</b></td>
                  <td><button class="link" data-recv="${r.id}">abonar</button></td>
                </tr>`).join("") || '<tr><td class="hint" colspan="9">Sin cartera con esos filtros</td></tr>'
              }</tbody>
            </table>
            <h3>Resumen por proveedor</h3>
            <table class="data">
              <thead><tr><th>Proveedor</th><th class="r">Facturas</th><th class="r">Facturado</th><th class="r">Costo real</th><th class="r">Pendiente</th></tr></thead>
              <tbody>${
                grouped.map((g) => `<tr><td>${esc(g.provider)}</td><td class="r">${g.count}</td><td class="r">${money(g.amount)}</td><td class="r">${money(g.realCost)}</td><td class="r">${money(g.pending)}</td></tr>`).join("") || '<tr><td class="hint" colspan="5">Sin resumen</td></tr>'
              }</tbody>
            </table>
          </div>
          <div class="detail-panel" id="carteraPayPanel"><p class="hint">Selecciona una factura para registrar el pago de Gora/Addi con ICA y retencion.</p></div>
        </div>`;
      $("carteraFilter").addEventListener("click", loadCartera);
      $("carteraExport").addEventListener("click", exportCartera);
      $("carteraBody").querySelectorAll("[data-recv]").forEach((b) => b.addEventListener("click", () => renderReceivablePayment(items.find((r) => r.id === Number(b.dataset.recv)))));
    } catch (e) { toast(e.message); }
  }

  function carteraParams() {
    return Object.fromEntries(Object.entries({
      provider: $("carteraProvider")?.value || "TODOS",
      status: $("carteraStatus")?.value || "abierta",
      from: $("carteraFrom")?.value || "",
      to: $("carteraTo")?.value || "",
      clientDoc: $("carteraClientDoc")?.value || "",
      invoiceNumber: $("carteraInvoice")?.value || ""
    }).filter(([, v]) => v !== ""));
  }

  function renderReceivablePayment(r) {
    if (!r) return;
    const history = (r.payments || []).map((p) => `<tr><td>${esc(p.paidDate)}</td><td class="r">${money(p.amount)}</td><td class="r">${money(p.ica)}</td><td class="r">${money(p.retefuente)}</td><td>${esc(p.note || "")}</td></tr>`).join("");
    $("carteraPayPanel").innerHTML = `
      <h3>${esc(r.provider)} ${esc(r.invoiceNumber || "")}</h3>
      <p class="hint">${esc(r.clientName || r.clientDoc)} · ${esc(r.plate || "sin placa")} · pendiente ${money(r.pending)}</p>
      <div class="form-grid">
        <label class="fld"># factura<input id="recv_invoice" value="${esc(r.invoiceNumber || "")}" /></label>
        <label class="fld">Referencia credito<input id="recv_ref" value="${esc(r.paymentRef || "")}" /></label>
        <label class="fld">Fecha pago<input id="recv_date" type="date" value="${todayIso()}" /></label>
        <label class="fld">Abono neto<input id="recv_amount" inputmode="numeric" value="${Math.max(0, r.pending || 0)}" /></label>
        <label class="fld">ICA<input id="recv_ica" inputmode="numeric" value="0" /></label>
        <label class="fld">Retencion<input id="recv_rete" inputmode="numeric" value="0" /></label>
      </div>
      <label class="fld">Nota<input id="recv_note" placeholder="Comprobante, observacion o ajuste" /></label>
      <div class="row form-actions">
        <button class="btn success" id="recv_save">Registrar abono</button>
        <button class="btn" id="recv_full">Marcar pagada manual</button>
      </div>
      <div class="kpis">
        <div class="kpi"><span>Costo transaccion</span><b>${money(r.transactionCost)}</b></div>
        <div class="kpi"><span>Costo real</span><b>${money(r.realCost)}</b></div>
        <div class="kpi"><span>Neto despues costos</span><b>${money(r.netAfterCosts)}</b></div>
      </div>
      <h3>Abonos</h3>
      <table class="data"><thead><tr><th>Fecha</th><th class="r">Neto</th><th class="r">ICA</th><th class="r">Retencion</th><th>Nota</th></tr></thead><tbody>${history || '<tr><td class="hint" colspan="5">Sin abonos registrados</td></tr>'}</tbody></table>`;
    $("recv_save").addEventListener("click", () => addReceivablePayment(r.id));
    $("recv_full").addEventListener("click", async () => {
      if (!confirm("Marcar esta cartera como pagada sin detalle de abono?")) return;
      try { await api.payReceivable(r.id); toast("Cartera marcada como pagada"); loadCartera(); }
      catch (e) { toast(e.message); }
    });
  }

  async function addReceivablePayment(id) {
    try {
      await api.addReceivablePayment(id, {
        invoiceNumber: $("recv_invoice").value.trim(),
        paymentRef: $("recv_ref").value.trim(),
        paidDate: $("recv_date").value || todayIso(),
        amount: readCop("recv_amount"),
        ica: readCop("recv_ica"),
        retefuente: readCop("recv_rete"),
        note: $("recv_note").value.trim()
      });
      toast("Abono registrado");
      loadCartera();
    } catch (e) { toast(e.message); }
  }

  async function exportCartera() {
    try {
      const blob = await api.exportReceivables(carteraParams());
      await downloadBlob(blob, `cartera-${todayIso()}.xlsx`);
    } catch (e) { toast(e.message); }
  }
  return { loadCartera };
}
