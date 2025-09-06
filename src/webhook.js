import express from 'express';

export default function makeWebhookRouter(io) {
  const router = express.Router();

  // Utilidad para extraer array de mensajes del payload Evolution/Baileys
  function pickMessages(payload) {
    if (!payload) return [];
    // Evolution común
    if (Array.isArray(payload?.messages)) return payload.messages;
    if (Array.isArray(payload?.data?.messages)) return payload.data.messages;
    if (Array.isArray(payload?.data)) return payload.data;
    // Algunos envían un único mensaje en 'message' o 'msg'
    if (payload?.message) return [payload.message];
    if (payload?.msg) return [payload.msg];
    // Array directo
    if (Array.isArray(payload)) return payload;
    return [];
    }

  function extractRemoteJidFromMsgs(msgs) {
    for (const m of msgs) {
      const jid = m?.key?.remoteJid || m?.remoteJid || m?.chatId || m?.jid;
      if (jid) return String(jid);
    }
    return null;
  }

  router.post('/webhook', async (req, res) => {
    try {
      const token = req.query.token;
      if (process.env.WEBHOOK_TOKEN && token !== process.env.WEBHOOK_TOKEN) {
        return res.status(401).json({ ok: false, error: 'Invalid webhook token' });
      }

      const instance =
        req.query.instance ||
        req.body?.instance ||
        req.headers['x-evolution-instance'] ||
        'unknown';

      const eventName =
        req.body?.event ||
        req.query.event ||
        req.headers['x-evolution-event'] ||
        // algunos forks usan nombre en minúscula o con :
        req.body?.type ||
        'UNKNOWN_EVENT';

      console.log('[WEBHOOK] instance=%s event=%s', instance, eventName);
      const payload = req.body;

      // Emitimos SIEMPRE la cruda, por si quieres verla en consola del front
      io.emit('evolution_event_raw', { instance, event: eventName, payload });
      io.to(String(instance)).emit('evolution_event_raw', { instance, event: eventName, payload });

      // Normalizamos mensajes entrantes a un único canal: message_upsert
      const lower = String(eventName).toLowerCase();

      const isUpsert =
        lower.includes('messages_upsert') ||
        lower.includes('messages.upsert') ||
        lower.includes('message_upsert') ||
        lower.includes('message:upsert') ||
        lower.includes('newmessage') ||
        lower.includes('message') && (payload?.messages || payload?.data);

      if (isUpsert) {
        const msgs = pickMessages(payload);
        const remoteJid = extractRemoteJidFromMsgs(msgs);

        const normalized = { instance, remoteJid, messages: msgs };
        console.log('[WEBHOOK] message_upsert -> %d msgs jid=%s', msgs.length, remoteJid);

        io.emit('message_upsert', normalized);
        io.to(String(instance)).emit('message_upsert', normalized);
      }

      return res.status(200).json({ ok: true });
    } catch (e) {
      console.error('[WEBHOOK ERROR]', e?.stack || e?.message || e);
      return res.status(200).json({ ok: true });
    }
  });

  return router;
}
