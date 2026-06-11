export const money = (n) => new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 }).format(Math.round(Number(n) || 0));
export const todayIso = () => new Date().toISOString().slice(0, 10);
export const $ = (id) => document.getElementById(id);
export const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
export const readCop = (id) => Math.round(Number(String($(id)?.value || "").replace(/[^\d]/g, "")) || 0);
export const MOTO_PLATE_RE = /^[A-Z]{3}\d{2}[A-Z]$/;
export const PIN_RE = /^\d{19}$/;
// Descarga un Blob (export a Excel). Si el navegador lo soporta (Chrome/Edge),
// abre el dialogo "Guardar como" para elegir la carpeta; si no, descarga normal.
export async function downloadBlob(blob, filename) {
  if (window.showSaveFilePicker) {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: filename,
        types: [{ description: "Excel", accept: { "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [".xlsx"] } }]
      });
      const w = await handle.createWritable();
      await w.write(blob);
      await w.close();
      return;
    } catch (e) {
      if (e && e.name === "AbortError") return; // el usuario cancelo el dialogo
      // Otro error (p.ej. gesto expirado): cae a la descarga clasica.
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function moduleStub(container, { title, owner, items }) {
  if (!container) return;
  container.innerHTML = `<div class="card">
    <div class="card-head"><h2>${esc(title)}</h2><div class="pill">${esc(owner)}</div></div>
    <p class="hint">Modulo en construccion. Pendientes:</p>
    <ul class="hint">${items.map((i) => `<li>${esc(i)}</li>`).join("")}</ul>
  </div>`;
}
