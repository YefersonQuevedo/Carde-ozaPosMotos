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

// Roles de fabrica (no se borran). admin = todo y no se configura.
// canWrite = crear/editar (POST/PUT/PATCH); canDelete = eliminar (DELETE). Lectura siempre.
export const BUILTIN_ROLES = {
  vendedor: { label: "Vendedor", canWrite: true, canDelete: true },
  auditor: { label: "Auditor", canWrite: false, canDelete: false },
  contador: { label: "Contador", canWrite: false, canDelete: false }
};
export const isBuiltinRole = (role) => role === "admin" || Object.prototype.hasOwnProperty.call(BUILTIN_ROLES, role);

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
// Devuelve { views, exports, canWrite, canDelete }.
export async function permsForRole(role) {
  if (role === "admin") return { views: ALL_PANELS, exports: ALL_EXPORTS, canWrite: true, canDelete: true, canBackdate: true };
  const row = await prisma.rolePermission.findFirst({ where: { role } });
  if (row) return {
    views: Array.isArray(row.views) ? row.views : [],
    exports: Array.isArray(row.exports) ? row.exports : [],
    canWrite: !!row.canWrite,
    canDelete: !!row.canDelete,
    canBackdate: !!row.canBackdate
  };
  const d = DEFAULT_PERMS[role];
  const b = BUILTIN_ROLES[role];
  return d ? { ...d, canWrite: b ? b.canWrite : true, canDelete: b ? b.canDelete : true, canBackdate: false } : { views: [], exports: [], canWrite: false, canDelete: false, canBackdate: false };
}

// ¿Existe el rol? (admin, built-in, o fila personalizada en BD).
export async function roleExists(role) {
  if (isBuiltinRole(role)) return true;
  const row = await prisma.rolePermission.findFirst({ where: { role }, select: { id: true } });
  return !!row;
}

// Todos los roles configurables: built-in (vendedor/auditor/contador) + personalizados.
export async function allRoles() {
  const rows = await prisma.rolePermission.findMany();
  const byRole = Object.fromEntries(rows.map((r) => [r.role, r]));
  const out = [];
  for (const role of ["vendedor", "auditor", "contador"]) {
    const r = byRole[role], b = BUILTIN_ROLES[role];
    out.push({
      role, label: b.label, builtin: true,
      canWrite: r ? !!r.canWrite : b.canWrite,
      canDelete: r ? !!r.canDelete : b.canDelete,
      canBackdate: r ? !!r.canBackdate : false,
      views: r ? r.views : DEFAULT_PERMS[role].views,
      exports: r ? r.exports : DEFAULT_PERMS[role].exports
    });
  }
  for (const r of rows) {
    if (BUILTIN_ROLES[r.role]) continue;
    out.push({ role: r.role, label: r.label || r.role, builtin: false, canWrite: !!r.canWrite, canDelete: !!r.canDelete, canBackdate: !!r.canBackdate, views: r.views || [], exports: r.exports || [] });
  }
  return out;
}

// export-id de una ruta (sin el prefijo /api). null si no es un export.
export function exportIdFor(path) {
  const e = EXPORTS.find((x) => x.test(path));
  return e ? e.id : null;
}
