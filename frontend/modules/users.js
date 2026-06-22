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

  // Panel de permisos por rol como MATRIZ: filas = paneles/exports, columnas = roles.
  // Soporta roles personalizados (crear/borrar). availableRoles alimenta el desplegable
  // de rol en el alta de usuarios.
  let availableRoles = [];
  let permRoleIds = [];
  async function loadPermissionsPanel() {
    const box = $("permsBody");
    if (!box) return;
    try {
      const { panels, exports, roles } = await api.rolePermissions();
      availableRoles = roles;                     // [{ role, label, builtin, readonly, views, exports }]
      permRoleIds = roles.map((r) => r.role);
      const matrix = (titulo, items, kind, withControls) => {
        const head = `<tr><th style="text-align:left;min-width:220px">${esc(titulo)}</th>${roles.map((r) =>
          `<th style="text-align:center">${esc(r.label)}${r.readonly ? '<br><span class="pill warn" style="font-size:10px">solo lectura</span>' : ""}<br><label class="hint" style="font-weight:400;cursor:pointer"><input type="checkbox" data-allcol="${kind}:${r.role}" /> todos</label>${withControls && !r.builtin ? `<br><button class="link" data-delrole="${esc(r.role)}" style="color:#b72c35">✕ borrar</button>` : ""}</th>`).join("")}</tr>`;
        const body = items.map((it) => {
          const cells = roles.map((r) => {
            const set = new Set(kind === "view" ? r.views : r.exports);
            return `<td style="text-align:center"><input type="checkbox" data-perm="${kind}" data-role="${esc(r.role)}" value="${esc(it.id)}" ${set.has(it.id) ? "checked" : ""} /></td>`;
          }).join("");
          return `<tr><td>${esc(it.label)}</td>${cells}</tr>`;
        }).join("");
        return `<div style="overflow-x:auto"><table class="data perm-matrix"><thead>${head}</thead><tbody>${body}</tbody></table></div>`;
      };
      const saveBtn = `<button class="btn success perm-save">💾 Guardar permisos</button>`;
      box.innerHTML = `
        <div class="row" style="gap:8px;margin-bottom:10px;align-items:flex-end;flex-wrap:wrap">
          <label class="fld" style="max-width:220px;margin:0">Nuevo rol<input id="newRoleName" placeholder="Ej: Supervisor" /></label>
          <label class="chk" style="width:auto"><input type="checkbox" id="newRoleRO" /> Solo lectura</label>
          <button class="btn" id="newRoleBtn">+ Crear rol</button>
          <span style="flex:1"></span>${saveBtn}
        </div>
        <h3 style="margin:6px 0">Paneles que puede ver cada rol</h3>
        ${matrix("Panel", panels, "view", true)}
        <h3 style="margin:16px 0 6px">Exports que puede descargar cada rol</h3>
        ${matrix("Export", exports, "export", false)}
        <div class="row" style="justify-content:flex-end;margin-top:10px">${saveBtn}</div>`;
      // "todos" por columna: marca/desmarca toda la columna de ese rol+tipo.
      box.querySelectorAll("[data-allcol]").forEach((c) => c.addEventListener("change", () => {
        const [kind, role] = c.dataset.allcol.split(":");
        box.querySelectorAll(`[data-perm="${kind}"][data-role="${role}"]`).forEach((x) => { x.checked = c.checked; });
      }));
      box.querySelectorAll(".perm-save").forEach((b) => b.addEventListener("click", saveAllPerms));
      $("newRoleBtn")?.addEventListener("click", createRoleUI);
      box.querySelectorAll("[data-delrole]").forEach((b) => b.addEventListener("click", () => deleteRoleUI(b.dataset.delrole)));
    } catch (e) { box.innerHTML = `<p class="hint">${esc(e.message)}</p>`; }
  }
  async function saveAllPerms() {
    const box = $("permsBody");
    try {
      for (const r of permRoleIds) {
        const views = [...box.querySelectorAll(`[data-perm="view"][data-role="${r}"]:checked`)].map((x) => x.value);
        const exports = [...box.querySelectorAll(`[data-perm="export"][data-role="${r}"]:checked`)].map((x) => x.value);
        await api.saveRolePermissions(r, { views, exports });
      }
      toast("Permisos guardados");
    } catch (e) { toast(e.message); }
  }
  async function createRoleUI() {
    const name = $("newRoleName").value.trim();
    if (!name) return toast("Escribe el nombre del rol");
    try {
      await api.createRole({ name, readonly: $("newRoleRO").checked });
      toast(`Rol "${name}" creado`);
      await loadPermissionsPanel();
    } catch (e) { toast(e.message); }
  }
  async function deleteRoleUI(role) {
    if (!confirm(`¿Borrar el rol "${role}"? (no se puede si hay usuarios con ese rol)`)) return;
    try { await api.deleteRole(role); toast("Rol borrado"); await loadPermissionsPanel(); }
    catch (e) { toast(e.message); }
  }
  // Opciones del desplegable de rol (alta de usuarios): roles existentes + Administrador.
  function roleOptionsHtml(selected) {
    const list = availableRoles.length ? availableRoles : [
      { role: "vendedor", label: "Vendedor" }, { role: "auditor", label: "Auditor" }, { role: "contador", label: "Contador" }
    ];
    return [...list, { role: "admin", label: "Administrador" }]
      .map((r) => `<option value="${esc(r.role)}" ${selected === r.role ? "selected" : ""}>${esc(r.label)}</option>`).join("");
  }
  function renderUserForm(u) {
    $("userFormTitle").textContent = u ? `Editar: ${u.username}` : "Nuevo usuario";
    $("userForm").innerHTML = `
      <div class="form-grid">
        <label class="fld">Usuario<input id="us_username" value="${esc(u?.username || "")}" ${u ? "disabled" : ""} /></label>
        <label class="fld">Nombre<input id="us_name" value="${esc(u?.name || "")}" /></label>
        <label class="fld">Rol
          <select id="us_role">${roleOptionsHtml(u?.role || "vendedor")}</select>
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
