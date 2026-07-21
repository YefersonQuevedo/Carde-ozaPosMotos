import { $, esc, money, downloadBlob, todayIso } from "../utils.js";

export function createSalesListModule(context) {
  const { api, toast } = context;
  let selectedSale = null;
  let allAllies = [];

  // ─── Exportar ───────────────────────────────────────────────────────────────
  async function exportVentasUI() {
    try {
      const date = $("ventasDate").value;
      const blob = await api.exportSales(date ? { date } : {});
      await downloadBlob(blob, `ventas${date ? "-" + date : ""}.xlsx`);
    } catch (e) { toast(e.message); }
  }

  // ─── Cargar lista ────────────────────────────────────────────────────────────
  async function loadVentas() {
    const date = $("ventasDate").value;
    const q = ($("ventasSearch").value || "").trim().toLowerCase();
    try {
      let items = await api.listSales(date ? { date } : {});
      if (q) {
        items = items.filter((s) =>
          (s.clientName || "").toLowerCase().includes(q) ||
          (s.plate || "").toLowerCase().includes(q) ||
          (s.saleNumber || "").toLowerCase().includes(q) ||
          (s.invoiceNumber || "").toLowerCase().includes(q) ||
          (s.allyName || "").toLowerCase().includes(q)
        );
      }
      const activas = items.filter((s) => s.status !== "anulada");
      const total = activas.reduce((s, v) => s + v.total, 0);
      const ivaTot = activas.reduce((s, v) => s + (v.totalIva || 0), 0);
      $("ventasSummary").textContent =
        `${items.length} ventas${date ? " · " + date : " · todas"} · Total ${money(total)} · IVA ${money(ivaTot)}`;

      $("ventasBody").innerHTML = `<div style="overflow-x:auto"><table class="data"><thead><tr>
        <th>Fecha</th><th>Venta</th><th>Factura</th><th>Cliente</th><th>Doc</th>
        <th>Placa</th><th>Modelo</th><th>Tipo</th><th>Convenio</th><th>RTM</th>
        <th>Medios</th><th class="r">Base</th><th class="r">IVA</th><th class="r">Total</th>
        <th>Estado</th><th>Registró</th><th>Imprimir</th></tr></thead><tbody>${items.map((s) => {
        const anulada = s.status === "anulada";
        return `<tr
            class="clickable"
            style="${anulada ? "opacity:.55" : ""}"
            data-id="${s.id}">
            <td>${esc(s.saleDate)}</td>
            <td>${esc(s.saleNumber)}</td>
            <td>${esc(s.invoiceNumber || "-")}</td>
            <td>${esc(s.clientName)}</td>
            <td class="hint">${esc(s.clientDoc)}</td>
            <td>${esc(s.plate || "")}</td>
            <td>${s.modelYear || ""}</td>
            <td>${esc(s.allyType)}</td>
            <td>${esc(s.allyName || "")}</td>
            <td>${esc(s.rtmStatus)}</td>
            <td class="hint" style="font-size:11px">${esc(s.methods || "")}</td>
            <td class="r">${money(s.totalBase)}</td>
            <td class="r">${money(s.totalIva)}</td>
            <td class="r"><b>${money(s.total)}</b></td>
            <td><span class="pill ${anulada ? "danger" : "ok"}">${anulada ? "anulada" : "activa"}</span></td>
            <td class="hint" style="font-size:11px">${esc(s.createdBy || "")}${s.updatedBy ? `<br>✎ ${esc(s.updatedBy)}` : ""}</td>
            <td><button class="link" data-print="${s.id}" title="Reimprimir ${esc(s.invoiceNumber || s.saleNumber)}">🖨️ ${esc(s.invoiceNumber ? "factura" : "venta")}</button></td>
          </tr>`;
      }).join("") || '<tr><td class="hint" colspan="17">Sin ventas</td></tr>'
        }</tbody></table></div>`;

      $("ventasBody").querySelectorAll("[data-id]").forEach((tr) => {
        const sale = items.find((s) => s.id === Number(tr.dataset.id));
        if (sale) {
          tr.addEventListener("click", () => openDetail(sale));
        }
      });
      // Reimprimir cualquier venta (VTA o factura), incluso anuladas. stopPropagation
      // para que el clic en el boton no abra el panel de edicion de la fila.
      $("ventasBody").querySelectorAll("[data-print]").forEach((b) => b.addEventListener("click", (e) => {
        e.stopPropagation();
        printSale(Number(b.dataset.print));
      }));
    } catch (e) { toast(e.message); }
  }

  // ─── Reimprimir comprobante / factura de una venta ya hecha ──────────────────
  async function printSale(id) {
    try {
      const { sale: s, lines } = await api.getSale(id);
      if (!s) return toast("Venta no encontrada");
      printSaleDoc(s, lines || []);
    } catch (e) { toast(e.message); }
  }

  // Misma plantilla del comprobante del asistente de venta. Si la venta esta facturada
  // muestra "Factura"; si no, "Comprobante de venta (documento interno)".
  function printSaleDoc(s, lines) {
    const facturada = s.dianStatus === "facturada";
    const rows = (lines || []).map((l) => `<tr><td>${esc(l.description)}</td><td class="c">${l.quantity || 1}</td><td class="r">${money(l.unitPrice)}</td><td class="r">${money(l.total)}</td></tr>`).join("");
    const fecha = new Date().toLocaleString("es-CO", { dateStyle: "medium", timeStyle: "short" });
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>${facturada && s.invoiceNumber ? "Factura " + esc(s.invoiceNumber) : "Venta " + esc(s.saleNumber)}</title>
      <style>
        *{font-family:Arial,Helvetica,sans-serif;box-sizing:border-box}
        body{margin:0;padding:16px;color:#111}
        .doc{max-width:520px;margin:0 auto}
        h1{font-size:18px;margin:0}
        .muted{color:#555;font-size:12px}
        .head{border-bottom:2px solid #111;padding-bottom:8px;margin-bottom:10px}
        .grid{display:flex;justify-content:space-between;font-size:13px;margin:2px 0}
        table{width:100%;border-collapse:collapse;margin-top:10px;font-size:13px}
        th,td{padding:6px 4px;border-bottom:1px solid #ddd;text-align:left}
        th{border-bottom:1px solid #111}
        td.r,th.r{text-align:right} td.c,th.c{text-align:center}
        .tot{display:flex;justify-content:space-between;font-size:14px;margin:3px 0}
        .tot.big{font-weight:bold;font-size:16px;border-top:2px solid #111;padding-top:6px;margin-top:6px}
        .foot{margin-top:18px;font-size:11px;color:#666;text-align:center}
        .copy{margin-top:6px;font-size:10px;color:#999;text-align:center}
        @media print{body{padding:0}}
      </style></head>
      <body onload="window.print()">
        <div class="doc">
          <div class="head">
            <h1>RTM Motos · Girardot</h1>
            <div class="muted">Revisión Tecnomecánica</div>
            <div class="muted">${facturada && s.invoiceNumber ? "Factura " + esc(s.invoiceNumber) : "Comprobante de venta (documento interno)"} · ${esc(s.saleNumber)}</div>
          </div>
          <div class="grid"><span>Fecha venta</span><b>${esc(s.saleDate)}${s.saleTime ? " " + esc(s.saleTime) : ""}</b></div>
          <div class="grid"><span>Cliente</span><b>${esc(s.clientName)}</b></div>
          <div class="grid"><span>Documento</span><b>${esc(s.clientDoc || "")}</b></div>
          ${s.plate ? `<div class="grid"><span>Placa / modelo</span><b>${esc(s.plate)}${s.modelYear ? " · " + s.modelYear : ""}</b></div>` : ""}
          <table>
            <thead><tr><th>Concepto</th><th class="c">Cant.</th><th class="r">V. unit.</th><th class="r">Total</th></tr></thead>
            <tbody>${rows || '<tr><td colspan="4">—</td></tr>'}</tbody>
          </table>
          <div style="margin-top:10px">
            <div class="tot"><span>Base</span><span>${money(s.totalBase)}</span></div>
            <div class="tot"><span>IVA</span><span>${money(s.totalIva)}</span></div>
            <div class="tot big"><span>Total</span><span>${money(s.total)}</span></div>
          </div>
          ${s.pinNumber ? `<div class="muted" style="margin-top:10px">PIN RUNT: ${esc(s.pinNumber)}</div>` : ""}
          <div class="foot">Gracias por su visita</div>
          <div class="copy">Reimpresión · ${esc(fecha)}${s.status === "anulada" ? " · VENTA ANULADA" : ""}</div>
        </div>
      </body></html>`;
    const w = window.open("", "_blank", "width=560,height=720");
    if (!w) { toast("Permite las ventanas emergentes para imprimir"); return; }
    w.document.write(html);
    w.document.close();
    w.focus();
  }

  // Abre el panel de edición por id (lo usa el cierre diario para corregir rápido).
  async function openSaleById(id) {
    try {
      const { sale } = await api.getSale(Number(id));
      if (!sale) return toast("Venta no encontrada");
      await openDetail(sale);
      document.getElementById("ventasDetailBody")?.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (e) { toast(e.message); }
  }

  // ─── Panel de detalle / edición ──────────────────────────────────────────────
  async function openDetail(sale) {
    selectedSale = sale;
    $("ventasDetailTitle").textContent = `${sale.saleNumber}`;

    // Cargar aliados para el dropdown
    try { allAllies = await api.findAllies(""); } catch (_) { allAllies = []; }

    const isAdmin = api.currentUser()?.role === "admin";
    const anulada = sale.status === "anulada";
    // Si la venta es directa (usuario), el convenio se muestra como USUARIO aunque tenga
    // un allyName viejo pegado (dato inconsistente): así el panel queda coherente.
    const isDirecto = sale.allyType === "usuario";
    const allyOptions = [
      `<option value="USUARIO" ${isDirecto || sale.allyName === "USUARIO" ? "selected" : ""}>— USUARIO (cliente directo) —</option>`,
      ...allAllies.map((a) =>
        `<option value="${esc(a.name)}" ${!isDirecto && a.name === sale.allyName ? "selected" : ""}>${esc(a.name)}</option>`)
    ].join("");

    $("ventasDetailBody").innerHTML = `
      <div class="detail-meta" style="margin-bottom:14px">
        <b>${esc(sale.clientName)}</b> &nbsp;·&nbsp; Doc: ${esc(sale.clientDoc)}
        &nbsp;·&nbsp; 📅 ${esc(sale.saleDate)}&nbsp;·&nbsp;
        💰 <b>${money(sale.total)}</b>
        ${sale.invoiceNumber ? `&nbsp;·&nbsp; Fac: ${esc(sale.invoiceNumber)}` : ""}
      </div>

      <div class="form-grid">
        ${isAdmin ? `<label class="fld">Fecha de la venta <span class="hint">(solo admin · reajusta el cierre)</span>
          <input id="ve_saleDate" type="date" value="${esc(sale.saleDate)}" max="${todayIso()}" />
        </label>` : ""}
        <label class="fld">Nombre cliente
          <input id="ve_clientName" value="${esc(sale.clientName)}" />
        </label>
        <label class="fld">Placa
          <input id="ve_plate" value="${esc(sale.plate || "")}" placeholder="AAA00A" />
        </label>
        <label class="fld">Año modelo
          <input id="ve_modelYear" type="number" min="1900" max="2030" value="${sale.modelYear || ""}" />
        </label>
        <label class="fld">Nº Factura (corrección)
          <input id="ve_invoiceNumber" value="${esc(sale.invoiceNumber || "")}" placeholder="PCDA-0000" />
        </label>
        <label class="fld" style="grid-column:1/-1">Convenio / Referido <span class="hint">(elige USUARIO para quitar el referido)</span>
          <select id="ve_allyName">${allyOptions}</select>
        </label>
        <label class="fld">Tipo
          <select id="ve_allyType">
            <option value="usuario" ${sale.allyType === "usuario" ? "selected" : ""}>directo (usuario)</option>
            <option value="referido" ${sale.allyType === "referido" ? "selected" : ""}>referido</option>
          </select>
        </label>
        <label class="chk" style="align-self:end"><input type="checkbox" id="ve_discount" ${sale.discountApplied ? "checked" : ""} /> Aplica comisión / descuento</label>
        <label class="fld">Responsable
          <input id="ve_responsable" value="${esc(sale.responsable || "")}" placeholder="Nombre del responsable" />
        </label>
        <label class="fld" style="grid-column:1/-1">Observaciones
          <input id="ve_observaciones" value="${esc(sale.observaciones || "")}" placeholder="Notas adicionales" />
        </label>
      </div>

      ${anulada ? `<div class="pill danger" style="margin-top:12px;display:block">⛔ Esta venta está <b>ANULADA</b>. Para volver a dejarla activa usa "Reactivar". Mientras esté anulada no se puede editar.</div>` : ""}
      <div class="row form-actions" style="margin-top:16px;flex-wrap:wrap;gap:8px">
        ${anulada
          ? `<button class="btn success" id="ve_reactivate">♻️ Reactivar venta</button>
             <button class="btn primary" id="ve_print">🖨️ Reimprimir</button>
             ${isAdmin ? `<button class="btn danger" id="ve_delete">🗑️ Eliminar</button>` : ""}`
          : `<button class="btn success" id="ve_save">💾 Guardar cambios</button>
             <button class="btn primary" id="ve_print">🖨️ Reimprimir</button>
             ${isAdmin ? `<button class="btn" id="ve_recompute">🧮 Recalcular (pago/paquete/PIN)</button>` : ""}
             <button class="btn" id="ve_void">⛔ Anular venta</button>
             ${isAdmin ? `<button class="btn danger" id="ve_delete">🗑️ Eliminar</button>` : ""}`}
      </div>

      ${!anulada && isAdmin ? `<div id="ve_recomputeBox" style="margin-top:12px"></div>` : ""}

      <div class="hint" style="margin-top:10px">
        PIN: <b>${esc(sale.pinNumber || "-")}</b> &nbsp;·&nbsp;
        RTM: ${esc(sale.rtmStatus)} &nbsp;·&nbsp;
        Estado DIAN: ${esc(sale.dianStatus || "-")}
      </div>`;

    // Sincronía instantánea convenio ⟺ tipo:
    //  - elegir USUARIO → tipo directo; elegir un convenio → tipo referido.
    //  - poner tipo directo → el convenio se vacía a USUARIO automáticamente.
    $("ve_allyName")?.addEventListener("change", (e) => {
      $("ve_allyType").value = e.target.value === "USUARIO" ? "usuario" : "referido";
    });
    $("ve_allyType")?.addEventListener("change", (e) => {
      if (e.target.value === "usuario") $("ve_allyName").value = "USUARIO";
    });
    $("ve_save")?.addEventListener("click", saveSale);
    $("ve_print")?.addEventListener("click", () => printSale(sale.id));
    $("ve_void")?.addEventListener("click", () => voidSaleUI(sale.id));
    $("ve_reactivate")?.addEventListener("click", () => reactivateSaleUI(sale.id));
    $("ve_recompute")?.addEventListener("click", () => openRecompute(sale.id));
    $("ve_delete")?.addEventListener("click", () => deleteSaleUI(sale.id));
  }

  // ─── Recalcular venta (método de pago / paquete / PIN / RTM) ──────────────────
  let recomputeCatalog = null;
  async function ensureRecomputeCatalog() {
    if (!recomputeCatalog) recomputeCatalog = await api.catalog();
    return recomputeCatalog;
  }
  function paymentRowHtml(methods, sel = {}) {
    const opts = methods.map((m) => `<option value="${esc(m.code)}" ${m.code === sel.methodCode ? "selected" : ""}>${esc(m.name)}</option>`).join("");
    return `<div class="row rc-payrow" style="gap:8px;margin-bottom:6px">
      <select class="rc-method" style="flex:2 1 180px">${opts}</select>
      <input class="rc-amount" inputmode="numeric" value="${sel.amount ?? ""}" placeholder="$" style="flex:1 1 120px" />
      <button type="button" class="link rc-delrow" style="color:#b72c35">quitar</button>
    </div>`;
  }
  async function openRecompute(id) {
    const box = $("ve_recomputeBox");
    if (!box) return;
    if (box.dataset.open === "1") { box.innerHTML = ""; box.dataset.open = ""; return; }
    box.dataset.open = "1";
    box.innerHTML = `<p class="hint">Cargando…</p>`;
    try {
      const [cat, detail] = await Promise.all([ensureRecomputeCatalog(), api.getSale(id)]);
      const sale = detail.sale;
      const payments = detail.payments || [];
      const methods = cat.paymentMethods || cat.methods || [];
      const packages = cat.packages || [];
      const pkgOpts = `<option value="">— sin paquete —</option>` + packages.map((p) => `<option value="${esc(p.code)}" ${p.code === sale.packageCode ? "selected" : ""}>${esc(p.name)} (${esc(p.code)})</option>`).join("");
      const payRows = (payments.length ? payments : [{ methodCode: "", amount: "" }]).map((p) => paymentRowHtml(methods, p)).join("");
      box.innerHTML = `
        <div class="card" style="border:1px solid #f0c9ae;padding:12px">
          <h3 style="margin:0 0 8px">🧮 Recalcular venta</h3>
          <p class="hint" style="margin:0 0 10px">Cambia método(s) de pago, paquete, PIN o si la RTM se realiza hoy. Recalcula costos, provisión, cartera, factura y cierre. Mantiene el número de venta y la fecha.</p>
          <div class="form-grid">
            <label class="fld">Paquete RTM<select id="rc_package">${pkgOpts}</select></label>
            <label class="fld">PIN (si la RTM se realiza hoy)<input id="rc_pin" value="${esc(sale.pinNumber || "")}" placeholder="19-20 dígitos" /></label>
            <label class="chk" style="align-self:end"><input type="checkbox" id="rc_rtmToday" ${sale.rtmToday ? "checked" : ""} /> La RTM se realiza hoy</label>
          </div>
          <div style="margin-top:8px"><b>Pagos</b> <span class="hint">(la suma debe cubrir el total; solo el efectivo puede exceder por las vueltas)</span></div>
          <div id="rc_payments" style="margin-top:6px">${payRows}</div>
          <button type="button" class="link" id="rc_addpay">+ agregar pago</button>
          <div class="row" style="margin-top:12px;gap:8px">
            <button class="btn success" id="rc_save">💾 Guardar recálculo</button>
            <button class="btn ghost" id="rc_cancel">Cancelar</button>
          </div>
        </div>`;
      const wireDel = () => box.querySelectorAll(".rc-delrow").forEach((b) => b.onclick = () => { if (box.querySelectorAll(".rc-payrow").length > 1) b.closest(".rc-payrow").remove(); });
      wireDel();
      $("rc_addpay").onclick = () => { $("rc_payments").insertAdjacentHTML("beforeend", paymentRowHtml(methods)); wireDel(); };
      $("rc_cancel").onclick = () => { box.innerHTML = ""; box.dataset.open = ""; };
      $("rc_save").onclick = () => saveRecompute(id);
    } catch (e) { box.innerHTML = `<p class="hint">${esc(e.message)}</p>`; box.dataset.open = ""; }
  }
  async function saveRecompute(id) {
    const box = $("ve_recomputeBox");
    const payments = [...box.querySelectorAll(".rc-payrow")].map((row) => ({
      methodCode: row.querySelector(".rc-method").value,
      amount: Math.round(Number(String(row.querySelector(".rc-amount").value).replace(/[^\d]/g, "")) || 0)
    })).filter((p) => p.methodCode && p.amount > 0);
    if (!payments.length) return toast("Agrega al menos un pago con método y monto");
    const body = {
      packageCode: $("rc_package").value,
      pinNumber: $("rc_pin").value.trim(),
      rtmToday: $("rc_rtmToday").checked,
      payments
    };
    if (!confirm("¿Recalcular la venta con estos cambios?\n\nSe reemplazan pagos, costos, provisión, cartera y factura, y se recalcula el cierre del día.")) return;
    try {
      await api.recomputeSale(id, body);
      toast("✅ Venta recalculada");
      await loadVentas();
      await openSaleById(id);
    } catch (e) { toast(e.message); }
  }

  // ─── Guardar edición ─────────────────────────────────────────────────────────
  async function saveSale() {
    if (!selectedSale) return;
    // Coherencia convenio/tipo: directo ⇒ USUARIO; referido ⇒ exige un convenio.
    let allyType = $("ve_allyType").value;
    let allyName = $("ve_allyName").value;
    if (allyType === "usuario") allyName = "USUARIO";
    if (allyType === "referido" && allyName === "USUARIO") {
      return toast("Elige un convenio para el referido, o cambia el tipo a directo");
    }
    const body = {
      clientName: $("ve_clientName").value.trim(),
      plate: $("ve_plate").value.trim(),
      modelYear: $("ve_modelYear").value ? Number($("ve_modelYear").value) : null,
      invoiceNumber: $("ve_invoiceNumber").value.trim() || null,
      allyName,
      allyType,
      discountApplied: $("ve_discount").checked,
      responsable: $("ve_responsable").value.trim() || null,
      observaciones: $("ve_observaciones").value.trim() || null,
    };
    if (!body.clientName) return toast("El nombre del cliente es obligatorio");
    // Cambio de fecha: solo si el admin lo tocó y es distinto. Confirmar por el impacto en el cierre.
    const newDate = $("ve_saleDate")?.value;
    if (newDate && newDate !== selectedSale.saleDate) {
      if (!confirm(`Vas a cambiar la fecha de la venta de ${selectedSale.saleDate} a ${newDate}.\n\nEsto reajusta los cálculos (caja, cartera y cierre) de AMBOS días. ¿Continuar?`)) return;
      body.saleDate = newDate;
    }
    const id = selectedSale.id;
    try {
      await api.updateSale(id, body);
      toast("✅ Venta actualizada");
      await loadVentas();        // refresca la lista al instante
      await openSaleById(id);    // refresca el panel con los datos nuevos
    } catch (e) { toast(e.message); }
  }

  // ─── Anular ──────────────────────────────────────────────────────────────────
  async function voidSaleUI(id) {
    const reason = prompt("Motivo de la anulacion:");
    if (reason === null) return;
    const authorizedBy = prompt("Autorizado por (codigo/nombre):") || "";
    try {
      await api.voidSale(id, { reason, authorizedBy });
      toast("Venta anulada");
      $("ventasDetailTitle").textContent = "Detalle";
      $("ventasDetailBody").innerHTML = `<p class="hint">Venta anulada. Selecciona otra para continuar.</p>`;
      selectedSale = null;
      await loadVentas();
    } catch (e) { toast(e.message); }
  }

  // ─── Reactivar (des-anular) ──────────────────────────────────────────────────
  async function reactivateSaleUI(id) {
    if (!confirm("¿Reactivar esta venta anulada?\n\nVuelve a quedar activa: se restauran su cartera y sus movimientos de caja, y se recalcula el cierre del día.")) return;
    try {
      await api.reactivateSale(id);
      toast("✅ Venta reactivada");
      await loadVentas();
      await openSaleById(id);
    } catch (e) { toast(e.message); }
  }

  // ─── Eliminar ────────────────────────────────────────────────────────────────
  async function deleteSaleUI(id) {
    if (!confirm("⚠️ ¿Eliminar esta venta definitivamente?\n\nEsta acción NO se puede deshacer.")) return;
    try {
      await api.deleteSale(id);
      toast("Venta eliminada");
      $("ventasDetailTitle").textContent = "Detalle";
      $("ventasDetailBody").innerHTML = `<p class="hint">Haz clic en una venta para ver el detalle.</p>`;
      selectedSale = null;
      await loadVentas();
    } catch (e) { toast(e.message); }
  }

  return { loadVentas, exportVentasUI, openSaleById };
}
