import { Router } from "express";
import { prisma } from "../db.js";
import { toWorkbook, sendXlsx } from "../services/excel.js";

const router = Router();

const MESES = ["ENERO", "FEBRERO", "MARZO", "ABRIL", "MAYO", "JUNIO", "JULIO", "AGOSTO", "SEPTIEMBRE", "OCTUBRE", "NOVIEMBRE", "DICIEMBRE"];

// Clave estable: allyId si existe, si no el nombre (compatibilidad con datos viejos).
const allyKey = (allyId, allyName) => (allyId != null ? `id:${allyId}` : `nm:${allyName}`);
const today = () => new Date().toISOString().slice(0, 10);
const toInt = (value) => Math.max(0, Math.round(Number(value) || 0));
const asList = (value) => Array.isArray(value) ? value.filter(Boolean) : [];

async function nextManualInvoiceNumber(tx) {
  const count = await tx.manualInvoice.count();
  return `MAN-${String(count + 1).padStart(4, "0")}`;
}

// Devengado por convenio = suma de comisiones (deduction) en ventas de referidos.
async function accruedByAlly() {
  const sales = await prisma.sale.findMany({
    where: { allyType: "referido", deduction: { gt: 0 }, status: "activa" },
    select: { allyId: true, allyName: true, deduction: true, pinAdquirido: true, plate: true }
  });
  const map = {};
  for (const s of sales) {
    const k = allyKey(s.allyId, s.allyName);
    const m = (map[k] ||= { allyId: s.allyId ?? null, allyName: s.allyName, accrued: 0, rtm: 0, plates: new Set() });
    m.accrued += s.deduction;
    if (s.pinAdquirido > 0) m.rtm += 1;
    if (s.plate) m.plates.add(s.plate);
  }
  return map;
}

async function paidByAlly() {
  // Solo pagos activos: los anulados quedan en el historial pero no suman.
  const pays = await prisma.allyPayment.findMany({ where: { status: "activa" }, select: { allyId: true, allyName: true, amount: true } });
  const map = {};
  for (const p of pays) {
    const k = allyKey(p.allyId, p.allyName);
    const m = (map[k] ||= { allyId: p.allyId ?? null, allyName: p.allyName, paid: 0 });
    m.paid += p.amount;
  }
  return map;
}

// GET /api/ally-payments  -> reporte: devengado / pagado / pendiente por convenio.
router.get("/", async (_req, res, next) => {
  try {
    const accrued = await accruedByAlly();
    const paid = await paidByAlly();
    const keys = new Set([...Object.keys(accrued), ...Object.keys(paid)]);
    const items = [...keys]
      .map((k) => {
        const a = accrued[k];
        const p = paid[k];
        const acc = a?.accrued || 0;
        const paidV = p?.paid || 0;
        return {
          allyId: a?.allyId ?? p?.allyId ?? null,
          allyName: a?.allyName ?? p?.allyName ?? "",
          accrued: acc,
          rtm: a?.rtm || 0,
          convenioCount: a?.rtm || 0,
          plateCount: a?.plates?.size || 0,
          paid: paidV,
          pending: acc - paidV
        };
      })
      .sort((x, y) => y.pending - x.pending);
    const totals = items.reduce(
      (t, i) => ({ accrued: t.accrued + i.accrued, paid: t.paid + i.paid, pending: t.pending + i.pending }),
      { accrued: 0, paid: 0, pending: 0 }
    );
    res.json({ items, totals });
  } catch (e) {
    next(e);
  }
});

