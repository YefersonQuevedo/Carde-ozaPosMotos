// Contexto de empresa (multi-tenant). Cada request corre dentro de un
// AsyncLocalStorage con su companyId (sacado del JWT por auth()); la extension
// de Prisma en db.js lee currentCompanyId() y filtra TODAS las consultas.
// Fuera de un request (scripts, seed) el fallback es la empresa 1 (Certimotos).
import { AsyncLocalStorage } from "node:async_hooks";

const als = new AsyncLocalStorage();

export const currentCompanyId = () => als.getStore()?.companyId ?? 1;

/// Ejecuta fn dentro del contexto de una empresa (para scripts/list por empresa).
export function runWithCompany(companyId, fn) {
  return als.run({ companyId: Number(companyId) || 1 }, fn);
}

/// Middleware Express: envuelve el resto del request en el contexto de la
/// empresa del usuario autenticado (req.companyId lo pone auth()).
export function tenantMiddleware(req, _res, next) {
  als.run({ companyId: Number(req.companyId) || 1 }, next);
}
