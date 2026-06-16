import { prisma } from "../db.js";
import { gatherDay, gatherShift } from "./dayAudit.js";
import { applyDailyDispersion } from "./dispersion.js";

function closingData(date, closing, previous = {}) {
  return {
    closingDate: date,
    salesTotal: closing.salesTotal,
    byMethod: closing.byMethod,
    provision: closing.provision,
    receivableOpen: closing.receivableOpen,
    jasperEstimado: closing.jasper,
    deducciones: closing.deducciones,
    cajaEfectivo: closing.cajaEfectivo,
    responsable: previous.responsable || null,
    recibe: previous.recibe || null
  };
}

export async function refreshShiftSnapshot(shiftId) {
  if (!shiftId) return null;
  const shift = await prisma.shift.findUnique({ where: { id: Number(shiftId) } });
  if (!shift || shift.status !== "cerrado") return shift;

  const { closing } = await gatherShift(shift.id);
  const expectedCash = Math.max(0, Math.round(closing.efectivoEntregar || 0));
  const cashDiff = shift.countedCash != null ? shift.countedCash - expectedCash : 0;
  return prisma.shift.update({
    where: { id: shift.id },
    data: {
      expectedCash,
      cashDiff,
      salesTotal: Math.round(closing.salesTotal || 0),
      jasper: Math.round(closing.jasper || 0),
      provision: Math.round(closing.provision || 0)
    }
  });
}

export async function refreshDailyClosingIfExists(date) {
  if (!date) return null;
  const previous = await prisma.dailyClosing.findFirst({ where: { closingDate: String(date) } });
  if (!previous) return null;

  const { closing } = await gatherDay(String(date), 0);
  return prisma.$transaction(async (tx) => {
    const snapshot = await tx.dailyClosing.update({
      where: { id: previous.id },
      data: closingData(String(date), closing, previous)
    });
    await applyDailyDispersion(tx, { snapshotId: snapshot.id, closing, date: String(date) });
    return snapshot;
  });
}

export async function refreshAfterSaleChange(sale) {
  if (!sale) return;
  await refreshShiftSnapshot(sale.shiftId);
  await refreshDailyClosingIfExists(sale.saleDate);
}

