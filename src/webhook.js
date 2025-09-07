// backend/src/webhook.js
// ESM: export default una fábrica que devuelve un Router válido
import express from 'express';

export default function makeWebhookRouter(io) {
  const router = express.Router();

  // seguridad opcional por token ?token=...
  router.use((req, res, next) => {
    const token = req.query.token;
    const expected = process.env.WEBHOOK_TOKEN || 'evolution';
    if (expected && token && token !== expected) {
      return res.status(401).json({ ok: false, error: 'Invalid webhook token' });
    }
    next();
  });

  // ruta “plana”: /api/webhook  (cubre todos los eventos en un solo endpoint)
  router.post('/webhook', express.json({ limit: '2mb' }), async (req, res) => {
    try {
      const instance = req.query.instance
        || req.body?.instance
        || req.headers['x-evolution-instance']
        || 'unknown';

      // Evolution envía a veces { event, data } y otras { event, payload }
      const event =
        req.body?.event
        || req.query.event
        || req.headers['x-evolution-event']
        || 'unknown';

      const payload = req.body?.data ?? req.body?.payload ?? req.body;

      // Broadcast “general” y por instancia
      io.emit('evolution_event', { event, payload, instance });
      io.to(String(instance)).emit('evolution_event', { event, payload, instance });

      // Si viene claramente mensajes, además emitimos canales afinados:
      const msgs =
        (Array.isArray(payload?.messages) && payload.messages)
        || (Array.isArray(payload?.data?.messages) && payload.data.messages)
        || (Array.isArray(payload?.data) && payload.data)
        || (payload?.message ? [payload.message] : [])
        || [];

      if (Array.isArray(msgs) && msgs.length) {
        io.emit('message_upsert', { instance, messages: msgs });
        io.to(String(instance)).emit('message_upsert', { instance, messages: msgs });

        // emitir por sala de chat cuando sepamos el JID
        for (const m of msgs) {
          const jid = m?.key?.remoteJid || m?.remoteJid || m?.chatId;
          if (jid) {
            io.to(`${instance}:${jid}`).emit('message_upsert_chat', { instance, jid, messages: [m] });
          }
        }
      }

      return res.status(200).json({ ok: true });
    } catch (e) {
      console.error('[WEBHOOK ERROR]', e?.message || e);
      // devolvemos 200 igual para que Evolution no reintente eterno
      return res.status(200).json({ ok: true, warn: 'handler error' });
    }
  });

  // rutas por-evento opcionales: /api/webhook/messages.upsert (etc.)
  router.post('/webhook/:event', express.json({ limit: '2mb' }), (req, res) => {
    const instance = req.query.instance
      || req.body?.instance
      || req.headers['x-evolution-instance']
      || 'unknown';
    const event = req.params.event || 'unknown';
    const payload = req.body?.data ?? req.body?.payload ?? req.body;

    io.emit('evolution_event', { event, payload, instance });
    io.to(String(instance)).emit('evolution_event', { event, payload, instance });

    // Reusar la misma lógica de mensajes:
    const msgs =
      (Array.isArray(payload?.messages) && payload.messages)
      || (Array.isArray(payload?.data?.messages) && payload.data.messages)
      || (Array.isArray(payload?.data) && payload.data)
      || (payload?.message ? [payload.message] : [])
      || [];

    if (Array.isArray(msgs) && msgs.length) {
      io.emit('message_upsert', { instance, messages: msgs });
      io.to(String(instance)).emit('message_upsert', { instance, messages: msgs });
      for (const m of msgs) {
        const jid = m?.key?.remoteJid || m?.remoteJid || m?.chatId;
        if (jid) {
          io.to(`${instance}:${jid}`).emit('message_upsert_chat', { instance, jid, messages: [m] });
        }
      }
    }

    return res.status(200).json({ ok: true });
  });

  return router;
}
