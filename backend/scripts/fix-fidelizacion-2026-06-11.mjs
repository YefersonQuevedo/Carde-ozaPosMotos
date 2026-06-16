// Reparacion 2026-06-11: las ventas DIRECTAS (usuario) llevaban una deduccion fija de
// fidelizacion ($20.000) automatica, aunque no hubiera cupon. Nueva regla: la venta directa
// no lleva descuento salvo cupon explicito (DESCUENTO_FENIX).
// 1) Pone deduction=0 / discountApplied=false en las ventas directas SIN cupon.
// 2) Re-dispersa los cierres congelados (actualiza PROV_CONV y CAJA_MENOR).
import { prisma } from "../src/db.js";
import { gatherDay } from "../src/services/dayAudit.js";
import { applyDailyDispersion } from "../src/services/dispersion.js";

async function main() {
  // Ventas directas con cupon (DESCUENTO_FENIX) ya tienen deduction=0; no se tocan.
  // El resto de ventas directas pierde la deduccion automatica de fidelizacion.
  const directos = await prisma.sale.findMany({ where: { allyType: "usuario", deduction: { gt: 0 } }, select: { id: true, saleNumber: true, deduction: true } });
  for (const s of directos) {
    await prisma.sale.update({ where: { id: s.id }, data: { deduction: 0, discountApplied: false } });
    console.log(`✓ Venta ${s.saleNumber}: deduccion ${s.deduction} -> 0 (venta directa sin cupon)`);
  }
  if (!directos.length) console.log("· No habia ventas directas con deduccion automatica");

  // Re-dispersar cada cierre congelado: recalcula deducciones (PROV_CONV) y efectivo (CAJA_MENOR).
  const closings = await prisma.dailyClosing.findMany();
  for (const snap of closings) {
    const date = snap.closingDate;
    const { closing } = await gatherDay(date, 0);
    await prisma.$transaction(async (tx) => {
      await tx.dailyClosing.update({
        where: { closingDate: date },
        data: {
          salesTotal: closing.salesTotal, byMethod: closing.byMethod, provision: closing.provision,
          receivableOpen: closing.receivableOpen, jasperEstimado: closing.jasper,
          deducciones: closing.deducciones, cajaEfectivo: closing.cajaEfectivo
        }
      });
      await applyDailyDispersion(tx, { snapshotId: snap.id, closing, date });
    });
    console.log(`✓ Re-dispersado ${date}: deducciones=${closing.deducciones}, efectivoEntregar=${closing.efectivoEntregar}, jasper=${closing.jasper}`);
  }
  console.log("Listo.");
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
