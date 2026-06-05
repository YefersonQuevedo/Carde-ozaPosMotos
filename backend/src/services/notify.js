// Envio de notificaciones: Telegram, correo (via API de email) y WhatsApp.
// Reutilizable para avisos de facturas, vencimientos de RTM, etc.
// Las credenciales viven en NotificationConfig (panel de Configuracion).

// Telegram: POST https://api.telegram.org/bot{token}/sendMessage
export async function sendTelegram({ botToken, chatId }, text) {
  if (!botToken || !chatId) throw new Error("Falta botToken o chatId de Telegram");
  const resp = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML" })
  });
  const j = await resp.json().catch(() => ({}));
  if (!resp.ok || j.ok === false) throw new Error(j.description || `Telegram HTTP ${resp.status}`);
  return j;
}

// Email: POST a EmailApiUrl con { to, subject, message } (igual que easyerpweb).
export async function sendEmail({ apiUrl, from }, { to, subject, message }) {
  if (!apiUrl) throw new Error("EmailApiUrl no esta configurado");
  const resp = await fetch(apiUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ to, from, subject, message })
  });
  const raw = await resp.text();
  if (!resp.ok) throw new Error(`Email HTTP ${resp.status}: ${raw.slice(0, 200)}`);
  try { return JSON.parse(raw); } catch { return { ok: true, raw }; }
}

// WhatsApp: POST generico (compatible con WhatsApp Cloud API si apiUrl apunta a
// .../{phoneId}/messages). Para Cloud API el token va como Bearer.
export async function sendWhatsapp({ apiUrl, token, phoneId }, { to, message }) {
  if (!apiUrl) throw new Error("WhatsApp apiUrl no esta configurado");
  const url = phoneId && !apiUrl.includes(phoneId) ? `${apiUrl.replace(/\/$/, "")}/${phoneId}/messages` : apiUrl;
  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ messaging_product: "whatsapp", to, type: "text", text: { body: message } })
  });
  const raw = await resp.text();
  if (!resp.ok) throw new Error(`WhatsApp HTTP ${resp.status}: ${raw.slice(0, 200)}`);
  try { return JSON.parse(raw); } catch { return { ok: true, raw }; }
}
