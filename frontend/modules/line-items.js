import { $, esc } from "../utils.js";

export function lineRowHtml(kind, row = {}) {
  return `<div class="payrow ${kind}-line">
    <input class="${kind}-desc" placeholder="Descripcion" value="${esc(row.description || "")}" />
    <input class="${kind}-qty" type="number" min="1" value="${row.quantity || 1}" />
    <input class="${kind}-price" inputmode="numeric" placeholder="Valor unitario" value="${row.unitPrice || ""}" />
    <select class="${kind}-tax"><option value="0" ${(row.taxRate || 0) === 0 ? "selected" : ""}>0%</option><option value="19" ${(row.taxRate || 0) === 19 ? "selected" : ""}>19%</option></select>
    <button class="link" type="button" data-delline>quitar</button>
  </div>`;
}
export function wireLineBox(boxId, kind) {
  $(boxId).querySelectorAll("[data-delline]").forEach((b) => b.addEventListener("click", (e) => e.target.closest(".payrow").remove()));
  $(`${kind}AddLine`).onclick = () => {
    $(boxId).insertAdjacentHTML("beforeend", lineRowHtml(kind));
    wireLineBox(boxId, kind);
  };
}
export function readLineBox(kind) {
  return [...document.querySelectorAll(`.${kind}-line`)].map((row) => ({
    description: row.querySelector(`.${kind}-desc`).value.trim(),
    quantity: Number(row.querySelector(`.${kind}-qty`).value) || 1,
    unitPrice: Number(String(row.querySelector(`.${kind}-price`).value).replace(/[^\d]/g, "")) || 0,
    taxRate: Number(row.querySelector(`.${kind}-tax`).value) || 0
  })).filter((l) => l.description && l.unitPrice > 0);
}
