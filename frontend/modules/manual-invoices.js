import { $, esc, money, todayIso, downloadBlob, moduleStub } from "../utils.js";
import { lineRowHtml, wireLineBox, readLineBox } from "./line-items.js";

export function createManualInvoicesModule(context) {
  const { api, toast } = context;
  function renderFacturaElec(c) {
    moduleStub(c, { title: "Factura electronica manual", owner: "Codex · F1/F3",
      items: ["Factura tipo POS para cualquier item (ej. equipos de pista)", "Conceptos de pago configurables", "ManualInvoice + ManualInvoiceLine"] });
  }
  function renderProveedores(c) {
    moduleStub(c, { title: "Proveedores / ordenes de compra", owner: "Codex · F2",
      items: ["CRUD de proveedores (Supplier)", "Emitir orden de compra (PurchaseOrder)", "Distinto de convenios/aliados"] });
  }


  renderFacturaElec = function (c) {
    if (!c) return;
    const from = $("miFrom")?.value || todayIso().slice(0, 8) + "01";
    const to = $("miTo")?.value || todayIso();
    c.innerHTML = `<div class="master-detail">
      <div class="card">
        <div class="card-head"><h2>Factura electronica manual</h2><button class="btn" id="miExport">Excel</button></div>
        <div class="row filters"><input id="miFrom" type="date" value="${esc(from)}" /><input id="miTo" type="date" value="${esc(to)}" /><input id="miDocFilter" placeholder="Documento" /><button class="btn primary" id="miLoad">Buscar</button></div>
        <div id="miList"></div>
      </div>
      <div class="card">
        <div class="card-head"><h2>Nueva factura manual</h2></div>
        <div class="form-grid">
          <label class="fld">Documento cliente<input id="miClientDoc" /></label>
          <label class="fld">Nombre cliente<input id="miClientName" /></label>
          <label class="fld">Fecha<input id="miDate" type="date" value="${todayIso()}" /></label>
          <label class="fld">Origen<select id="miSource"><option value="manual">Manual</option><option value="venta_equipo">Venta equipo</option><option value="convenio">Convenio</option><option value="otro">Otro</option></select></label>
        </div>
        <label class="fld">Concepto<input id="miConcept" placeholder="Ej. venta de equipos de pista" /></label>
        <div id="miLines">${lineRowHtml("mi")}</div>
        <button class="link" id="miAddLine" type="button">+ agregar linea</button>
        <div class="row form-actions"><button class="btn success" id="miSave">Emitir local</button></div>
      </div>
    </div>`;
    wireLineBox("miLines", "mi");
    $("miLoad").addEventListener("click", loadManualInvoices);
    $("miExport").addEventListener("click", exportManualInvoicesUI);
    $("miSave").addEventListener("click", saveManualInvoiceUI);
    loadManualInvoices();
  };

  async function loadManualInvoices() {
    try {
      const params = { from: $("miFrom").value, to: $("miTo").value, clientDoc: $("miDocFilter").value.trim() };
      const { items } = await api.manualInvoices(params);
      $("miList").innerHTML = `<table class="data"><thead><tr><th>Numero</th><th>Fecha</th><th>Cliente</th><th>Concepto</th><th class="r">IVA</th><th class="r">Total</th><th>Estado</th><th></th></tr></thead><tbody>${items.map((i) => `<tr><td>${esc(i.number)}</td><td>${esc(i.date)}</td><td>${esc(i.clientName)}<br><span class="hint">${esc(i.clientDoc)}</span></td><td>${esc(i.concept || "")}</td><td class="r">${money(i.iva)}</td><td class="r">${money(i.total)}</td><td>${esc(i.status)}</td><td>${i.status === "activa" ? `<button class="link" data-voidmi="${i.id}">anular</button>` : ""}</td></tr>`).join("") || '<tr><td class="hint" colspan="8">Sin facturas manuales</td></tr>'}</tbody></table>`;
      $("miList").querySelectorAll("[data-voidmi]").forEach((b) => b.addEventListener("click", () => voidManualInvoiceUI(Number(b.dataset.voidmi))));
    } catch (e) { toast(e.message); }
  }
  async function saveManualInvoiceUI() {
    const lines = readLineBox("mi");
    if (!$("miClientDoc").value.trim() || !$("miClientName").value.trim()) return toast("Cliente obligatorio");
    if (!lines.length) return toast("Agrega al menos una linea");
    try {
      const r = await api.createManualInvoice({ clientDoc: $("miClientDoc").value.trim(), clientName: $("miClientName").value.trim(), date: $("miDate").value || todayIso(), source: $("miSource").value, concept: $("miConcept").value.trim(), lines });
      toast(`Factura ${r.invoice.number} creada`);
      renderFacturaElec($("facturaelecRoot"));
    } catch (e) { toast(e.message); }
  }
  async function voidManualInvoiceUI(id) {
    if (!confirm("Anular esta factura manual?")) return;
    try { await api.voidManualInvoice(id); toast("Factura anulada"); loadManualInvoices(); }
    catch (e) { toast(e.message); }
  }
  async function exportManualInvoicesUI() {
    try {
      const blob = await api.exportManualInvoices({ from: $("miFrom").value, to: $("miTo").value, clientDoc: $("miDocFilter").value.trim() });
      await downloadBlob(blob, `facturas-manuales-${todayIso()}.xlsx`);
    } catch (e) { toast(e.message); }
  }
  return { renderFacturaElec };
}
