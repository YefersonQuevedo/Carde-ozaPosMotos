import { $, esc } from "../utils.js";

export function createUsersModule(context) {
  const { api, toast } = context;
  // ---------- Usuarios (admin) ----------
  async function loadUsuarios() {
    try {
      const users = await api.listUsers();
      $("usuariosBody").innerHTML = `<table class="data"><thead><tr><th>Usuario</th><th>Nombre</th><th>Rol</th><th>Activo</th></tr></thead><tbody>${
        users.map((u) => `<tr class="clickable" data-user='${esc(JSON.stringify(u))}'><td>${esc(u.username)}</td><td>${esc(u.name)}</td><td>${esc(u.role)}</td><td>${u.active ? "Si" : "-"}</td></tr>`).join("")
      }</tbody></table>`;
      $("usuariosBody").querySelectorAll("[data-user]").forEach((tr) => tr.addEventListener("click", () => renderUserForm(JSON.parse(tr.dataset.user))));
    } catch (e) { toast(e.message); }
    loadPermissionsPanel();
  }

  // Panel de permisos por rol: checkboxes de paneles + exports por cada rol configurable.
  const ROLE_LABELS = { vendedor: "Vendedor", auditor: "Auditor", contador: "Contador" };
  async function loadPermissionsPanel() {
    const box = $("permsBody");
    if (!box) return;
    try {
      const { panels, exports, roles } = await api.rolePermissions();
      const chk = (kind, role, id, label, checked) => `<label class="chk" style="display:inline-flex;width:auto;margin:2px 12px 2px 0"><input type="checkbox" data-perm="${kind}" data-role="${role}" value="${esc(id)}" ${checked ? "checked" : ""}/> ${esc(label)}</label>`;
      box.innerHTML = Object.keys(roles).map((role) => {
        const vset = new Set(roles[role].views), eset = new Set(roles[role].exports);
        const panelChks = panels.map((p) => chk("view", role, p.id, p.label, vset.has(p.id))).join("");
        const expChks = exports.map((x) => chk("export", role, x.id, x.label, eset.has(x.id))).join("");
        return `<div class="card" style="margin-bottom:12px;border:1px solid var(--line)">
          <div class="card-head"><h3 style="margin:0">${esc(ROLE_LABELS[role] || role)}</h3><button class="btn success" data-saveperm="${role}">Guardar ${esc(ROLE_LABELS[role] || role)}</button></div>
          <h4 style="margin:8px 0 2px">Paneles que puede ver</h4><div>${panelChks}</div>
          <h4 style="margin:10px 0 2px">Exports que puede descargar</h4><div>${expChks}</div>
        </div>`;
      }).join("");
      box.querySelectorAll("[data-saveperm]").forEach((b) => b.addEventListener("click", () => saveRolePerms(b.dataset.saveperm)));
    } catch (e) { box.innerHTML = `<p class="hint">${esc(e.message)}</p>`; }
  }
  async function saveRolePerms(role) {
    const views = [...document.querySelectorAll(`[data-perm="view"][data-role="${role}"]:checked`)].map((c) => c.value);
    const exports = [...document.querySelectorAll(`[data-perm="export"][data-role="${role}"]:checked`)].map((c) => c.value);
    try { await api.saveRolePermissions(role, { views, exports }); toast(`Permisos de ${ROLE_LABELS[role] || role} guardados`); }
    catch (e) { toast(e.message); }
  }
  function renderUserForm(u) {
    $("userFormTitle").textContent = u ? `Editar: ${u.username}` : "Nuevo usuario";
    $("userForm").innerHTML = `
      <div class="form-grid">
        <label class="fld">Usuario<input id="us_username" value="${esc(u?.username || "")}" ${u ? "disabled" : ""} /></label>
        <label class="fld">Nombre<input id="us_name" value="${esc(u?.name || "")}" /></label>
        <label class="fld">Rol
          <select id="us_role">
            <option value="vendedor" ${u?.role === "vendedor" ? "selected" : ""}>Vendedor</option>
            <option value="admin" ${u?.role === "admin" ? "selected" : ""}>Administrador</option>
            <option value="auditor" ${u?.role === "auditor" ? "selected" : ""}>Auditor (ve todo, solo lectura)</option>
            <option value="contador" ${u?.role === "contador" ? "selected" : ""}>Contador (facturas y gastos, solo lectura)</option>
          </select>
        </label>
        <label class="fld">${u ? "Nueva clave (opcional)" : "Clave"}<input id="us_password" type="password" /></label>
      </div>
      <div class="row form-checks"><label class="chk"><input type="checkbox" id="us_active" ${!u || u.active ? "checked" : ""} /> Activo</label></div>
      <div class="row form-actions">
        <button class="btn success" id="userSave">${u ? "Guardar" : "Crear usuario"}</button>
        ${u ? `<button class="btn danger" id="userDelete">Eliminar</button>` : ""}
      </div>`;
    $("userSave").addEventListener("click", () => saveUser(u?.id));
    if (u) $("userDelete").addEventListener("click", () => deleteUserUI(u.id, u.username));
  }
  async function saveUser(id) {
    const body = {
      username: $("us_username").value.trim(),
      name: $("us_name").value.trim(),
      role: $("us_role").value,
      active: $("us_active").checked
    };
    const pass = $("us_password").value;
    if (pass) body.password = pass;
    if (!body.username || !body.name || (!id && !pass)) return toast("Usuario, nombre y clave obligatorios");
    try {
      const saved = id ? await api.updateUser(id, body) : await api.createUser(body);
      toast(id ? "Usuario actualizado" : "Usuario creado");
      await loadUsuarios();
      renderUserForm(saved);
    } catch (e) { toast(e.message); }
  }
  async function deleteUserUI(id, username) {
    if (!confirm(`¿Eliminar al usuario "${username}"?`)) return;
    try {
      await api.deleteUser(id);
      toast("Usuario eliminado");
      $("userForm").innerHTML = `<p class="hint">Selecciona un usuario o crea uno nuevo.</p>`;
      $("userFormTitle").textContent = "Detalle";
      await loadUsuarios();
    } catch (e) { toast(e.message); }
  }
  return { loadUsuarios, renderUserForm };
}
