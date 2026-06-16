// Reparacion 2026-06-11: pagos de convenios.
// 1) Agrega columnas status/editedAt a ally_payments (trazabilidad anulado/modificado).
// 2) Corrige los movimientos de caja erroneos: el pago de convenio se registro como
//    INGRESO a PROV_CONV cuando debia ser EGRESO (el dinero sale de la provision).
// Uso:  node scripts/fix-convenios-2026-06-11.mjs   (con el backend detenido o andando, da igual)
import { prisma } from "../src/db.js";

async function columnExists(table, column) {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT COUNT(*) AS n FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    table, column
  );
  return Number(rows[0]?.n || 0) > 0;
}

async function main() {
  // 1) Columnas nuevas (equivalente a `npx prisma db push` para AllyPayment).
  if (!(await columnExists("ally_payments", "status"))) {
    await prisma.$executeRawUnsafe(
      "ALTER TABLE ally_payments ADD COLUMN status VARCHAR(191) NOT NULL DEFAULT 'activa'"
    );
    console.log("✓ Columna ally_payments.status creada");
  } else console.log("· ally_payments.status ya existe");

  if (!(await columnExists("ally_payments", "editedAt"))) {
    await prisma.$executeRawUnsafe(
      "ALTER TABLE ally_payments ADD COLUMN editedAt DATETIME(3) NULL"
    );
    console.log("✓ Columna ally_payments.editedAt creada");
  } else console.log("· ally_payments.editedAt ya existe");

  // 2) Movimientos erroneos: ingreso -> egreso (solo los de pagos de convenios).
  const wrong = await prisma.cashMovement.findMany({
    where: { refType: "ally_payment", type: "ingreso" }
  });
  for (const m of wrong) {
    await prisma.cashMovement.update({
      where: { id: m.id },
      data: { type: "egreso", note: `${m.note || ""} (corregido: era ingreso por error)`.trim() }
    });
    console.log(`✓ Movimiento #${m.id} (${m.boxCode} $${m.amount}) corregido: ingreso -> egreso`);
  }
  if (!wrong.length) console.log("· No habia movimientos erroneos de pagos de convenios");

  console.log("Listo.");
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
