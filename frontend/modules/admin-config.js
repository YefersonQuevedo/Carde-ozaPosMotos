import { $, esc, money, downloadBlob } from "../utils.js";

export function createAdminConfigModule(context) {
  const { api, toast } = context;
  // ---------- Facturacion electronica DIAN (config apidian + trazabilidad) ----------
  const DIAN_BADGE = { ACEPTADA: "ok", RECHAZADA: "danger", ENVIADA: "warn", PENDIENTE: "", NO_APLICA: "" };
  const DIAN_CFG_FIELDS = [
    ["companyNit", "NIT empresa"], ["companyDv", "DV"], ["companyName", "Razon social"],
    ["apidianUrl", "URL apidian (…/api/ubl2.1)"], ["apidianToken", "Token apidian"],
    ["testSetId", "Set de pruebas (TestId)"], ["softwareId", "Software ID"], ["softwarePin", "Software PIN"],
    ["resolution", "Resolucion"], ["prefix", "Prefijo"], ["emailApiUrl", "URL API email (opcional)"]
  ];
  async function renderDian(c) {
    if (!c) return;
    c.innerHTML = `<div class="card">
        <div class="card-head"><h2>Trazabilidad de facturas DIAN</h2>
          <div class="row"><div id="dnSummary" class="detail-meta"></div><button class="btn ghost" id="dnExport">Exportar Excel</button></div>
        </div>
        <p class="hint">Estado de cada factura ante la DIAN: ACEPTADA (en la DIAN), RECHAZADA, ENVIADA o PENDIENTE (sin enviar). La conexion se configura en <b>Configuracion → API DIAN</b>.</p>
        <div id="dnBody"></div>
      </div>`;
    $("dnExport").addEventListener("click", async () => {
      try { await downloadBlob(await api.exportDian(), "dian-trazabilidad.xlsx"); } catch (e) { toast(e.message); }
    });
    await loadDianInvoices();
  }

  // ---------- Panel de Configuracion (DIAN + correos + Telegram + WhatsApp) ----------
  async function renderConfig(c) {
    if (!c) return;
    let dian = {}, notif = {};
    try { [dian, notif] = await Promise.all([api.dianConfig(), api.notifConfig()]); } catch (e) { return toast(e.message); }
    const dianFields = DIAN_CFG_FIELDS.map(([k, label]) =>
      `<label class="fld">${label}<input id="dn_${k}" value="${esc(dian[k] ?? "")}" /></label>`).join("");
    c.innerHTML = `
      <div class="card">
        <div class="card-head"><h2>API DIAN (apidian)</h2>
          <label class="chk"><input type="checkbox" id="dn_active" ${dian.active ? "checked" : ""} /> Activa</label>
        </div>
        <p class="hint">apidian arma el XML/UBL, calcula el CUFE, firma y envia a la DIAN.</p>
        <div class="form-grid">
          ${dianFields}
          <label class="fld">Ambiente<select id="dn_environment"><option value="2" ${Number(dian.environment) === 2 ? "selected" : ""}>Pruebas/Habilitacion</option><option value="1" ${Number(dian.environment) === 1 ? "selected" : ""}>Produccion</option></select></label>
        </div>
        <div class="row form-actions"><button class="btn success" id="cfgDianSave">Guardar API DIAN</button></div>
      </div>

      <div class="card">
        <div class="card-head"><h2>Correos</h2><label class="chk"><input type="checkbox" id="nf_emailEnabled" ${notif.emailEnabled ? "checked" : ""} /> Habilitado</label></div>
        <div class="form-grid">
          <label class="fld">URL API de correo<input id="nf_emailApiUrl" value="${esc(notif.emailApiUrl ?? "")}" placeholder="https://…/send-email" /></label>
          <label class="fld">Remitente (from)<input id="nf_emailFrom" value="${esc(notif.emailFrom ?? "")}" placeholder="facturacion@empresa.com" /></label>
        </div>
        <div class="row form-actions"><button class="btn success" id="cfgNotifSave">Guardar notificaciones</button>
          <button class="btn ghost" data-test="email">Probar correo</button></div>
      </div>

      <div class="card">
        <div class="card-head"><h2>Telegram</h2><label class="chk"><input type="checkbox" id="nf_telegramEnabled" ${notif.telegramEnabled ? "checked" : ""} /> Habilitado</label></div>
        <div class="form-grid">
          <label class="fld">Bot Token<input id="nf_telegramBotToken" value="${esc(notif.telegramBotToken ?? "")}" placeholder="123456:ABC…" /></label>
          <label class="fld">Chat ID<input id="nf_telegramChatId" value="${esc(notif.telegramChatId ?? "")}" placeholder="-100123…" /></label>
        </div>
        <div class="row form-actions"><button class="btn ghost" data-test="telegram">Probar Telegram</button></div>
      </div>

      <div class="card">
        <div class="card-head"><h2>WhatsApp</h2><label class="chk"><input type="checkbox" id="nf_whatsappEnabled" ${notif.whatsappEnabled ? "checked" : ""} /> Habilitado</label></div>
        <div class="form-grid">
          <label class="fld">API URL<input id="nf_whatsappApiUrl" value="${esc(notif.whatsappApiUrl ?? "")}" placeholder="https://graph.facebook.com/v20.0" /></label>
          <label class="fld">Token<input id="nf_whatsappToken" value="${esc(notif.whatsappToken ?? "")}" /></label>
          <label class="fld">Phone Number ID<input id="nf_whatsappPhoneId" value="${esc(notif.whatsappPhoneId ?? "")}" /></label>
        </div>
        <div class="row form-actions"><button class="btn ghost" data-test="whatsapp">Probar WhatsApp</button></div>
      </div>`;
    $("cfgDianSave").addEventListener("click", saveDianConfigUI);
    $("cfgNotifSave").addEventListener("click", saveNotifConfigUI);
    c.querySelectorAll("[data-test]").forEach((b) => b.addEventListener("click", () => testNotifUI(b.dataset.test)));
  }
  async function saveDianConfigUI() {
    const body = { environment: $("dn_environment").value, active: $("dn_active").checked };
    DIAN_CFG_FIELDS.forEach(([k]) => { body[k] = $(`dn_${k}`).value.trim(); });
    try { await api.saveDianConfig(body); toast("Configuracion DIAN guardada"); }
    catch (e) { toast(e.message); }
  }
  function readNotifForm() {
    return {
      emailEnabled: $("nf_emailEnabled").checked, emailApiUrl: $("nf_emailApiUrl").value.trim(), emailFrom: $("nf_emailFrom").value.trim(),
      telegramEnabled: $("nf_telegramEnabled").checked, telegramBotToken: $("nf_telegramBotToken").value.trim(), telegramChatId: $("nf_telegramChatId").value.trim(),
      whatsappEnabled: $("nf_whatsappEnabled").checked, whatsappApiUrl: $("nf_whatsappApiUrl").value.trim(), whatsappToken: $("nf_whatsappToken").value.trim(), whatsappPhoneId: $("nf_whatsappPhoneId").value.trim()
    };
  }
  async function saveNotifConfigUI() {
    try { await api.saveNotifConfig(readNotifForm()); toast("Notificaciones guardadas"); }
    catch (e) { toast(e.message); }
  }
  async function testNotifUI(channel) {
    let to = "";
    if (channel === "email") to = prompt("Correo destino para la prueba:") || "";
    if (channel === "whatsapp") to = prompt("Numero WhatsApp destino (ej: 57300…):") || "";
    if ((channel === "email" || channel === "whatsapp") && !to) return;
    try { await api.saveNotifConfig(readNotifForm()); } catch {}
    toast(`Enviando prueba de ${channel}…`);
    try { await api.testNotif(channel, to); toast(`Prueba de ${channel} enviada`); }
    catch (e) { toast(`${channel}: ${e.message}`); }
  }
  async function loadDianInvoices() {
    try {
      const { items, summary, count } = await api.dianInvoices();
      $("dnSummary").textContent = `${count} facturas · ` + Object.entries(summary).map(([k, v]) => `${k}: ${v}`).join(" · ");
      $("dnBody").innerHTML = `<table class="data"><thead><tr><th>Factura</th><th>Cliente</th><th>Estado</th><th>CUFE</th><th>Mensajes</th><th class="r">Total</th><th></th></tr></thead><tbody>${
        items.map((i) => `<tr>
          <td>${esc(i.number)}</td>
          <td>${esc(i.sale?.clientName || "")}</td>
          <td><span class="pill ${DIAN_BADGE[i.sendStatus] || ""}">${esc(i.sendStatus)}</span></td>
          <td class="hint" style="max-width:240px;overflow:hidden;text-overflow:ellipsis">${esc(i.cufe || "")}</td>
          <td class="hint" style="max-width:240px">${esc((i.dianMessages || "").slice(0, 120))}</td>
          <td class="r">${money(i.total)}</td>
          <td>${i.sendStatus === "ACEPTADA" ? "✓" : `<button class="btn primary sm" data-send="${i.id}">Enviar DIAN</button>`}</td>
        </tr>`).join("") || '<tr><td class="hint" colspan="7">Sin facturas</td></tr>'
      }</tbody></table>`;
      $("dnBody").querySelectorAll("[data-send]").forEach((b) => b.addEventListener("click", () => sendDianUI(Number(b.dataset.send))));
    } catch (e) { toast(e.message); }
  }
  async function sendDianUI(id) {
    if (!confirm("¿Enviar esta factura a la DIAN (apidian)?")) return;
    toast("Enviando a la DIAN…");
    try {
      const r = await api.sendDianInvoice(id);
      toast(r.ok ? `Enviada · ${r.invoice.sendStatus}` : `Respuesta: ${r.invoice.sendStatus}`);
      loadDianInvoices();
    } catch (e) { toast(`DIAN: ${e.message}`); loadDianInvoices(); }
  }
  return { renderDian, renderConfig };
}
