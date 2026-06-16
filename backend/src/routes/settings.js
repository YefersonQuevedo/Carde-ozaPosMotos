// Panel de configuracion: notificaciones (correo, Telegram, WhatsApp).
// La config DIAN/apidian vive en /api/dian/config; aqui van los canales de aviso.
import { Router } from "express";
import { prisma } from "../db.js";
import { currentCompanyId } from "../tenant.js";
import { sendTelegram, sendEmail, sendWhatsapp } from "../services/notify.js";
import { auth } from "../auth.js";

const router = Router();

// Config de notificaciones de LA EMPRESA del request (una fila por empresa).
async function getNotif() {
  let cfg = await prisma.notificationConfig.findFirst();
  if (!cfg) cfg = await prisma.notificationConfig.create({ data: {} });
  return cfg;
}

// GET /api/settings/notifications
router.get("/notifications", async (_req, res, next) => {
  try {
    res.json(await getNotif());
  } catch (e) {
    next(e);
  }
});

// PUT /api/settings/notifications
router.put("/notifications", async (req, res, next) => {
  try {
    const b = req.body || {};
    const data = {
      emailEnabled: !!b.emailEnabled, emailApiUrl: b.emailApiUrl ?? null, emailFrom: b.emailFrom ?? null,
      telegramEnabled: !!b.telegramEnabled, telegramBotToken: b.telegramBotToken ?? null, telegramChatId: b.telegramChatId ?? null,
      whatsappEnabled: !!b.whatsappEnabled, whatsappApiUrl: b.whatsappApiUrl ?? null, whatsappToken: b.whatsappToken ?? null, whatsappPhoneId: b.whatsappPhoneId ?? null
    };
    const cfg = await prisma.notificationConfig.upsert({ where: { companyId: currentCompanyId() }, update: data, create: data });
    res.json(cfg);
  } catch (e) {
    next(e);
  }
});

// POST /api/settings/notifications/test  { channel: telegram|email|whatsapp, to? }
router.post("/notifications/test", async (req, res, next) => {
  try {
    const channel = String(req.body?.channel || "");
    const to = req.body?.to || "";
    const cfg = await getNotif();
    const msg = "✅ Prueba de notificacion desde MotoPOS.";
    if (channel === "telegram") {
      const r = await sendTelegram({ botToken: cfg.telegramBotToken, chatId: to || cfg.telegramChatId }, msg);
      return res.json({ ok: true, channel, result: r });
    }
    if (channel === "email") {
      const r = await sendEmail({ apiUrl: cfg.emailApiUrl, from: cfg.emailFrom }, { to, subject: "Prueba MotoPOS", message: msg });
      return res.json({ ok: true, channel, result: r });
    }
    if (channel === "whatsapp") {
      const r = await sendWhatsapp({ apiUrl: cfg.whatsappApiUrl, token: cfg.whatsappToken, phoneId: cfg.whatsappPhoneId }, { to, message: msg });
      return res.json({ ok: true, channel, result: r });
    }
    res.status(400).json({ error: "channel debe ser telegram | email | whatsapp" });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

// POST /api/settings/reset-operacional  { confirm: "BORRAR" }
// ZONA PELIGROSA: borra TODA la data operacional (ventas, turnos, cierres, movimientos
// de caja, pagos de convenio, cartera, facturas, ingresos/gastos, cuentas por pagar,
// facturas de proveedor, ordenes de compra, FUPA, llamadas e historial de cliente).
// MANTIENE los maestros y la configuracion: clientes, vehiculos, convenios, proveedores,
// catalogo (productos/paquetes/metodos/naturalezas), tarifas, usuarios, cajas y configs.
// Las cajas quedan en CERO (se borran sus movimientos, no las cajas). Solo admin.
router.post("/reset-operacional", auth(["admin"]), async (req, res, next) => {
  try {
    const confirm = String(req.body?.confirm || "").trim().toUpperCase();
    if (confirm !== "BORRAR") {
      return res.status(400).json({ error: 'Confirmación inválida. Escribe BORRAR (en mayúsculas) para confirmar.' });
    }
    const deleted = await prisma.$transaction(async (tx) => {
      const counts = {};
      const wipe = async (key, fn) => { counts[key] = (await fn()).count; };
      // Ventas y todo lo que cuelga de ellas.
      await wipe("salePayments", () => tx.salePayment.deleteMany());
      await wipe("saleLines", () => tx.saleLine.deleteMany());
      await wipe("saleCosts", () => tx.saleCost.deleteMany());
      await wipe("reversals", () => tx.reversal.deleteMany());
      await wipe("invoices", () => tx.invoice.deleteMany());
      await wipe("sales", () => tx.sale.deleteMany());
      // Turnos y cierres.
      await wipe("shifts", () => tx.shift.deleteMany());
      await wipe("dailyClosings", () => tx.dailyClosing.deleteMany());
      // Convenios (pagos + facturas manuales/convenio + bitacora de cliente).
      await wipe("allyPayments", () => tx.allyPayment.deleteMany());
      await wipe("manualInvoiceLines", () => tx.manualInvoiceLine.deleteMany());
      await wipe("manualInvoices", () => tx.manualInvoice.deleteMany());
      await wipe("clientHistory", () => tx.clientHistory.deleteMany());
      // Cartera.
      await wipe("receivablePayments", () => tx.receivablePayment.deleteMany());
      await wipe("receivables", () => tx.receivable.deleteMany());
      // Cuentas por pagar.
      await wipe("payablePayments", () => tx.payablePayment.deleteMany());
      await wipe("payables", () => tx.payable.deleteMany());
      // Proveedores: facturas, abonos y ordenes (el maestro Supplier se conserva).
      await wipe("supplierInvoicePayments", () => tx.supplierInvoicePayment.deleteMany());
      await wipe("supplierInvoices", () => tx.supplierInvoice.deleteMany());
      await wipe("purchaseOrderLines", () => tx.purchaseOrderLine.deleteMany());
      await wipe("purchaseOrders", () => tx.purchaseOrder.deleteMany());
      // Ingresos/gastos y FUPA.
      await wipe("incomes", () => tx.income.deleteMany());
      await wipe("expenses", () => tx.expense.deleteMany());
      await wipe("fupaMovements", () => tx.fupaMovement.deleteMany());
      // Llamadas (CRM de vencimientos).
      await wipe("callLogs", () => tx.callLog.deleteMany());
      // Movimientos de caja al final: deja todas las cajas en cero (las cajas se conservan).
      await wipe("cashMovements", () => tx.cashMovement.deleteMany());
      return counts;
    }, { timeout: 30000 });
    const total = Object.values(deleted).reduce((a, b) => a + b, 0);
    res.json({ ok: true, total, deleted });
  } catch (e) {
    next(e);
  }
});

export default router;
