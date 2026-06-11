// Utilidades de caja. Saldo de una caja = Σ ingresos − Σ egresos de sus CashMovement.
import { prisma } from "../db.js";

// Saldo de una sola caja. Acepta un cliente Prisma (tx) para usar dentro de transacciones.
export async function boxBalance(boxCode, client = prisma) {
  const rows = await client.cashMovement.groupBy({
    by: ["type"], where: { boxCode: String(boxCode) }, _sum: { amount: true }
  });
  return rows.reduce((bal, r) => bal + (r.type === "ingreso" ? 1 : -1) * (r._sum.amount || 0), 0);
}