// GET /api/ally-payments/referidos/export?year=  -> Reporte Referidos EN EL FORMATO
// DEL CLIENTE (hoja "Reporte Referidos"): una fila por referido con el conteo de
// placas por mes, total del año, placas con RTM pendiente y # pendientes.
// (Va antes de /:name para no chocar con esa ruta.)
router.get("/referidos/export", async (req, res, next) => {
  try {
    const year = String(req.query.year || new Date().getFullYear());
    const sales = await prisma.sale.findMany({
      where: { allyType: "referido", status: "activa", saleDate: { gte: `${year}-01-01`, lte: `${year}-12-31` } },
      select: { allyName: true, saleDate: true, plate: true, pinAdquirido: true }
    });
    const map = {};
    for (const s of sales) {
      const name = s.allyName || "SIN REFERIDO";
      const m = (map[name] ||= { referido: name, months: Array(12).fill(0), total: 0, pendientes: [] });
      const mi = Number(s.saleDate.slice(5, 7)) - 1;
      if (mi >= 0 && mi < 12) m.months[mi] += 1;
      m.total += 1;
      // Pendiente = placa SIN PIN adquirido (RTM aún no realizada), igual que el cliente.
      if (!s.pinAdquirido && s.plate) m.pendientes.push(s.plate);
    }
    const list = Object.values(map).sort((a, b) => a.referido.localeCompare(b.referido, "es"));
    const rows = list.map((r) => {
      const row = { referido: r.referido, total: r.total, placasPend: r.pendientes.join(", "), nPend: r.pendientes.length };
      r.months.forEach((v, i) => { row["m" + i] = v || ""; });
      return row;
    });
    const totals = { total: list.reduce((a, r) => a + r.total, 0), nPend: list.reduce((a, r) => a + r.pendientes.length, 0) };
    MESES.forEach((_, i) => { totals["m" + i] = list.reduce((a, r) => a + r.months[i], 0); });
    const columns = [
      { header: "REFERIDO", key: "referido", width: 28 },
      ...MESES.map((mName, i) => ({ header: mName, key: "m" + i, width: 11, number: true })),
      { header: "TOTAL", key: "total", width: 10, number: true },
      { header: "PLACAS PENDIENTES (sin PIN)", key: "placasPend", width: 32 },
      { header: "# PENDIENTES", key: "nPend", width: 13, number: true }
    ];
    const buf = await toWorkbook({
      sheets: [{ name: "Reporte Referidos", title: `REPORTE REFERIDOS — Placas por mes ${year}`, columns, rows, totals }]
    });
    sendXlsx(res, buf, `referidos-${year}.xlsx`);
  } catch (e) {
    next(e);
  }
});

// GET /api/ally-payments/:name  -> detalle de un convenio (ventas + pagos).
router.get("/:name", async (req, res, next) => {
  try {
    const name = req.params.name;
    const [ally, salesRaw, payments] = await Promise.all([
      prisma.ally.findFirst({ where: { name } }),
      prisma.sale.findMany({
        where: { allyName: name, allyType: "referido", deduction: { gt: 0 }, status: "activa" },
        select: { id: true, saleNumber: true, saleDate: true, plate: true, clientDoc: true, clientName: true, invoiceNumber: true, deduction: true, pinAdquirido: true, commissionPaidBy: true },
        orderBy: { saleDate: "desc" }
      }),
      prisma.allyPayment.findMany({ where: { allyName: name }, orderBy: { paidDate: "desc" } })
    ]);
    // Cada comision queda enlazada al pago que la cubrio (commissionPaidBy) -> estado + comprobante.
    const payById = Object.fromEntries(payments.map((p) => [p.id, p]));
    const sales = salesRaw.map((s) => {
      const pay = s.commissionPaidBy != null ? payById[s.commissionPaidBy] : null;
      return {
        ...s,
        paid: !!pay,
        paymentId: pay?.id ?? null,
        paidDate: pay?.paidDate ?? null,
        voucherPath: pay?.voucherPath ?? null,
        paidInvoice: pay?.invoiceNumber ?? null
      };
    });
    const accrued = sales.reduce((s, v) => s + v.deduction, 0);
    const paid = payments.filter((p) => p.status !== "anulada").reduce((s, v) => s + v.amount, 0);
    const accruedPaid = sales.filter((s) => s.paid).reduce((s, v) => s + v.deduction, 0);
    const plates = [...new Set(sales.map((s) => s.plate).filter(Boolean))];
    res.json({
      ally,
      allyName: name,
      accrued,
      paid,
      pending: accrued - paid,
      accruedPaid,
      accruedPending: accrued - accruedPaid,
      convenioCount: sales.length,
      plates,
      sales,
      payments
    });
  } catch (e) {
    next(e);
  }
});

