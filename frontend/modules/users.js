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
