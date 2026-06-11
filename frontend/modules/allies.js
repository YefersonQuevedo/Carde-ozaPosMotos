import { $, esc, money, readCop, todayIso } from "../utils.js";

export function createAlliesModule(context) {
  const { api, toast } = context;
  async function loadPagoConv() {
    try {
      const { items, totals } = await api.allyPayments();
      $("pagoconvTotals").textContent = `Devengado ${money(totals.accrued)} · Pagado ${money(totals.paid)} · Pendiente ${money(totals.pending)}`;
      $("pagoconvBody").innerHTML = `<table class="data"><thead><tr><th>Convenio</th><th class="r">Devengado</th><th class="r">Pagado</th><th class="r">Pendiente</th></tr></thead><tbody>${items.map((a) => `<tr class="clickable" data-name="${esc(a.allyName)}" data-id="${a.allyId ?? ""}"><td>${esc(a.allyName)}</td><td class="r">${money(a.accrued)}</td><td class="r">${money(a.paid)}</td><td class="r"><b>${money(a.pending)}</b></td></tr>`).join("") || '<tr><td class="hint" colspan="4">Aun no hay comisiones de referidos</td></tr>'
        }</tbody></table>`;
      $("pagoconvBody").querySelectorAll("[data-name]").forEach((tr) => tr.addEventListener("click", () => loadPagoConvDetail(tr.dataset.name, tr.dataset.id || null)));
    } catch (e) { toast(e.message); }
  }
  let currentAlly = { name: null, id: null };
  let currentAllyDetail = null;
  let commissionFilter = "todas"; // todas | pagadas | pendientes

  // Tabla de comisiones devengadas con estado de pago, comprobante y filtro.
  // Las pendientes traen checkbox para seleccionar cuáles se pagan.
  function renderCommissions() {
    const all = (currentAllyDetail?.sales) || [];
    const filtered = all.filter((s) => commissionFilter === "todas" || (commissionFilter === "pagadas" ? s.paid : !s.paid));
    const tab = (key, label) => `<button class="btn ${commissionFilter === key ? "primary" : "ghost"} sm" data-commfilter="${key}">${label}</button>`;
    const rows = filtered.map((s) => {
      const comp = s.paid
        ? (s.voucherPath ? `<a class="link" href="${esc(s.voucherPath)}" target="_blank">comprobante</a>` : (s.paidInvoice ? esc(s.paidInvoice) : "sin archivo"))
        : `<input type="checkbox" class="comm-chk" data-comm="${esc(s.saleNumber)}" data-amt="${s.deduction}" checked />`;
      const estado = s.paid
        ? `<span class="pill ok">Pagada${s.paidDate ? " · " + esc(s.paidDate) : ""}</span>`
        : `<span class="pill danger">Pendiente</span>`;
      return `<tr><td>${esc(s.saleDate)}</td><td>${esc(s.plate || "")}</td><td>${esc(s.clientName)}</td><td>${esc(s.invoiceNumber || s.saleNumber || "")}</td><td>${s.pinAdquirido > 0 ? "Si" : "-"}</td><td class="r">${money(s.deduction)}</td><td>${estado}</td><td>${comp}</td></tr>`;
    }).join("");
    return `
      <div class="row" style="gap:6px;margin-bottom:6px">${tab("todas", "Todas")} ${tab("pendientes", "Pendientes")} ${tab("pagadas", "Pagadas")}
        <span class="hint" style="margin-left:auto">Devengado pendiente: ${money(currentAllyDetail?.accruedPending || 0)} · pagado: ${money(currentAllyDetail?.accruedPaid || 0)}</span></div>
      <table class="data"><thead><tr><th>Fecha</th><th>Placa</th><th>Cliente</th><th>Factura</th><th>RTM</th><th class="r">Comision</th><th>Estado</th><th>Comprobante</th></tr></thead>
      <tbody>${rows || '<tr><td class="hint" colspan="8">Sin comisiones</td></tr>'}</tbody></table>`;
  }

  // Re-pinta solo la sección de comisiones y reengancha sus eventos.
  function refreshCommissions() {
    const box = $("pc_commissions");
    if (!box) return;
    box.innerHTML = renderCommissions();
    box.querySelectorAll("[data-commfilter]").forEach((b) => b.addEventListener("click", () => { commissionFilter = b.dataset.commfilter; refreshCommissions(); }));
    box.querySelectorAll(".comm-chk").forEach((c) => c.addEventListener("change", syncSelectedAmount));
    syncSelectedAmount();
  }

  // Suma de comisiones marcadas -> valor a pagar.
  function syncSelectedAmount() {
    const amtInput = $("pc_amount");
    if (!amtInput) return;
    const checks = document.querySelectorAll(".comm-chk:checked");
    if (!checks.length) return; // si no hay pendientes visibles, deja el valor como está
    let sum = 0;
    checks.forEach((c) => { sum += Number(c.dataset.amt) || 0; });
    amtInput.value = sum;
  }
  function selectedSaleNumbers() {
    return [...document.querySelectorAll(".comm-chk:checked")].map((c) => c.dataset.comm);
  }
  async function loadPagoConvDetail(name, allyId = null) {
    currentAlly = { name, id: allyId ? Number(allyId) : null };
    try {
      const d = await api.allyPaymentDetail(name);
      $("pagoconvName").textContent = name;
      const sales = d.sales.map((s) => `<tr><td>${esc(s.saleDate)}</td><td>${esc(s.plate || "")}</td><td>${esc(s.clientName)}</td><td>${s.pinAdquirido > 0 ? "Si" : "-"}</td><td class="r">${money(s.deduction)}</td></tr>`).join("");
      const pays = d.payments.map((p) => `<tr><td>${esc(p.paidDate)}</td><td>${esc(p.note || "")}</td><td class="r">${money(p.amount)}</td><td><button class="link" data-delpay="${p.id}">eliminar</button></td></tr>`).join("");
      $("pagoconvDetail").innerHTML = `
        <div class="kpis">
          <div class="kpi"><span>Devengado</span><b>${money(d.accrued)}</b></div>
          <div class="kpi"><span>Pagado</span><b>${money(d.paid)}</b></div>
          <div class="kpi"><span>Pendiente</span><b>${money(d.pending)}</b></div>
        </div>
        <h3>Registrar pago</h3>
        <div class="row">
          <input id="pc_amount" type="text" inputmode="numeric" placeholder="Valor" />
          <input id="pc_date" type="date" value="${todayIso()}" />
          <input id="pc_note" placeholder="Nota (opcional)" />
          <button class="btn success" id="pc_save">Pagar</button>
        </div>
        <h3>Historial de pagos</h3>
        <table class="data"><thead><tr><th>Fecha</th><th>Nota</th><th class="r">Valor</th><th></th></tr></thead><tbody>${pays || '<tr><td class="hint" colspan="4">Sin pagos registrados</td></tr>'}</tbody></table>
        <h3>Comisiones devengadas (${d.sales.length})</h3>
        <table class="data"><thead><tr><th>Fecha</th><th>Placa</th><th>Cliente</th><th>RTM</th><th class="r">Comision</th></tr></thead><tbody>${sales || '<tr><td class="hint" colspan="5">Sin comisiones</td></tr>'}</tbody></table>`;
      $("pc_save").addEventListener("click", () => addPagoConv(name));
      $("pagoconvDetail").querySelectorAll("[data-delpay]").forEach((b) => b.addEventListener("click", () => delPagoConv(Number(b.dataset.delpay), name)));
    } catch (e) { toast(e.message); }
  }
  async function addPagoConv(name) {
    const amount = Number(String($("pc_amount").value).replace(/[^\d]/g, "")) || 0;
    if (amount <= 0) return toast("Ingresa un valor");
    try {
      await api.addAllyPayment({ allyName: name, allyId: currentAlly.id, amount, paidDate: $("pc_date").value || todayIso(), note: $("pc_note").value.trim() });
      toast("Pago registrado");
      await loadPagoConvDetail(name);
      loadPagoConv();
    } catch (e) { toast(e.message); }
  }
  async function delPagoConv(id, name) {
    if (!confirm("¿Eliminar este pago?")) return;
    try { await api.deleteAllyPayment(id); toast("Pago eliminado"); await loadPagoConvDetail(name); loadPagoConv(); }
    catch (e) { toast(e.message); }
  }

  // Implementacion extendida de pagos a convenios (revision 2026-06-04).
  loadPagoConv = async function () {
    try {
      const { items, totals } = await api.allyPayments();
      $("pagoconvTotals").textContent = `Devengado ${money(totals.accrued)} · Pagado ${money(totals.paid)} · Pendiente ${money(totals.pending)}`;
      $("pagoconvBody").innerHTML = `<table class="data"><thead><tr><th>Convenio</th><th class="r">RTM</th><th class="r">Placas</th><th class="r">Devengado</th><th class="r">Pagado</th><th class="r">Pendiente</th></tr></thead><tbody>${items.map((a) => `<tr class="clickable" data-name="${esc(a.allyName)}" data-id="${a.allyId ?? ""}"><td>${esc(a.allyName)}</td><td class="r">${a.convenioCount || a.rtm || 0}</td><td class="r">${a.plateCount || 0}</td><td class="r">${money(a.accrued)}</td><td class="r">${money(a.paid)}</td><td class="r"><b>${money(a.pending)}</b></td></tr>`).join("") || '<tr><td class="hint" colspan="6">Aun no hay comisiones de referidos</td></tr>'
        }</tbody></table>`;
      $("pagoconvBody").querySelectorAll("[data-name]").forEach((tr) => tr.addEventListener("click", () => loadPagoConvDetail(tr.dataset.name, tr.dataset.id || null)));
    } catch (e) { toast(e.message); }
  };

  loadPagoConvDetail = async function (name, allyId = null) {
    currentAlly = { name, id: allyId ? Number(allyId) : null };
    try {
      const d = await api.allyPaymentDetail(name);
      currentAllyDetail = d;
      commissionFilter = "todas";
      $("pagoconvName").textContent = name;
      const plates = d.plates || [];
      const allyDoc = d.ally?.docNumber || d.ally?.holderDoc || "";
      const pays = d.payments.map((p) => {
        const payPlates = Array.isArray(p.plates) ? p.plates : [];
        const voucher = p.voucherPath ? `<a class="link" href="${esc(p.voucherPath)}" target="_blank">ver</a>` : "-";
        return `<tr><td>${esc(p.paidDate)}</td><td>${esc(p.invoiceNumber || "-")}</td><td>${voucher}</td><td class="r">${p.convenioCount || payPlates.length || 0}</td><td class="r">${money(p.amount)}</td><td>${esc(p.note || "")}</td><td><button class="link" data-printpay="${p.id}">imprimir</button> <button class="link" data-delpay="${p.id}">eliminar</button></td></tr>`;
      }).join("");
      $("pagoconvDetail").innerHTML = `
        <div class="kpis">
          <div class="kpi"><span>Devengado</span><b>${money(d.accrued)}</b></div>
          <div class="kpi"><span>Pagado</span><b>${money(d.paid)}</b></div>
          <div class="kpi"><span>Pendiente</span><b>${money(d.pending)}</b></div>
          <div class="kpi"><span>RTM / placas</span><b>${d.convenioCount || 0} / ${plates.length}</b></div>
        </div>
        <h3>Registrar pago</h3>
        ${d.pending <= 0 ? '<p class="warn-msg">✓ Este convenio no tiene saldo pendiente — no hay nada que pagar.</p>' : ''}
        <div class="form-grid">
          <label class="fld">Valor a pagar<input id="pc_amount" type="text" inputmode="numeric" value="${Math.max(0, d.pending || 0)}" data-max-pending="${d.pending || 0}" ${d.pending <= 0 ? 'disabled' : ''} /></label>
          <label class="fld">Fecha<input id="pc_date" type="date" value="${todayIso()}" ${d.pending <= 0 ? 'disabled' : ''} /></label>
          <label class="fld">Factura / soporte externo<input id="pc_invoice" placeholder="Opcional" ${d.pending <= 0 ? 'disabled' : ''} /></label>
          <label class="fld">Documento para facturar<input id="pc_invoice_doc" value="${esc(allyDoc)}" ${d.pending <= 0 ? 'disabled' : ''} /></label>
          <label class="fld">Comprobante<input id="pc_voucher" type="file" accept="image/*,.pdf" ${d.pending <= 0 ? 'disabled' : ''} /></label>
          <label class="fld">Nota<input id="pc_note" placeholder="Nota (opcional)" ${d.pending <= 0 ? 'disabled' : ''} /></label>
        </div>
        <div class="row form-checks">
          <label class="chk"><input type="checkbox" id="pc_manual_invoice" ${d.pending <= 0 ? 'disabled' : ''} /> Facturar a la cedula/NIT</label>
          <label class="chk"><input type="checkbox" id="pc_send_prov" checked ${d.pending <= 0 ? 'disabled' : ''} /> Enviar a PROV_CONV</label>
        </div>
        <div class="row form-actions">
          <button class="btn success" id="pc_save" ${d.pending <= 0 ? 'disabled title="Sin saldo pendiente"' : ''}>Pagar</button>
          <button class="btn" id="pc_print_pending">Imprimir soporte</button>
        </div>
        <p class="hint">Placas incluidas: ${plates.map(esc).join(", ") || "sin placas"}</p>
        <h3>Historial de pagos</h3>
        <table class="data"><thead><tr><th>Fecha</th><th>Factura</th><th>Comprobante</th><th class="r">RTM</th><th class="r">Valor</th><th>Nota</th><th></th></tr></thead><tbody>${pays || '<tr><td class="hint" colspan="7">Sin pagos registrados</td></tr>'}</tbody></table>
        <h3>Comisiones pendientes y pagadas (${d.sales.length})</h3>
        <div id="pc_commissions"></div>`;
      refreshCommissions();
      $("pc_save").addEventListener("click", () => addPagoConv(name));
      $("pc_print_pending").addEventListener("click", () => printPagoConvProof(d));
      $("pagoconvDetail").querySelectorAll("[data-delpay]").forEach((b) => b.addEventListener("click", () => delPagoConv(Number(b.dataset.delpay), name)));
      $("pagoconvDetail").querySelectorAll("[data-printpay]").forEach((b) => b.addEventListener("click", () => {
        const payment = d.payments.find((p) => p.id === Number(b.dataset.printpay));
        printPagoConvProof(d, payment);
      }));
    } catch (e) { toast(e.message); }
  };

  addPagoConv = async function (name) {
    const amount = readCop("pc_amount");
    if (amount <= 0) return toast("Ingresa un valor");
    const maxPending = Number($("pc_amount")?.dataset?.maxPending || 0);
    if (maxPending > 0 && amount > maxPending) return toast(`El valor ($${amount.toLocaleString('es-CO')}) supera el saldo pendiente ($${maxPending.toLocaleString('es-CO')})`);
    try {
      let voucherPath = null;
      const file = $("pc_voucher")?.files?.[0];
      if (file) {
        const uploaded = await api.uploadFile(file);
        voucherPath = uploaded.url || uploaded.path;
      }
      const detail = currentAllyDetail || {};
      await api.addAllyPayment({
        allyName: name,
        allyId: currentAlly.id,
        amount,
        paidDate: $("pc_date").value || todayIso(),
        note: $("pc_note").value.trim(),
        voucherPath,
        invoiceNumber: $("pc_invoice").value.trim(),
        manualInvoice: $("pc_manual_invoice").checked,
        invoiceDoc: $("pc_invoice_doc").value.trim(),
        invoiceName: detail.ally?.name || name,
        plates: detail.plates || [],
        convenioCount: detail.convenioCount || 0,
        saleNumbers: selectedSaleNumbers(),
        sendToProvision: $("pc_send_prov").checked
      });
      toast("Pago registrado");
      await loadPagoConvDetail(name);
      loadPagoConv();
    } catch (e) { toast(e.message); }
  };

  function printPagoConvProof(detail, payment = null) {
    const amount = payment?.amount ?? readCop("pc_amount") ?? detail.pending ?? 0;
    const invoice = payment?.invoiceNumber || $("pc_invoice")?.value || "-";
    const plates = payment?.plates?.length ? payment.plates : (detail.plates || []);
    const rows = (detail.sales || [])
      .filter((s) => !plates.length || plates.includes(s.plate))
      .map((s) => `<tr><td>${esc(s.plate || "")}</td><td>${esc(s.clientName)}</td><td>${esc(s.invoiceNumber || s.saleNumber || "")}</td><td style="text-align:right">${money(s.deduction)}</td></tr>`)
      .join("");
    const html = `<!doctype html><html><head><title>Comprobante convenio</title>
      <style>body{font-family:Arial,sans-serif;padding:28px;color:#111}h1{font-size:18px;margin:0 0 4px}.muted{color:#555;font-size:12px}table{width:100%;border-collapse:collapse;margin-top:18px}th,td{border-bottom:1px solid #ddd;padding:8px;text-align:left}th{font-size:11px;text-transform:uppercase}.total{font-size:18px;font-weight:700;text-align:right;margin-top:16px}.sign{margin-top:70px;border-top:1px solid #111;width:280px;text-align:center;padding-top:8px}</style>
      </head><body>
      <h1>Comprobante de pago a convenio</h1>
      <div class="muted">Fecha: ${esc(payment?.paidDate || $("pc_date")?.value || todayIso())}</div>
      <p><b>Convenio:</b> ${esc(detail.allyName)}<br><b>Factura/soporte:</b> ${esc(invoice)}<br><b>Placas:</b> ${plates.map(esc).join(", ") || "-"}</p>
      <table><thead><tr><th>Placa</th><th>Cliente</th><th>Factura</th><th>Comision</th></tr></thead><tbody>${rows || "<tr><td colspan='4'>Sin detalle de placas</td></tr>"}</tbody></table>
      <div class="total">Valor pagado: ${money(amount)}</div>
      <div class="sign">Firma recibido</div>
      </body></html>`;
    const w = window.open("", "_blank", "width=760,height=900");
    if (!w) return toast("El navegador bloqueo la ventana de impresion");
    w.document.write(html);
    w.document.close();
    w.focus();
    w.print();
  }

  async function loadConvenios(q = "") {
    try {
      const items = await api.findAllies(q);
      $("conveniosBody").innerHTML = `
        <div class="row filters">
          <input id="allyBulkCommission" type="text" inputmode="numeric" placeholder="Nueva comision para todos" />
          <button class="btn" id="allyBulkApply">Aplicar a todos</button>
        </div>
        <table class="data"><thead><tr><th>Nombre</th><th>Contacto</th><th>Empresa</th><th class="r">Comision</th><th>Inscrito</th></tr></thead><tbody>${items.map((a) => `<tr class="clickable" data-ally='${esc(JSON.stringify(a))}'><td>${esc(a.name)}</td><td>${esc(a.contactPhone || "")}</td><td>${esc(a.company || "")}</td><td class="r">${money(a.commission)}</td><td>${a.enrolled ? "Si" : "-"}</td></tr>`).join("") || '<tr><td class="hint" colspan="5">Sin convenios</td></tr>'
        }</tbody></table>`;
      $("allyBulkApply").addEventListener("click", applyAlliesCommissionUI);
      $("conveniosBody").querySelectorAll("[data-ally]").forEach((tr) => tr.addEventListener("click", () => renderAllyForm(JSON.parse(tr.dataset.ally))));
    } catch (e) { toast(e.message); }
  }

  async function applyAlliesCommissionUI() {
    const commission = readCop("allyBulkCommission");
    if (commission <= 0) return toast("Ingresa la nueva comision");
    if (!confirm(`Aplicar ${money(commission)} a todos los convenios activos?`)) return;
    try {
      const r = await api.applyAlliesCommission(commission);
      toast(`Comision aplicada a ${r.count} convenios`);
      await loadConvenios($("allySearch").value || "");
    } catch (e) { toast(e.message); }
  }
  const ALLY_FIELDS = [
    ["name", "Nombre completo", "text"],
    ["company", "Empresa", "text"],
    ["contactPhone", "Telefono", "text"],
    ["altPhone", "Telefono alterno", "text"],
    ["docType", "Tipo documento", "text"],
    ["docNumber", "Numero documento", "text"],
    ["paymentMethod", "Metodo de pago", "text"],
    ["accountNumber", "Numero de cuenta", "text"],
    ["holderDocType", "Tipo doc titular", "text"],
    ["holderDoc", "Documento titular", "text"],
    ["address", "Direccion", "text"],
    ["commission", "Comision", "number"]
  ];
  function renderAllyForm(a) {
    const ally = a || { commission: 40000, enrolled: false, isDirectUser: false, active: true };
    $("allyFormTitle").textContent = a ? `Editar: ${a.name}` : "Nuevo convenio";
    const fields = ALLY_FIELDS.map(([k, label, type]) =>
      `<label class="fld">${label}<input id="af_${k}" type="${type}" value="${esc(ally[k] ?? "")}" /></label>`
    ).join("");
    $("allyForm").innerHTML = `
      <div class="form-grid">${fields}</div>
      <label class="fld">Observacion<textarea id="af_observation">${esc(ally.observation ?? "")}</textarea></label>
      <label class="fld">Notas<textarea id="af_notes">${esc(ally.notes ?? "")}</textarea></label>
      <div class="row form-checks">
        <label class="chk"><input type="checkbox" id="af_enrolled" ${ally.enrolled ? "checked" : ""} /> Inscrito</label>
        <label class="chk"><input type="checkbox" id="af_isDirectUser" ${ally.isDirectUser ? "checked" : ""} /> Usuario directo</label>
        <label class="chk"><input type="checkbox" id="af_active" ${ally.active !== false ? "checked" : ""} /> Activo</label>
      </div>
      <div class="row form-actions">
        <button class="btn success" id="allySave">${a ? "Guardar cambios" : "Crear convenio"}</button>
        ${a ? `<button class="btn danger" id="allyDelete">Eliminar</button>` : ""}
      </div>`;
    $("allySave").addEventListener("click", () => saveAlly(a?.id));
    if (a) $("allyDelete").addEventListener("click", () => deleteAlly(a.id, a.name));
  }
  function readAllyForm() {
    const body = {};
    ALLY_FIELDS.forEach(([k, , type]) => {
      const v = $(`af_${k}`).value.trim();
      body[k] = type === "number" ? Number(v) || 0 : v;
    });
    body.observation = $("af_observation").value.trim();
    body.notes = $("af_notes").value.trim();
    body.enrolled = $("af_enrolled").checked;
    body.isDirectUser = $("af_isDirectUser").checked;
    body.active = $("af_active").checked;
    return body;
  }
  async function saveAlly(id) {
    const body = readAllyForm();
    if (!body.name) return toast("El nombre es obligatorio");
    try {
      const saved = id ? await api.updateAlly(id, body) : await api.saveAlly(body);
      toast(id ? "Convenio actualizado" : "Convenio creado");
      await loadConvenios($("allySearch").value || "");
      renderAllyForm(saved);
    } catch (e) { toast(e.message); }
  }
  async function deleteAlly(id, name) {
    if (!confirm(`¿Eliminar el convenio "${name}"?`)) return;
    try {
      await api.deleteAlly(id);
      toast("Convenio eliminado");
      $("allyForm").innerHTML = `<p class="hint">Selecciona un convenio o crea uno nuevo.</p>`;
      $("allyFormTitle").textContent = "Detalle del convenio";
      await loadConvenios($("allySearch").value || "");
    } catch (e) { toast(e.message); }
  }
  return { loadPagoConv, loadPagoConvDetail, loadConvenios, renderAllyForm };
}