// POST /api/ally-payments  -> registrar un pago a un convenio.
router.post("/", async (req, res, next) => {
  try {
    const b = req.body || {};
    const amount = toInt(b.amount);
    if (!b.allyName || amount <= 0) return res.status(400).json({ error: "allyName y amount son obligatorios" });

    const ally = b.allyId
      ? await prisma.ally.findUnique({ where: { id: Number(b.allyId) } })
      : await prisma.ally.findFirst({ where: { name: String(b.allyName) } });
    const plates = asList(b.plates);
    const convenioCount = toInt(b.convenioCount) || plates.length;
    const shouldInvoice = !!b.manualInvoice;
    const invoiceDoc = String(b.invoiceDoc || ally?.docNumber || ally?.holderDoc || "").trim();
    const invoiceName = String(b.invoiceName || ally?.name || b.allyName).trim();
    const paidDate = b.paidDate || today();

    if (shouldInvoice && !invoiceDoc) {
      return res.status(400).json({ error: "Para facturar a cedula/NIT falta el documento del convenio" });
    }

    const result = await prisma.$transaction(async (tx) => {
      let invoiceNumber = String(b.invoiceNumber || "").trim() || null;
      let manualInvoice = null;
      if (shouldInvoice) {
        invoiceNumber = await nextManualInvoiceNumber(tx);
        manualInvoice = await tx.manualInvoice.create({
          data: {
            number: invoiceNumber,
            clientDoc: invoiceDoc,
            clientName: invoiceName,
            date: paidDate,
            concept: `Comisiones convenio ${b.allyName}`,
            base: amount,
            iva: 0,
            total: amount,
            source: "convenio"
          }
        });
        await tx.manualInvoiceLine.create({
          data: {
            invoiceId: manualInvoice.id,
            description: `Comisiones convenio ${b.allyName}`,
            quantity: convenioCount || 1,
            unitPrice: convenioCount > 0 ? Math.round(amount / convenioCount) : amount,
            taxRate: 0,
            base: amount,
            tax: 0,
            total: amount
          }
        });
      }

      const payment = await tx.allyPayment.create({
        data: {
          allyId: b.allyId ? Number(b.allyId) : ally?.id ?? null,
          allyName: b.allyName,
          amount,
          paidDate,
          note: b.note || null,
          voucherPath: b.voucherPath || null,
          invoiceNumber,
          plates,
          convenioCount
        }
      });

      // Enlaza las comisiones cubiertas por este pago (estado "pagada" + comprobante).
      // Si el front manda saleNumbers, marca esas; si no, marca TODAS las pendientes del convenio.
      const saleNumbers = asList(b.saleNumbers);
      const markWhere = {
        allyName: b.allyName, allyType: "referido", deduction: { gt: 0 }, status: "activa",
        commissionPaidBy: null,
        ...(saleNumbers.length ? { saleNumber: { in: saleNumbers } } : {})
      };
      await tx.sale.updateMany({ where: markWhere, data: { commissionPaidBy: payment.id } });

      // El dinero para pagar convenios SALE de la provision de convenios
      // (PROV_CONV recibe sus ingresos en el cierre del dia, no aqui).
      if (b.sendToProvision !== false) {
        await tx.cashMovement.create({
          data: {
            boxCode: "PROV_CONV",
            type: "egreso",
            amount,
            refType: "ally_payment",
            refId: payment.id,
            date: paidDate,
            note: `Pago convenio ${b.allyName}`
          }
        });
      }

      return { payment, manualInvoice };
    });
    res.status(201).json(result);
  } catch (e) {
    next(e);
  }
});

