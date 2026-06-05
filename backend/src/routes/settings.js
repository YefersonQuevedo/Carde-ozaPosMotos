// Panel de configuracion: notificaciones (correo, Telegram, WhatsApp).
// La config DIAN/apidian vive en /api/dian/config; aqui van los canales de aviso.
import { Router } from "express";
import { prisma } from "../db.js";
import { sendTelegram, sendEmail, sendWhatsapp } from "../services/notify.js";

const router = Router();

async function getNotif() {
  let cfg = await prisma.notificationConfig.findUnique({ where: { id: 1 } });
  if (!cfg) cfg = await prisma.notificationConfig.create({ data: { id: 1 } });
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
    const cfg = await prisma.notificationConfig.upsert({ where: { id: 1 }, update: data, create: { id: 1, ...data } });
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

export default router;
