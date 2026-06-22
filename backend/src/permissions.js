// Permisos por ROL: catalogo de paneles (views) y de exports configurables, los
// defaults cuando un rol no tiene fila, y helpers para resolver/identificar permisos.
import { prisma } from "./db.js";

// Paneles del menu que se pueden permitir/denegar por rol.
export const PANELS = [
  { id: "simple", label: "Vista simple" },
  { id: "venta", label: "Facturar (nueva venta)" },
  { id: "ventas", label: "Ventas hechas" },
  { id: "cierre", label: "Cierre del día" },
  { id: "payables", label: "Caja" },
  { id: "obligaciones", label: "Obligaciones / por pagar" },
  { id: "provisiones", label: "Provisiones" },
  { id: "ingresos", label: "Ingresos" },
  { id: "gastos", label: "Gastos" },
  { id: "cartera", label: "Cartera (por cobrar)" },
  { id: "pagoconv", label: "Convenios" },
  { id: "clientes", label: "Clientes" },
  { id: "llamadas", label: "Llamadas RTM" },
  { id: "dashboard", label: "Dashboard" },
  { id: "consolidado", label: "Consolidado" },
  { id: "fupa", label: "Pines / FUPA" },
  { id: "facturaelec", label: "Factura electrónica" },
  { id: "proveedores", label: "Proveedores" },
  { id: "dian", label: "DIAN" },
  { id: "nomina", label: "Nómina" }
];

// Exports (descargas Excel), con el patron de ruta (sin /api) que los identifica.
export const EXPORTS = [
  { id: "ventas", label: "Ventas (Ventas hechas)", test: (p) => p === "/sales/export" },
  { id: "cierre", label: "Cierre del día (resumen+detalle)", test: (p) => p === "/closings/export" },
  { id: "detalle-dia", label: "Detalle del día (auditable)", test: (p) => p === "/closings/detail/export" },
  { id: "consolidado", label: "Consolidado (resumen)", test: (p) => p === "/closings/report/export" },
  { id: "consolidado-detalle", label: "Consolidado detallado", test: (p) => p === "/closings/report/detail/export" },
  { id: "movimientos-caja", label: "Movimientos de caja / planilla", test: (p) => p === "/provisions/ledger/export" },
  { id: "rtm-pendientes", label: "RTM pendientes", test: (p) => p === "/provisions/export" },
  { id: "ingresos", label: "Ingresos", test: (p) => p === "/income/export" },
  { id: "gastos", label: "Gastos", test: (p) => p === "/expenses/export" },
  { id: "naturalezas", label: "Naturalezas", test: (p) => p === "/expenses/natures/report/export" },
  { id: "referidos", label: "Reporte referidos", test: (p) => p === "/ally-payments/referidos/export" },
  { id: "por-pagar", label: "Cuentas por pagar", test: (p) => p === "/payables/export" },
  { id: "cartera", label: "Cartera", test: (p) => p === "/receivables/export" },
  { id: "turnos", label: "Turnos", test: (p) => p === "/shifts/export" },
  { id: "dashboard", label: "Dashboard", test: (p) => p === "/dashboard/export" },
  { id: "facturas-proveedor", label: "Facturas de proveedor", test: (p) => p.startsWith("/suppliers/") && p.endsWith("/export") },
  { id: "ordenes-compra", label: "Órdenes de compra", test: (p) => p === "/purchase-orders/export" },
  { id: "facturas-manuales", label: "Facturas manuales", test: (p) => p === "/manual-invoices/export" },
  { id: "llamadas", label: "Llamadas / vencimientos", test: (p) => p.startsWith("/calls/") && p.endsWith("/export") },
  { id: "clientes-reporte", label: "Clientes (directo/referido)", test: (p) => p === "/clients/reports/directo-referido/export" },
  { id: "fupa", label: "FUPA / pines", test: (p) => p === "/fupa/export" },
  { id: "dian", label: "DIAN", test: (p) => p === "/dian/export" }
];

const ALL_PANELS = PANELS.map((p) => p.id);
const ALL_EXPORTS = EXPORTS.map((e) => e.id);

// Roles configurables (admin siempre tiene todo y no se guarda).
export const CONFIGURABLE_ROLES = ["vendedor", "auditor", "contador"];

// Permisos por defecto cuando un rol no tiene fila configurada.
export const DEFAULT_PERMS = {
  admin: { views: ALL_PANELS, exports: ALL_EXPORTS },
  auditor: { views: ALL_PANELS, exports: ALL_EXPORTS },
  contador: { views: ["facturaelec", "dian", "gastos"], exports: ["gastos", "dian"] },
  vendedor: {
    views: ["simple", "venta", "ventas", "cierre", "payables", "cartera", "pagoconv", "clientes", "llamadas", "consolidado", "facturaelec"],
    exports: ["detalle-dia", "movimientos-caja"]
  }
};

// Permisos efectivos de un rol: fila en BD si existe, si no los defaults.
export async function permsForRole(role) {
  if (role === "admin") return { views: ALL_PANELS, exports: ALL_EXPORTS };
  const row = await prisma.rolePermission.findFirst({ where: { role } });
  if (row) return { views: Array.isArray(row.views) ? row.views : [], exports: Array.isArray(row.exports) ? row.exports : [] };
  return DEFAULT_PERMS[role] || { views: [], exports: [] };
}

// export-id de una ruta (sin el prefijo /api). null si no es un export.
export function exportIdFor(path) {
  const e = EXPORTS.find((x) => x.test(path));
  return e ? e.id : null;
}
