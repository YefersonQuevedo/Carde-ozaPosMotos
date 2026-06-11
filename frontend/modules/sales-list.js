import { $, esc, money, downloadBlob } from "../utils.js";

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
        <th>Estado</th></tr></thead><tbody>${items.map((s) => {
        const anulada = s.status === "anulada";
        return `<tr
            class="${anulada ? "" : "clickable"}"
            style="${anulada ? "opacity:.45;text-decoration:line-through" : ""}"
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
          </tr>`;
      }).join("") || '<tr><td class="hint" colspan="15">Sin ventas</td></tr>'
        }</tbody></table></div>`;

      $("ventasBody").querySelectorAll("[data-id]").forEach((tr) => {
        const sale = items.find((s) => s.id === Number(tr.dataset.id));
        if (sale && sale.status !== "anulada") {
          tr.addEventListener("click", () => openDetail(sale));
        }
      });
    } catch (e) { toast(e.message); }
  }

  // Abre el panel de edición por id (lo usa el cierre diario para corregir rápido).
  async function openSaleById(id) {
    try {
      const { sale } = await api.getSale(Number(id));
      if (!sale) return toast("Venta no encontrada");
      if (sale.status === "anulada") return toast("La venta está anulada");
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

      <div class="row form-actions" style="margin-top:16px;flex-wrap:wrap;gap:8px">
        <button class="btn success" id="ve_save">💾 Guardar cambios</button>
        <button class="btn" id="ve_void">⛔ Anular venta</button>
        ${isAdmin ? `<button class="btn danger" id="ve_delete">🗑️ Eliminar</button>` : ""}
      </div>

      <div class="hint" style="margin-top:10px">
        PIN: <b>${esc(sale.pinNumber || "-")}</b> &nbsp;·&nbsp;
        RTM: ${esc(sale.rtmStatus)} &nbsp;·&nbsp;
        Estado DIAN: ${esc(sale.dianStatus || "-")}
      </div>`;

    // Sincronía instantánea convenio ⟺ tipo:
    //  - elegir USUARIO → tipo directo; elegir un convenio → tipo referido.
    //  - poner tipo directo → el convenio se vacía a USUARIO automáticamente.
    $("ve_allyName").addEventListener("change", (e) => {
      $("ve_allyType").value = e.target.value === "USUARIO" ? "usuario" : "referido";
    });
    $("ve_allyType").addEventListener("change", (e) => {
      if (e.target.value === "usuario") $("ve_allyName").value = "USUARIO";
    });
    $("ve_save").addEventListener("click", saveSale);
    $("ve_void").addEventListener("click", () => voidSaleUI(sale.id));
    if (isAdmin) $("ve_delete").addEventListener("click", () => deleteSaleUI(sale.id));
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
