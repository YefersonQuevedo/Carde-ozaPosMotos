// Dispersion del CIERRE DIARIO (no del turno): consolida el dia completo.
//   1) ingresa el efectivo a entregar del dia a CAJA_MENOR (= efectivo - comisiones)
//   2) aparta las comisiones/descuentos del dia en PROV_CONV (provisiones)
//   3) crea/actualiza la cuenta por pagar a Supergiros (Jasper = valor de las RTM) del dia
// Idempotente por refType="closing" + refId=snapshotId: re-cerrar el dia actualiza
// los montos sin duplicar movimientos ni perder los abonos ya hechos al payable.
async function upsertMovement(tx, { boxCode, amount, snapshotId, date, note }) {
  const prev = await tx.cashMovement.findFirst({ where: { refType: "closing", refId: snapshotId, boxCode, type: "ingreso" } });
  if (prev) {
    await tx.cashMovement.update({ where: { id: prev.id }, data: { amount, date } });
  } else if (amount > 0) {
    await tx.cashMovement.create({ data: { boxCode, type: "ingreso", amount, refType: "closing", refId: snapshotId, date, note } });
  }
}

export async function applyDailyDispersion(tx, { snapshotId, closing, date }) {
  const ingreso = Math.max(0, Math.round(closing.efectivoEntregar || 0));
  await upsertMovement(tx, { boxCode: "CAJA_MENOR", amount: ingreso, snapshotId, date, note: `Cierre día ${date} (efectivo a entregar)` });

  // Comisiones/descuentos del dia -> provisiones (para pagar a los referidos).
  const comisiones = Math.max(0, Math.round(closing.deducciones || 0));
  await upsertMovement(tx, { boxCode: "PROV_CONV", amount: comisiones, snapshotId, date, note: `Cierre día ${date} (comisiones/descuentos a provisiones)` });

  const jasper = Math.max(0, Math.round(closing.jasper || 0));
  const prevPay = await tx.payable.findFirst({ where: { refType: "closing", refId: snapshotId } });
  if (prevPay) {
    const paid = prevPay.paidAmount;
    const status = paid <= 0 ? "pendiente" : paid >= jasper ? "pagado" : "parcial";
    await tx.payable.update({ where: { id: prevPay.id }, data: { totalAmount: jasper, status } });
  } else if (jasper > 0) {
    await tx.payable.create({
      data: {
        concept: `Dispersión Supergiros ${date}`, creditor: "SUPERGIROS", category: "dispersion",
        totalAmount: jasper, paidAmount: 0, frequency: "unico", dueDate: date, status: "pendiente",
        refType: "closing", refId: snapshotId, note: "Generada automáticamente al cerrar el día"
      }
    });
  }
  return { ingreso, jasper };
}