// Reversa los movimientos de caja de un pago (crea el movimiento contrario, nada se borra).
async function reverseMovements(tx, paymentId, reason) {
  const movs = await tx.cashMovement.findMany({ where: { refType: "ally_payment", refId: paymentId } });
  const reversed = movs.filter((m) => m.refType === "ally_payment");
  // Resta las reversas ya hechas para no duplicar.
  const voids = await tx.cashMovement.findMany({ where: { refType: { in: ["ally_payment_void", "ally_payment_edit"] }, refId: paymentId } });
  const net = {};
  for (const m of movs) net[m.boxCode] = (net[m.boxCode] || 0) + (m.type === "egreso" ? -m.amount : m.amount);
  for (const m of voids) net[m.boxCode] = (net[m.boxCode] || 0) + (m.type === "egreso" ? -m.amount : m.amount);
  for (const [boxCode, saldo] of Object.entries(net)) {
    if (!saldo) continue;
    await tx.cashMovement.create({
      data: {
        boxCode,
        type: saldo < 0 ? "ingreso" : "egreso",
        amount: Math.abs(saldo),
        refType: reason,
        refId: paymentId,
        date: today(),
        note: `${reason === "ally_payment_void" ? "Reversa por anulacion" : "Reversa por edicion"} pago convenio #${paymentId}`
      }
    });
  }
  return reversed.length > 0 || voids.length > 0;
}

// PUT /api/ally-payments/:id  -> editar un pago (queda marcado como modificado).
router.put("/:id", async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const b = req.body || {};
    const prev = await prisma.allyPayment.findUnique({ where: { id } });
    if (!prev) return res.status(404).json({ error: "Pago no encontrado" });
    if (prev.status === "anulada") return res.status(400).json({ error: "El pago esta anulado: no se puede editar" });
    const amount = b.amount != null ? toInt(b.amount) : prev.amount;
    if (amount <= 0) return res.status(400).json({ error: "Valor invalido" });
    const paidDate = b.paidDate || prev.paidDate;

    const payment = await prisma.$transaction(async (tx) => {
      const hadMovement = await reverseMovements(tx, id, "ally_payment_edit");
      if (hadMovement) {
        // Registra el egreso nuevo con el valor/fecha corregidos.
        await tx.cashMovement.create({
          data: { boxCode: "PROV_CONV", type: "egreso", amount, refType: "ally_payment", refId: id, date: paidDate, note: `Pago convenio ${prev.allyName} (editado)` }
        });
      }
      return tx.allyPayment.update({
        where: { id },
        data: {
          amount,
          paidDate,
          note: b.note !== undefined ? (b.note || null) : prev.note,
          voucherPath: b.voucherPath !== undefined ? (b.voucherPath || prev.voucherPath) : prev.voucherPath,
          invoiceNumber: b.invoiceNumber !== undefined ? (b.invoiceNumber || null) : prev.invoiceNumber,
          editedAt: new Date()
        }
      });
    });
    res.json({ payment });
  } catch (e) {
    next(e);
  }
});

// DELETE /api/ally-payments/:id  -> ANULA el pago (queda trackeado, no se borra):
// libera sus comisiones y devuelve el dinero a la provision con una reversa.
router.delete("/:id", async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const prev = await prisma.allyPayment.findUnique({ where: { id } });
    if (!prev) return res.status(404).json({ error: "Pago no encontrado" });
    if (prev.status === "anulada") return res.status(400).json({ error: "El pago ya esta anulado" });
    await prisma.$transaction(async (tx) => {
      // Las comisiones que cubria vuelven a "pendiente".
      await tx.sale.updateMany({ where: { commissionPaidBy: id }, data: { commissionPaidBy: null } });
      // El dinero vuelve a PROV_CONV (movimiento contrario, nada se borra).
      await reverseMovements(tx, id, "ally_payment_void");
      await tx.allyPayment.update({ where: { id }, data: { status: "anulada", editedAt: new Date() } });
    });
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

export default router;
