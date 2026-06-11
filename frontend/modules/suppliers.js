import { $, esc, money, readCop, todayIso, downloadBlob, moduleStub } from "../utils.js";
import { lineRowHtml, wireLineBox, readLineBox } from "./line-items.js";

export function createSuppliersModule(context) {
  const { api, toast } = context;
  let expenseNatures = [];
  function natureOptions(selected = "") {
    return expenseNatures.map((n) => `<option value="${esc(n.code)}" ${n.code === selected ? "selected" : ""}>${esc(n.name)}</option>`).join("");
  }
  function renderProveedores(c) {
    moduleStub(c, { title: "Proveedores / ordenes de compra", owner: "Codex · F2",
      items: ["CRUD de proveedores (Supplier)", "Emitir orden de compra (PurchaseOrder)", "Distinto de convenios/aliados"] });
  }


  let selectedSupplier = null;
  let supplierInvoiceBoxes = [];
  renderProveedores = function (c) {
    if (!c) return;
    c.innerHTML = `<div class="master-detail">
      <div class="card">
        <div class="card-head"><h2>Proveedores</h2><div class="row"><input id="supSearch" placeholder="Buscar proveedor" /><button class="btn primary" id="supNew">Nuevo</button></div></div>
        <div id="supList"></div>
      </div>
      <div class="card">
        <div class="card-head"><h2 id="supTitle">Proveedor / documentos</h2><div class="row"><button class="btn" id="poExport">Excel OC</button><button class="btn" id="invExport">Excel recibidas</button></div></div>
        <div id="supForm"><p class="hint">Selecciona un proveedor o crea uno nuevo.</p></div>
        <div id="poBox"></div>
        <div id="invBox"></div>
      </div>
    </div>`;
    $("supSearch").addEventListener("input", (e) => loadSuppliers(e.target.value));
    $("supNew").addEventListener("click", () => renderSupplierForm(null));
    $("poExport").addEventListener("click", exportPurchaseOrdersUI);
    $("invExport").addEventListener("click", exportSupplierInvoicesUI);
    loadSuppliers();
    loadPurchaseOrders();
    renderSupplierInvoiceForm();
  };

  async function loadSuppliers(q = "") {
    try {
      const { items } = await api.suppliers(q);
      $("supList").innerHTML = `<table class="data"><thead><tr><th>Proveedor</th><th>Doc</th><th>Telefono</th><th>Activo</th></tr></thead><tbody>${items.map((s) => `<tr class="clickable" data-sup="${encodeURIComponent(JSON.stringify(s))}"><td>${esc(s.name)}</td><td>${esc(s.docType)} ${esc(s.docNumber)}</td><td>${esc(s.phone || "")}</td><td>${s.active ? "Si" : "-"}</td></tr>`).join("") || '<tr><td class="hint" colspan="4">Sin proveedores</td></tr>'}</tbody></table>`;
      $("supList").querySelectorAll("[data-sup]").forEach((tr) => tr.addEventListener("click", () => renderSupplierForm(JSON.parse(decodeURIComponent(tr.dataset.sup)))));
    } catch (e) { toast(e.message); }
  }
  function renderSupplierForm(s) {
    selectedSupplier = s;
    $("supTitle").textContent = s ? `Proveedor: ${s.name}` : "Nuevo proveedor";
    $("supForm").innerHTML = `<div class="form-grid"><label class="fld">Tipo doc<input id="supDocType" value="${esc(s?.docType || "NIT")}" /></label><label class="fld">Documento<input id="supDoc" value="${esc(s?.docNumber || "")}" /></label><label class="fld">Nombre<input id="supName" value="${esc(s?.name || "")}" /></label><label class="fld">Telefono<input id="supPhone" value="${esc(s?.phone || "")}" /></label><label class="fld">Email<input id="supEmail" value="${esc(s?.email || "")}" /></label><label class="fld">Metodo pago<input id="supPay" value="${esc(s?.paymentMethod || "")}" /></label></div><label class="fld">Direccion<input id="supAddress" value="${esc(s?.address || "")}" /></label><div class="row form-actions"><button class="btn success" id="supSave">Guardar proveedor</button>${s ? '<button class="btn danger" id="supDelete">Desactivar</button>' : ""}</div>`;
    $("supSave").addEventListener("click", () => saveSupplierUI(s?.id));
    $("supDelete")?.addEventListener("click", () => deleteSupplierUI(s.id));
    renderPurchaseOrderForm();
    renderSupplierInvoiceForm();
  }
  async function saveSupplierUI(id) {
    const body = { docType: $("supDocType").value.trim(), docNumber: $("supDoc").value.trim(), name: $("supName").value.trim(), phone: $("supPhone").value.trim(), email: $("supEmail").value.trim(), paymentMethod: $("supPay").value.trim(), address: $("supAddress").value.trim() };
    if (!body.docNumber || !body.name) return toast("Documento y nombre obligatorios");
    try {
      const saved = id ? await api.updateSupplier(id, body) : await api.saveSupplier(body);
      toast("Proveedor guardado");
      await loadSuppliers($("supSearch").value || "");
      renderSupplierForm(saved);
    } catch (e) { toast(e.message); }
  }
  async function deleteSupplierUI(id) {
    if (!confirm("Desactivar proveedor?")) return;
    try { await api.deleteSupplier(id); toast("Proveedor desactivado"); loadSuppliers(); }
    catch (e) { toast(e.message); }
  }
  function renderPurchaseOrderForm() {
    if (!selectedSupplier) {
      $("poBox").innerHTML = `<p class="hint">Guarda o selecciona un proveedor para crear ordenes de compra.</p><div id="poList"></div>`;
      loadPurchaseOrders();
      return;
    }
    $("poBox").innerHTML = `<h3>Nueva orden de compra</h3><div class="form-grid"><label class="fld">Fecha<input id="poDate" type="date" value="${todayIso()}" /></label><label class="fld">Concepto<input id="poConcept" /></label></div><label class="fld">Nota<input id="poNote" /></label><div id="poLines">${lineRowHtml("po")}</div><button class="link" id="poAddLine" type="button">+ agregar linea</button><div class="row form-actions"><button class="btn success" id="poSave">Emitir OC</button></div><h3>Ordenes recientes</h3><div id="poList"></div>`;
    wireLineBox("poLines", "po");
    $("poSave").addEventListener("click", savePurchaseOrderUI);
    loadPurchaseOrders(selectedSupplier.id);
  }

  async function renderSupplierInvoiceForm() {
    if (!$("invBox")) return;
    if (!expenseNatures.length || !supplierInvoiceBoxes.length) {
      try {
        const [natureRes, boxRes] = await Promise.all([api.expenseNatures(), api.cashBoxes()]);
        expenseNatures = natureRes.items || [];
        supplierInvoiceBoxes = boxRes.boxes || [];
      } catch {
        expenseNatures = expenseNatures || [];
        supplierInvoiceBoxes = supplierInvoiceBoxes || [];
      }
    }
    if (!selectedSupplier) {
      $("invBox").innerHTML = `<h3>Facturas recibidas</h3><p class="hint">Selecciona un proveedor para registrar una factura recibida. Abajo ves las ultimas facturas de todos los proveedores.</p><div id="invSummary"></div><div id="invList"></div>`;
      loadSupplierInvoices();
      return;
    }
    $("invBox").innerHTML = `<h3>Factura recibida del proveedor</h3>
      <div class="form-grid">
        <label class="fld">Numero factura *<input id="invNumber" /></label>
        <label class="fld">Fecha<input id="invDate" type="date" value="${todayIso()}" /></label>
        <label class="fld">Vence<input id="invDueDate" type="date" /></label>
        <label class="fld">Naturaleza<select id="invNature"><option value="">Sin naturaleza</option>${natureOptions()}</select></label>
        <label class="fld">Base<input id="invBase" inputmode="numeric" placeholder="$" /></label>
        <label class="fld">IVA<input id="invIva" inputmode="numeric" placeholder="$" /></label>
        <label class="fld">Total<input id="invTotal" inputmode="numeric" placeholder="Base + IVA si se deja vacio" /></label>
        <label class="fld">Origen<select id="invSource"><option value="manual">Manual</option><option value="correo">Correo</option><option value="dian">DIAN</option><option value="xml">XML</option><option value="pdf">PDF</option></select></label>
      </div>
      <label class="fld">Concepto<input id="invConcept" placeholder="Ej. contabilidad, papeleria, servicio" /></label>
      <label class="fld">Archivo / comprobante<input id="invFile" type="file" accept=".pdf,image/*" /></label>
      <label class="fld">Nota<input id="invNote" /></label>
      <div class="row form-checks"><label class="chk"><input type="checkbox" id="invDeductible" checked /> IVA descontable</label></div>
      <div class="row form-actions"><button class="btn success" id="invSave">Registrar factura recibida</button></div>
      <h3>Facturas recibidas recientes</h3><div id="invSummary"></div><div id="invList"></div>`;
    $("invSave").addEventListener("click", saveSupplierInvoiceUI);
    loadSupplierInvoices(selectedSupplier.id);
  }

  async function loadSupplierInvoices(supplierId = selectedSupplier?.id) {
    try {
      const params = supplierId ? { supplierId } : {};
      const { items, summary, count } = await api.supplierInvoices(params);
      if ($("invSummary")) {
        $("invSummary").innerHTML = `<div class="kpis">
          <div class="kpi"><span>Facturas</span><b>${count}</b></div>
          <div class="kpi"><span>Total recibido</span><b>${money(summary.total)}</b></div>
          <div class="kpi"><span>Por pagar</span><b>${money(summary.pending)}</b></div>
          <div class="kpi"><span>IVA descontable</span><b>${money(summary.ivaDeductible)}</b></div>
        </div>`;
      }
      if ($("invList")) {
        $("invList").innerHTML = `<table class="data"><thead><tr><th>Fecha</th><th>Proveedor</th><th>Factura</th><th>Naturaleza</th><th class="r">IVA</th><th class="r">Total</th><th class="r">Pend.</th><th>Estado</th><th></th></tr></thead><tbody>${
          items.map((i) => {
            const pending = Math.max(0, i.total - i.paidAmount);
            return `<tr><td>${esc(i.date)}</td><td>${esc(i.supplierName)}</td><td>${esc(i.number)}<br><span class="hint">${esc(i.concept || "")}</span>${i.filePath ? `<br><a class="link" href="${esc(i.filePath)}" target="_blank">archivo</a>` : ""}</td><td>${esc(i.natureCode || "")}</td><td class="r">${money(i.iva)}</td><td class="r">${money(i.total)}</td><td class="r">${money(pending)}</td><td>${esc(i.status)}</td><td>${i.status !== "anulada" && pending > 0 ? `<button class="link" data-payinv="${i.id}" data-pending="${pending}">pagar</button> ` : ""}${i.status !== "anulada" ? `<button class="link" data-voidinv="${i.id}">anular</button>` : ""}</td></tr>`;
          }).join("") || '<tr><td class="hint" colspan="9">Sin facturas recibidas</td></tr>'
        }</tbody></table>`;
        $("invList").querySelectorAll("[data-payinv]").forEach((b) => b.addEventListener("click", () => paySupplierInvoiceUI(Number(b.dataset.payinv), Number(b.dataset.pending))));
        $("invList").querySelectorAll("[data-voidinv]").forEach((b) => b.addEventListener("click", () => voidSupplierInvoiceUI(Number(b.dataset.voidinv))));
      }
    } catch (e) { toast(e.message); }
  }

  async function saveSupplierInvoiceUI() {
    if (!selectedSupplier) return toast("Selecciona proveedor");
    const base = readCop("invBase");
    const iva = readCop("invIva");
    const total = readCop("invTotal") || base + iva;
    const body = {
      supplierId: selectedSupplier.id,
      supplierName: selectedSupplier.name,
      supplierDoc: selectedSupplier.docNumber,
      number: $("invNumber").value.trim(),
      date: $("invDate").value || todayIso(),
      dueDate: $("invDueDate").value || null,
      concept: $("invConcept").value.trim(),
      natureCode: $("invNature").value,
      base,
      iva,
      total,
      deductible: $("invDeductible").checked,
      source: $("invSource").value,
      note: $("invNote").value.trim()
    };
    if (!body.number) return toast("Numero de factura obligatorio");
    if (body.total <= 0) return toast("Total de factura obligatorio");
    try {
      const file = $("invFile")?.files?.[0];
      if (file) {
        toast("Subiendo archivo...");
        const uploaded = await api.uploadFile(file);
        body.filePath = uploaded.path || uploaded.url;
      }
      await api.createSupplierInvoice(body);
      toast("Factura recibida registrada");
      renderSupplierInvoiceForm();
    } catch (e) { toast(e.message); }
  }

  async function paySupplierInvoiceUI(id, pending) {
    const value = prompt("Valor pagado:", String(pending || ""));
    if (value === null) return;
    const amount = Math.round(Number(String(value).replace(/[^\d]/g, "")) || 0);
    if (amount <= 0) return toast("Ingresa un valor valido");
    if (!supplierInvoiceBoxes.length) {
      try { supplierInvoiceBoxes = (await api.cashBoxes()).boxes || []; } catch { supplierInvoiceBoxes = []; }
    }
    const boxList = supplierInvoiceBoxes.map((b) => b.code).join(", ");
    const boxCode = (prompt(`Caja de donde sale el pago (${boxList || "CAJA_MENOR"}):`, supplierInvoiceBoxes[0]?.code || "CAJA_MENOR") || "").trim();
    if (!boxCode) return toast("Selecciona una caja");
    try {
      await api.paySupplierInvoice(id, { amount, paidDate: todayIso(), boxCode });
      toast("Pago registrado y caja descontada");
      loadSupplierInvoices(selectedSupplier?.id);
    } catch (e) { toast(e.message); }
  }

  async function voidSupplierInvoiceUI(id) {
    if (!confirm("Anular esta factura recibida?")) return;
    try {
      await api.voidSupplierInvoice(id);
      toast("Factura recibida anulada");
      loadSupplierInvoices(selectedSupplier?.id);
    } catch (e) { toast(e.message); }
  }

  async function exportSupplierInvoicesUI() {
    try {
      const blob = await api.exportSupplierInvoices({});
      await downloadBlob(blob, `facturas-recibidas-${todayIso()}.xlsx`);
    } catch (e) { toast(e.message); }
  }
  async function loadPurchaseOrders(supplierId = selectedSupplier?.id) {
    try {
      const { items } = await api.purchaseOrders(supplierId ? { supplierId } : {});
      const box = $("poList");
      if (!box) return;
      box.innerHTML = `<table class="data"><thead><tr><th>Numero</th><th>Fecha</th><th>Proveedor</th><th>Concepto</th><th class="r">IVA</th><th class="r">Total</th><th>Estado</th></tr></thead><tbody>${items.map((o) => `<tr><td>${esc(o.number)}</td><td>${esc(o.date)}</td><td>${esc(o.supplierName)}</td><td>${esc(o.concept || "")}</td><td class="r">${money(o.iva)}</td><td class="r">${money(o.total)}</td><td>${esc(o.status)}</td></tr>`).join("") || '<tr><td class="hint" colspan="7">Sin ordenes</td></tr>'}</tbody></table>`;
    } catch (e) { toast(e.message); }
  }
  async function savePurchaseOrderUI() {
    const lines = readLineBox("po");
    if (!selectedSupplier) return toast("Selecciona proveedor");
    if (!lines.length) return toast("Agrega al menos una linea");
    try {
      const r = await api.createPurchaseOrder({ supplierId: selectedSupplier.id, supplierName: selectedSupplier.name, date: $("poDate").value || todayIso(), concept: $("poConcept").value.trim(), note: $("poNote").value.trim(), lines });
      toast(`OC ${r.order.number} creada`);
      renderPurchaseOrderForm();
    } catch (e) { toast(e.message); }
  }
  async function exportPurchaseOrdersUI() {
    try {
      const blob = await api.exportPurchaseOrders({});
      await downloadBlob(blob, `ordenes-compra-${todayIso()}.xlsx`);
    } catch (e) { toast(e.message); }
  }
  return { renderProveedores };
}
