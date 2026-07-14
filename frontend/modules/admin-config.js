import { $, esc, money, readCop, todayIso, downloadBlob, confirmDialog } from "../utils.js";

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
      </div>

      ${(api.currentUser?.()?.role === "admin" && (api.currentUser?.()?.companyId ?? 1) === 1) ? `
      <div class="card">
        <div class="card-head"><h2>Empresas (multi-CDA)</h2></div>
        <p class="hint">Cada empresa tiene sus propios datos: ventas, turnos, cajas, clientes, convenios, tarifas y configuración DIAN. Al crear una empresa se le copia el catálogo base (productos, paquetes, métodos de pago, tarifas, cajas y naturalezas) y se crea su usuario administrador.</p>
        <div class="form-grid">
          <label class="fld">Nombre de la empresa *<input id="coName" placeholder="Ej: CDA MOTOS DEL SUR" /></label>
          <label class="fld">NIT<input id="coNit" placeholder="900123456" /></label>
          <label class="fld">Ciudad<input id="coCity" placeholder="Ibagué" /></label>
          <label class="fld">Usuario admin *<input id="coAdminUser" autocomplete="off" placeholder="admin.motosur" /></label>
          <label class="fld">Nombre del admin *<input id="coAdminName" placeholder="Quién administra ese CDA" /></label>
          <label class="fld">Clave del admin *<input id="coAdminPass" type="password" autocomplete="new-password" placeholder="Clave inicial" /></label>
        </div>
        <div class="row form-actions"><button class="btn success" id="coCreate">Crear empresa</button></div>
        <div id="coBody"></div>
      </div>` : ""}

      ${(api.currentUser?.()?.role === "admin") ? `
      <div class="card">
        <div class="card-head"><h2>Tarifas y costos (RTM)</h2></div>
        <p class="hint">Valores que usa el sistema para calcular los costos de cada venta: SICOV, RECAUDO, FUPA, SUSTRATOS, IVA de facturación, % de IVA (IVA_RATE) y ANSV (por rango de modelo). Para IVA_RATE el valor es el porcentaje (ej. 19). Cambiarlas afecta las ventas NUEVAS (las ya hechas conservan sus costos congelados).</p>
        <div class="form-grid">
          <label class="fld">Concepto *<select id="trConcept">
            <option value="SICOV">SICOV</option><option value="RECAUDO">RECAUDO</option>
            <option value="FUPA">FUPA</option><option value="SUSTRATOS">SUSTRATOS</option>
            <option value="IVA_FACT">IVA_FACT (IVA de factura)</option><option value="IVA_RATE">IVA_RATE (% IVA)</option>
            <option value="ANSV">ANSV</option><option value="ICA">ICA</option>
          </select></label>
          <label class="fld">Vehículo<input id="trVeh" value="MOTO" /></label>
          <label class="fld">Valor *<input id="trValue" inputmode="numeric" placeholder="$ (o % si es IVA_RATE)" /></label>
          <label class="fld">Año desde (ANSV)<input id="trYearFrom" inputmode="numeric" placeholder="0" /></label>
          <label class="fld">Año hasta (ANSV)<input id="trYearTo" inputmode="numeric" placeholder="9999" /></label>
          <label class="fld">Vigente desde<input type="date" id="trValidFrom" value="${todayIso()}" /></label>
        </div>
        <div class="row form-actions">
          <button class="btn success" id="trSave">Agregar tarifa</button>
          <button class="btn ghost hidden" id="trCancel">Cancelar edición</button>
        </div>
        <div id="trBody"></div>
      </div>` : ""}

      ${(api.currentUser?.()?.role === "admin") ? `
      <div class="card">
        <div class="card-head"><h2>Naturalezas de ingresos y gastos</h2></div>
        <p class="hint">Clasifican los ingresos, gastos, obligaciones y facturas de proveedor para los reportes gerenciales. Las inactivas dejan de salir en los formularios pero conservan su historial.</p>
        <div class="form-grid">
          <label class="fld">Nombre *<input id="natName" placeholder="Ej: Retiro del banco, Arriendo, Nómina…" /></label>
          <label class="fld">Tipo<select id="natKind">
            <option value="ingreso">Ingreso</option>
            <option value="gasto">Gasto</option>
            <option value="ambos">Ambos</option>
          </select></label>
          <label class="chk" style="align-self:end"><input type="checkbox" id="natTax" /> Relevante para impuestos (IVA)</label>
        </div>
        <div class="row form-actions">
          <button class="btn success" id="natSave">Agregar naturaleza</button>
          <button class="btn ghost hidden" id="natCancel">Cancelar edición</button>
        </div>
        <div id="natBody"></div>
      </div>` : ""}

      ${(api.currentUser?.()?.role === "admin") ? `
      <div class="card danger-zone">
        <div class="card-head"><h2>⚠️ Zona peligrosa — Borrar turnos y ventas</h2></div>
        <p class="hint">Borra <b>toda la operación</b>: ventas, turnos, cierres diarios, movimientos de caja (las cajas quedan en cero), pagos de convenio, cartera, facturas, ingresos/gastos, cuentas por pagar, facturas de proveedor, órdenes de compra, FUPA, llamadas e historial de cliente.</p>
        <p class="hint"><b>Se conservan:</b> clientes, vehículos, convenios, proveedores, catálogo, tarifas, usuarios, cajas y configuración.</p>
        <p class="hint" style="color:var(--red)"><b>Esta acción es IRREVERSIBLE.</b> Para habilitar el botón, escribe <b>BORRAR</b> en mayúsculas.</p>
        <div class="form-grid">
          <label class="fld">Confirmación<input id="resetConfirm" autocomplete="off" placeholder="Escribe BORRAR para habilitar" /></label>
        </div>
        <div class="row form-actions"><button class="btn danger" id="resetOpsBtn" disabled>Borrar turnos y ventas</button></div>
      </div>` : ""}`;
    $("cfgDianSave").addEventListener("click", saveDianConfigUI);
    $("cfgNotifSave").addEventListener("click", saveNotifConfigUI);
    c.querySelectorAll("[data-test]").forEach((b) => b.addEventListener("click", () => testNotifUI(b.dataset.test)));
    wireCompanies();
    wireTariffs();
    wireNatures();
    wireResetOps();
  }

  // ---------- Gestion de empresas (multi-CDA, solo admin de la empresa principal) ----------
  function wireCompanies() {
    if (!$("coCreate")) return; // la tarjeta solo existe para el admin de la empresa 1
    $("coCreate").addEventListener("click", createCompanyUI);
    loadCompanies();
  }

  async function loadCompanies() {
    const box = $("coBody");
    if (!box) return;
    try {
      const { items } = await api.companies();
      box.innerHTML = `<table class="data"><thead><tr><th>#</th><th>Empresa</th><th>NIT</th><th>Ciudad</th><th>Usuarios</th><th>Estado</th><th></th></tr></thead><tbody>${
        items.map((co) => `<tr style="${co.active ? "" : "opacity:.55"}">
          <td>${co.id}</td>
          <td><b>${esc(co.name)}</b>${co.id === 1 ? ' <span class="pill">principal</span>' : ""}</td>
          <td>${esc(co.nit || "")}</td>
          <td>${esc(co.city || "")}</td>
          <td>${co.users}</td>
          <td><span class="pill ${co.active ? "ok" : "danger"}">${co.active ? "activa" : "inactiva"}</span></td>
          <td>${co.id !== 1 ? `<button class="link" data-cotoggle="${co.id}" data-active="${co.active ? 1 : 0}">${co.active ? "desactivar" : "activar"}</button>` : ""}</td>
        </tr>`).join("")
      }</tbody></table>`;
      box.querySelectorAll("[data-cotoggle]").forEach((b) => b.addEventListener("click", async () => {
        const turnOff = b.dataset.active === "1";
        if (turnOff && !(await confirmDialog("Sus usuarios no podrán iniciar sesión hasta reactivarla. Los datos no se borran.", { title: "¿Desactivar esta empresa?", okText: "Desactivar", danger: true }))) return;
        try {
          await api.updateCompany(Number(b.dataset.cotoggle), { active: !turnOff });
          toast(turnOff ? "Empresa desactivada" : "Empresa activada");
          loadCompanies();
        } catch (e) { toast(e.message); }
      }));
    } catch (e) { box.innerHTML = `<p class="hint">${esc(e.message)}</p>`; }
  }

  async function createCompanyUI() {
    const body = {
      name: $("coName").value.trim(),
      nit: $("coNit").value.trim() || null,
      city: $("coCity").value.trim() || null,
      adminUsername: $("coAdminUser").value.trim(),
      adminName: $("coAdminName").value.trim(),
      adminPassword: $("coAdminPass").value
    };
    if (!body.name) return toast("El nombre de la empresa es obligatorio");
    if (!body.adminUsername || !body.adminName || !body.adminPassword) return toast("Completa el usuario administrador (usuario, nombre y clave)");
    try {
      const r = await api.createCompany(body);
      toast(`Empresa "${r.company.name}" creada · catálogo copiado · admin: ${r.admin.username}`);
      ["coName", "coNit", "coCity", "coAdminUser", "coAdminName", "coAdminPass"].forEach((id) => { $(id).value = ""; });
      loadCompanies();
    } catch (e) { toast(e.message); }
  }

  // ---------- CRUD de tarifas/costos (RTM) ----------
  let editingTariff = null;
  function wireTariffs() {
    if (!$("trSave")) return;
    $("trSave").addEventListener("click", saveTariffUI);
    $("trCancel").addEventListener("click", resetTariffForm);
    loadTariffs();
  }
  function resetTariffForm() {
    editingTariff = null;
    $("trValue").value = ""; $("trYearFrom").value = ""; $("trYearTo").value = ""; $("trVeh").value = "MOTO";
    $("trValidFrom").value = todayIso();
    $("trSave").textContent = "Agregar tarifa";
    $("trCancel").classList.add("hidden");
  }
  async function loadTariffs() {
    const box = $("trBody");
    if (!box) return;
    try {
      const { items } = await api.tariffs();
      box.innerHTML = `<table class="data"><thead><tr><th>Concepto</th><th>Vehículo</th><th class="r">Valor</th><th class="r">Año desde</th><th class="r">Año hasta</th><th>Vigente desde</th><th>Estado</th><th></th></tr></thead><tbody>${
        items.map((t) => `<tr style="${t.active ? "" : "opacity:.5"}">
          <td><b>${esc(t.concept)}</b></td><td>${esc(t.vehicleType)}</td>
          <td class="r">${t.concept === "IVA_RATE" ? t.value + "%" : money(t.value)}</td>
          <td class="r">${t.yearFrom || 0}</td><td class="r">${t.yearTo || 9999}</td>
          <td>${esc(t.validFrom)}</td>
          <td><span class="pill ${t.active ? "ok" : "danger"}">${t.active ? "activa" : "inactiva"}</span></td>
          <td><button class="link" data-tredit="${t.id}">editar</button> <button class="link" data-trdel="${t.id}">eliminar</button></td>
        </tr>`).join("") || '<tr><td class="hint" colspan="8">Sin tarifas. Agrega la primera arriba.</td></tr>'
      }</tbody></table>`;
      const byId = Object.fromEntries(items.map((t) => [t.id, t]));
      box.querySelectorAll("[data-tredit]").forEach((b) => b.addEventListener("click", () => {
        const t = byId[b.dataset.tredit]; if (!t) return;
        editingTariff = t.id;
        $("trConcept").value = t.concept; $("trVeh").value = t.vehicleType; $("trValue").value = t.value;
        $("trYearFrom").value = t.yearFrom || 0; $("trYearTo").value = t.yearTo || 9999; $("trValidFrom").value = t.validFrom;
        $("trSave").textContent = `Guardar cambios (${t.concept})`;
        $("trCancel").classList.remove("hidden");
        $("trValue").focus();
      }));
      box.querySelectorAll("[data-trdel]").forEach((b) => b.addEventListener("click", async () => {
        if (!(await confirmDialog("Se elimina esta tarifa. Las ventas ya hechas no cambian (sus costos están congelados).", { title: "¿Eliminar tarifa?", okText: "Eliminar", danger: true }))) return;
        try { await api.deleteTariff(Number(b.dataset.trdel)); toast("Tarifa eliminada"); loadTariffs(); }
        catch (e) { toast(e.message); }
      }));
    } catch (e) { box.innerHTML = `<p class="hint">${esc(e.message)}</p>`; }
  }
  async function saveTariffUI() {
    const body = {
      concept: $("trConcept").value, vehicleType: $("trVeh").value.trim() || "MOTO",
      value: readCop("trValue"), yearFrom: readCop("trYearFrom"), yearTo: readCop("trYearTo") || 9999,
      validFrom: $("trValidFrom").value || todayIso()
    };
    try {
      if (editingTariff) await api.updateTariff(editingTariff, body); else await api.saveTariff(body);
      toast(editingTariff ? "Tarifa actualizada" : "Tarifa agregada");
      resetTariffForm(); loadTariffs();
    } catch (e) { toast(e.message); }
  }

  // ---------- CRUD de naturalezas de ingreso/gasto ----------
  const NAT_KIND = { ingreso: "Ingreso", gasto: "Gasto", ambos: "Ambos" };
  let editingNature = null; // code en edicion (null = creando)

  function wireNatures() {
    if (!$("natSave")) return; // la tarjeta solo existe para admin
    $("natSave").addEventListener("click", saveNatureUI);
    $("natCancel").addEventListener("click", () => resetNatureForm());
    loadNatures();
  }

  function resetNatureForm() {
    editingNature = null;
    $("natName").value = "";
    $("natKind").value = "ingreso";
    $("natTax").checked = false;
    $("natSave").textContent = "Agregar naturaleza";
    $("natCancel").classList.add("hidden");
  }

  async function loadNatures() {
    const box = $("natBody");
    if (!box) return;
    try {
      const { items } = await api.expenseNaturesAll();
      box.innerHTML = `<table class="data"><thead><tr><th>Nombre</th><th>Código</th><th>Tipo</th><th>Impuestos</th><th>Estado</th><th></th></tr></thead><tbody>${
        items.map((n) => `<tr style="${n.active ? "" : "opacity:.55"}">
          <td><b>${esc(n.name)}</b></td>
          <td class="hint">${esc(n.code)}</td>
          <td>${esc(NAT_KIND[n.kind] || n.kind)}</td>
          <td>${n.taxRelevant ? "✓ IVA" : ""}</td>
          <td><span class="pill ${n.active ? "ok" : "danger"}">${n.active ? "activa" : "inactiva"}</span></td>
          <td>
            <button class="link" data-natedit="${esc(n.code)}">editar</button>
            <button class="link" data-nattoggle="${esc(n.code)}" data-active="${n.active ? 1 : 0}">${n.active ? "desactivar" : "activar"}</button>
            <button class="link" data-natdel="${esc(n.code)}">eliminar</button>
          </td>
        </tr>`).join("") || '<tr><td class="hint" colspan="6">Sin naturalezas. Agrega la primera arriba.</td></tr>'
      }</tbody></table>`;
      const byCode = Object.fromEntries(items.map((n) => [n.code, n]));
      box.querySelectorAll("[data-natedit]").forEach((b) => b.addEventListener("click", () => {
        const n = byCode[b.dataset.natedit];
        if (!n) return;
        editingNature = n.code;
        $("natName").value = n.name;
        $("natKind").value = n.kind;
        $("natTax").checked = !!n.taxRelevant;
        $("natSave").textContent = `Guardar cambios (${n.code})`;
        $("natCancel").classList.remove("hidden");
        $("natName").focus();
      }));
      box.querySelectorAll("[data-nattoggle]").forEach((b) => b.addEventListener("click", async () => {
        try {
          await api.updateExpenseNature(b.dataset.nattoggle, { active: b.dataset.active !== "1" });
          toast(b.dataset.active === "1" ? "Naturaleza desactivada" : "Naturaleza activada");
          loadNatures();
        } catch (e) { toast(e.message); }
      }));
      box.querySelectorAll("[data-natdel]").forEach((b) => b.addEventListener("click", async () => {
        const n = byCode[b.dataset.natdel];
        if (!(await confirmDialog(
          `Si "${n?.name || b.dataset.natdel}" ya tiene movimientos asociados no se borra: se desactiva (conserva el historial).`,
          { title: "¿Eliminar esta naturaleza?", okText: "Eliminar", danger: true }
        ))) return;
        try {
          const r = await api.deleteExpenseNature(b.dataset.natdel);
          toast(r.deactivated ? r.message : "Naturaleza eliminada");
          loadNatures();
        } catch (e) { toast(e.message); }
      }));
    } catch (e) { box.innerHTML = `<p class="hint">${esc(e.message)}</p>`; }
  }

  async function saveNatureUI() {
    const name = $("natName").value.trim();
    if (!name) return toast("El nombre es obligatorio");
    const body = { name, kind: $("natKind").value, taxRelevant: $("natTax").checked };
    try {
      if (editingNature) await api.updateExpenseNature(editingNature, body);
      else await api.saveExpenseNature(body);
      toast(editingNature ? "Naturaleza actualizada" : "Naturaleza agregada");
      resetNatureForm();
      loadNatures();
    } catch (e) { toast(e.message); }
  }

  // Zona peligrosa: el boton solo se habilita si se escribe BORRAR, y aun asi pide
  // una confirmacion final antes de ejecutar el reset operacional.
  function wireResetOps() {
    const input = $("resetConfirm");
    const btn = $("resetOpsBtn");
    if (!input || !btn) return;
    input.addEventListener("input", () => { btn.disabled = input.value.trim().toUpperCase() !== "BORRAR"; });
    btn.addEventListener("click", async () => {
      if (input.value.trim().toUpperCase() !== "BORRAR") return;
      const ok = await confirmDialog(
        "Se borrará TODA la operación (ventas, turnos, cierres, movimientos de caja, convenios, cartera, facturas…).\n\nSe conservan clientes, convenios, catálogo, tarifas, usuarios y configuración.\n\nEsta acción NO se puede deshacer. ¿Continuar?",
        { title: "Borrar turnos y ventas", okText: "Sí, borrar todo", cancelText: "Cancelar", danger: true }
      );
      if (!ok) return;
      btn.disabled = true;
      toast("Borrando data operacional…");
      try {
        const r = await api.resetOperacional("BORRAR");
        toast(`Listo · ${r.total} registros borrados. Las cajas quedaron en cero.`);
        input.value = "";
      } catch (e) {
        toast(e.message);
        btn.disabled = false;
      }
    });
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
