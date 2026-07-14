import { $, esc } from "../utils.js";
import { openRuntConsulta, runtBookmarkletHtml } from "./runt-helper.js";

export function createClientsModule(context) {
  const { api, toast } = context;
  async function loadClientes(q = "") {
    try {
      const items = await api.findClients(q);
      $("clientesBody").innerHTML = `<table class="data"><thead><tr><th>Documento</th><th>Nombre</th><th>Telefono</th></tr></thead><tbody>${
        items.map((c) => `<tr class="clickable" data-doc="${esc(c.docNumber)}"><td>${esc(c.docType || "")} ${esc(c.docNumber)}</td><td>${esc(c.name)}</td><td>${esc(c.phone || "")}</td></tr>`).join("") || '<tr><td class="hint" colspan="3">Sin clientes</td></tr>'
      }</tbody></table>`;
      $("clientesBody").querySelectorAll("[data-doc]").forEach((tr) => tr.addEventListener("click", () => loadClientDetail(tr.dataset.doc)));
    } catch (e) { toast(e.message); }
  }
  const DOC_TYPES = ["CC", "NIT", "CE", "TI", "PAS"];
  function docTypeSelect(id, val) {
    return `<select id="${id}">${DOC_TYPES.map((t) => `<option value="${t}" ${t === (val || "CC") ? "selected" : ""}>${t}</option>`).join("")}</select>`;
  }
  // Editor de telefonos: principal (obligatorio) + adicionales dinamicos.
  function phonesEditorHtml(phone, phones) {
    const extra = Array.isArray(phones) ? phones : [];
    return `
      <label class="fld">Telefono principal *<input id="cl_phone" value="${esc(phone || "")}" placeholder="Obligatorio" /></label>
      <label class="fld">Telefonos adicionales
        <div id="cl_phones">${extra.map((p) => phoneRowHtml(p)).join("")}</div>
        <button class="link" id="cl_addphone" type="button">+ agregar telefono</button>
      </label>`;
  }
  function phoneRowHtml(val = "") {
    return `<div class="payrow"><input class="cl-extra-phone" value="${esc(val)}" placeholder="Telefono adicional" /><button class="link" type="button" data-delphone>quitar</button></div>`;
  }
  function wirePhonesEditor() {
    $("cl_addphone")?.addEventListener("click", () => {
      const box = $("cl_phones");
      box.insertAdjacentHTML("beforeend", phoneRowHtml(""));
      box.lastElementChild.querySelector("[data-delphone]").addEventListener("click", (e) => e.target.closest(".payrow").remove());
      box.lastElementChild.querySelector("input").focus();
    });
    $("cl_phones")?.querySelectorAll("[data-delphone]").forEach((b) => b.addEventListener("click", (e) => e.target.closest(".payrow").remove()));
  }
  function readPhones() {
    const phone = $("cl_phone").value.trim();
    const phones = [...document.querySelectorAll(".cl-extra-phone")].map((i) => i.value.trim()).filter(Boolean);
    return { phone, phones };
  }
  const HIST_LABEL = { directo: "Directo", referido: "Referido", rtm: "RTM", no_rtm: "Sin RTM" };
  // Fecha + hora exactas del evento (momento en que se registró la venta).
  function histFechaHora(h) {
    const d = h.createdAt ? new Date(h.createdAt) : null;
    if (!d || isNaN(d.getTime())) return String(h.year || "");
    return d.toLocaleString("es-CO", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
  }
  function historyTableHtml(history = []) {
    if (!history.length) return '<p class="hint">Sin historial todavia.</p>';
    return `<table class="data"><thead><tr><th>Fecha y hora</th><th>Como llego</th><th>Placa</th><th>Convenio</th><th>Nota</th></tr></thead><tbody>${
      history.map((h) => `<tr><td>${esc(histFechaHora(h))}</td><td><span class="pill ${h.eventType === "referido" ? "warn" : ""}">${esc(HIST_LABEL[h.eventType] || h.eventType)}</span></td><td>${esc(h.plate || "")}</td><td>${esc(h.allyName || "")}</td><td class="hint">${esc(h.note || "")}</td></tr>`).join("")
    }</tbody></table>`;
  }

  async function loadClientDetail(doc) {
    try {
      const c = await api.getClient(doc);
      $("clientDetailName").textContent = c.name;
      const veh = c.vehicles || [];
      const hist = c.history || [];
      $("clientDetailBody").innerHTML = `
        <div class="form-grid">
          <label class="fld">Tipo documento${docTypeSelect("cl_docType", c.docType)}</label>
          <label class="fld">Nombre<input id="cl_name" value="${esc(c.name)}" /></label>
          ${phonesEditorHtml(c.phone, c.phones)}
          <label class="fld">Email<input id="cl_email" value="${esc(c.email || "")}" /></label>
          <label class="fld">Direccion<input id="cl_address" value="${esc(c.address || "")}" /></label>
        </div>
        <div class="detail-meta">${esc(c.docType || "")} ${esc(c.docNumber)}</div>
        <div class="row form-actions">
          <button class="btn success" id="clSave">Guardar cliente</button>
          <button class="btn runt-btn" id="clRunt">Buscar en el RUNT</button>
          <button class="btn danger" id="clDelete">Eliminar</button>
        </div>
        <p class="hint runt-helper-note">Primera vez: arrastra ${runtBookmarkletHtml()} a la barra de favoritos. Luego usa Buscar en el RUNT y, en RUNT, pulsa ese favorito.</p>
        <h3>Motos / placas (${veh.length})</h3>
        <table class="data"><thead><tr><th>Placa</th><th>Año</th><th>Rango</th><th></th></tr></thead><tbody>${
          veh.map((v) => `<tr><td><b>${esc(v.plate)}</b></td><td>${v.modelYear || "-"}</td><td>${esc(v.rangeName || "")}</td><td><button class="link" data-delveh="${v.id}">eliminar</button></td></tr>`).join("") || '<tr><td class="hint" colspan="4">Sin motos registradas</td></tr>'
        }</tbody></table>
        <div class="row" style="margin-top:12px">
          <input id="cl_newplate" placeholder="Nueva placa" style="text-transform:uppercase" />
          <input id="cl_newyear" type="number" placeholder="Año" min="1980" max="2035" />
          <button class="btn" id="clAddVeh">Agregar moto</button>
        </div>
        <h3>Historial del cliente (${hist.length})</h3>
        ${historyTableHtml(hist)}`;
      wirePhonesEditor();
      $("clSave").addEventListener("click", () => saveClientEdit(c.docNumber));
      $("clRunt").addEventListener("click", () => {
        if (!veh.length) return toast("Agrega una moto/placa antes de buscar en RUNT");
        openRuntConsulta({ client: c, vehicle: veh[0] }, toast);
      });
      $("clDelete").addEventListener("click", () => deleteClientUI(c.docNumber, c.name));
      $("clAddVeh").addEventListener("click", () => addVehicleUI(c.docNumber));
      $("clientDetailBody").querySelectorAll("[data-delveh]").forEach((b) => b.addEventListener("click", () => delVehicleUI(Number(b.dataset.delveh), c.docNumber)));
    } catch (e) { toast(e.message); }
  }
  async function saveClientEdit(doc) {
    const { phone, phones } = readPhones();
    if (!phone) return toast("El telefono principal es obligatorio");
    try {
      await api.saveClient({ docNumber: doc, docType: $("cl_docType").value, name: $("cl_name").value.trim(), phone, phones, email: $("cl_email").value.trim(), address: $("cl_address").value.trim() });
      toast("Cliente guardado");
      loadClientes($("clientListSearch").value || "");
      loadClientDetail(doc);
    } catch (e) { toast(e.message); }
  }
  async function deleteClientUI(doc, name) {
    if (!confirm(`¿Eliminar a "${name}" y sus motos?`)) return;
    try {
      await api.deleteClient(doc);
      toast("Cliente eliminado");
      $("clientDetailBody").innerHTML = `<p class="hint">Selecciona un cliente para ver sus motos y placas.</p>`;
      $("clientDetailName").textContent = "Motos / placas";
      loadClientes($("clientListSearch").value || "");
    } catch (e) { toast(e.message); }
  }
  async function addVehicleUI(doc) {
    const plate = $("cl_newplate").value.trim().toUpperCase();
    const year = Number($("cl_newyear").value) || null;
    if (!plate) return toast("Ingresa la placa");
    try { await api.saveVehicle({ clientDoc: doc, plate, modelYear: year }); toast("Moto agregada"); loadClientDetail(doc); }
    catch (e) { toast(e.message); }
  }
  async function delVehicleUI(id, doc) {
    if (!confirm("¿Eliminar esta moto?")) return;
    try { await api.deleteVehicle(id); toast("Moto eliminada"); loadClientDetail(doc); }
    catch (e) { toast(e.message); }
  }
  function renderNewClientForm() {
    $("clientDetailName").textContent = "Nuevo cliente";
    $("clientDetailBody").innerHTML = `
      <div class="form-grid">
        <label class="fld">Tipo documento${docTypeSelect("cl_docType", "CC")}</label>
        <label class="fld">Documento *<input id="cl_newdoc" /></label>
        <label class="fld">Nombre *<input id="cl_name" /></label>
        ${phonesEditorHtml("", [])}
        <label class="fld">Email<input id="cl_email" /></label>
        <label class="fld">Direccion<input id="cl_address" /></label>
      </div>
      <div class="row form-actions"><button class="btn success" id="clCreate">Crear cliente</button></div>`;
    wirePhonesEditor();
    $("clCreate").addEventListener("click", createClientUI);
  }
  async function createClientUI() {
    const docNumber = $("cl_newdoc").value.trim();
    const name = $("cl_name").value.trim();
    const { phone, phones } = readPhones();
    if (!docNumber || !name) return toast("Documento y nombre obligatorios");
    if (!phone) return toast("El telefono principal es obligatorio");
    try {
      await api.saveClient({ docNumber, name, phone, phones, email: $("cl_email").value.trim(), address: $("cl_address").value.trim(), docType: $("cl_docType").value });
      toast("Cliente creado");
      loadClientes();
      loadClientDetail(docNumber);
    } catch (e) { toast(e.message); }
  }
  return { loadClientes, loadClientDetail, renderNewClientForm };
}
