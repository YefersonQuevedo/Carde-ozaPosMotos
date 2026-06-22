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
  const ROLE_LABELS = { vendedor: "Vendedor", auditor: "Auditor", contador: "Contador" };
  let permRoleIds = [];
  async function loadPermissionsPanel() {
    const box = $("permsBody");
    if (!box) return;
    try {
      const { panels, exports, roles } = await api.rolePermissions();
      permRoleIds = Object.keys(roles);
      const matrix = (titulo, items, kind) => {
        const head = `<tr><th style="text-align:left;min-width:220px">${esc(titulo)}</th>${permRoleIds.map((r) =>
          `<th style="text-align:center">${esc(ROLE_LABELS[r] || r)}<br><label class="hint" style="font-weight:400;cursor:pointer"><input type="checkbox" data-allcol="${kind}:${r}" /> todos</label></th>`).join("")}</tr>`;
        const body = items.map((it) => {
          const cells = permRoleIds.map((r) => {
            const set = new Set(kind === "view" ? roles[r].views : roles[r].exports);
            return `<td style="text-align:center"><input type="checkbox" data-perm="${kind}" data-role="${r}" value="${esc(it.id)}" ${set.has(it.id) ? "checked" : ""} /></td>`;
          }).join("");
          return `<tr><td>${esc(it.label)}</td>${cells}</tr>`;
        }).join("");
        return `<div style="overflow-x:auto"><table class="data perm-matrix"><thead>${head}</thead><tbody>${body}</tbody></table></div>`;
      };
      const saveBtn = `<button class="btn success perm-save">💾 Guardar permisos</button>`;
      box.innerHTML = `
        <div class="row" style="justify-content:flex-end;margin-bottom:8px">${saveBtn}</div>
        <h3 style="margin:6px 0">Paneles que puede ver cada rol</h3>
        ${matrix("Panel", panels, "view")}
        <h3 style="margin:16px 0 6px">Exports que puede descargar cada rol</h3>
        ${matrix("Export", exports, "export")}
        <div class="row" style="justify-content:flex-end;margin-top:10px">${saveBtn}</div>`;
      // "todos" por columna: marca/desmarca toda la columna de ese rol+tipo.
      box.querySelectorAll("[data-allcol]").forEach((c) => c.addEventListener("change", () => {
        const [kind, role] = c.dataset.allcol.split(":");
        box.querySelectorAll(`[data-perm="${kind}"][data-role="${role}"]`).forEach((x) => { x.checked = c.checked; });
      }));
      box.querySelectorAll(".perm-save").forEach((b) => b.addEventListener("click", saveAllPerms));
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
