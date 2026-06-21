export const money = (n) => new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 }).format(Math.round(Number(n) || 0));
export const todayIso = () => new Date().toISOString().slice(0, 10);
export const $ = (id) => document.getElementById(id);
export const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
export const readCop = (id) => Math.round(Number(String($(id)?.value || "").replace(/[^\d]/g, "")) || 0);
export const MOTO_PLATE_RE = /^[A-Z]{3}\d{2}[A-Z]$/;
export const PIN_RE = /^\d{19,20}$/; // SICOV: 19 o 20 digitos (el instructivo dice 20)
// Descarga un Blob (export a Excel) como una descarga normal del navegador: así
// aparece en la barra de descargas de Chrome/Edge con la opción "Abrir archivo"
// (no usamos el diálogo "Guardar como" porque ese guarda el archivo sin registrarlo
// como descarga, y el usuario tenía que abrir la carpeta a mano).
export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Modal de confirmacion con la estetica de la app (reemplazo del confirm() nativo del navegador).
// Uso: if (!(await confirmDialog("¿Cerrar el día?", { title, okText, danger: true }))) return;
export function confirmDialog(message, { title = "Confirmar", okText = "Aceptar", cancelText = "Cancelar", danger = false } = {}) {
  return new Promise((resolve) => {
    const prev = document.getElementById("appConfirmOverlay");
    if (prev) prev.remove();
    const ov = document.createElement("div");
    ov.id = "appConfirmOverlay";
    ov.style.cssText = "position:fixed;inset:0;background:rgba(15,23,42,.45);display:flex;align-items:center;justify-content:center;z-index:9999;backdrop-filter:blur(2px)";
    ov.innerHTML = `
      <div style="background:#fff;border-radius:14px;box-shadow:0 18px 50px rgba(0,0,0,.25);max-width:440px;width:92%;padding:22px 24px" role="dialog" aria-modal="true">
        <h3 style="margin:0 0 10px;font-size:1.05rem">${danger ? "⚠️ " : ""}${esc(title)}</h3>
        <p style="margin:0 0 18px;color:#475569;line-height:1.5;white-space:pre-line">${esc(message)}</p>
        <div style="display:flex;gap:10px;justify-content:flex-end">
          <button class="btn ghost" data-act="cancel">${esc(cancelText)}</button>
          <button class="btn ${danger ? "danger" : "success"}" data-act="ok">${esc(okText)}</button>
        </div>
      </div>`;
    const done = (val) => { ov.remove(); document.removeEventListener("keydown", onKey); resolve(val); };
    const onKey = (e) => { if (e.key === "Escape") done(false); if (e.key === "Enter") done(true); };
    ov.addEventListener("click", (e) => { if (e.target === ov) done(false); });
    ov.querySelector('[data-act="ok"]').addEventListener("click", () => done(true));
    ov.querySelector('[data-act="cancel"]').addEventListener("click", () => done(false));
    document.addEventListener("keydown", onKey);
    document.body.appendChild(ov);
    ov.querySelector('[data-act="ok"]').focus();
  });
}

export function moduleStub(container, { title, owner, items }) {
  if (!container) return;
  container.innerHTML = `<div class="card">
    <div class="card-head"><h2>${esc(title)}</h2><div class="pill">${esc(owner)}</div></div>
    <p class="hint">Modulo en construccion. Pendientes:</p>
    <ul class="hint">${items.map((i) => `<li>${esc(i)}</li>`).join("")}</ul>
  </div>`;
}
