// Limpieza de datos de PRUEBA de un dia (ventas + turnos + cierre + dispersion).
// Uso: node scripts/clean-test-day.mjs 2026-06-11
import { prisma } from "../src/db.js";

const date = process.argv[2];
if (!date) { console.error("Falta la fecha YYYY-MM-DD"); process.exit(1); }

const sales = await prisma.sale.findMany({ where: { saleDate: date } });
const saleIds = sales.map((s) => s.id);
console.log(`Ventas del ${date}:`, saleIds);

await prisma.$transaction(async (tx) => {
  if (saleIds.length) {
    await tx.saleLine.deleteMany({ where: { saleId: { in: saleIds } } });
    await tx.salePayment.deleteMany({ where: { saleId: { in: saleIds } } });
    await tx.saleCost.deleteMany({ where: { saleId: { in: saleIds } } });
    await tx.clientHistory.deleteMany({ where: { saleId: { in: saleIds } } });
    await tx.reversal.deleteMany({ where: { saleId: { in: saleIds } } });
    await tx.receivable.deleteMany({ where: { saleId: { in: saleIds } } });
    await tx.invoice.deleteMany({ where: { saleId: { in: saleIds } } });
    await tx.cashMovement.deleteMany({ where: { refType: "sale", refId: { in: saleIds } } });
    await tx.sale.deleteMany({ where: { id: { in: saleIds } } });
  }

  const shifts = await tx.shift.deleteMany({ where: { businessDate: date } });
  console.log("Turnos borrados:", shifts.count);

  const snap = await tx.dailyClosing.findUnique({ where: { closingDate: date } });
  if (snap) {
    const payables = await tx.payable.findMany({ where: { refType: "closing", refId: snap.id } });
    for (const p of payables) {
      const pays = await tx.payablePayment.findMany({ where: { payableId: p.id } });
      await tx.cashMovement.deleteMany({ where: { refType: "payable_payment", refId: { in: pays.map((x) => x.id) } } });
      await tx.cashMovement.deleteMany({ where: { refType: { in: ["payable", "payable_void"] }, refId: p.id } });
      await tx.payablePayment.deleteMany({ where: { payableId: p.id } });
      await tx.payable.delete({ where: { id: p.id } });
    }
    await tx.cashMovement.deleteMany({ where: { refType: "closing", refId: snap.id } });
    await tx.dailyClosing.delete({ where: { id: snap.id } });
    console.log("Cierre + dispersion del dia borrados (snapshot", snap.id + ")");
  } else {
    console.log("No habia cierre del dia");
  }
});

const movs = await prisma.cashMovement.findMany({ where: { date } });
console.log(`Movimientos de caja restantes con fecha ${date}:`, movs.map((m) => [m.id, m.boxCode, m.type, m.amount, m.refType]));
await prisma.$disconnect();
