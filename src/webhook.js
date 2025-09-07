// backend/src/webhook.js
// ESM: export default una fábrica que devuelve un Router válido
import express from 'express';

export default function makeWebhookRouter(io) {
  const router = express.Router();

  // ---------- helpers ----------
  // A veces Evolution agrega un sufijo después del valor de ?instance, p.ej. "?instance=OrbytalAI/messages-upsert"
  const cleanInstance = (raw) => String(raw || '')
    .split('?')[0]          // por si viniera doble "?"
    .split('&')[0]          // por si se coló otro param en la misma cadena
    .split('/')[0]          // quita "/messages-upsert" o similares
    .trim() || 'unknown';

  // extractor robusto de mensajes (soporta múltiples layouts)
  function extractMessages(payload) {
    try {
      // 1) arreglo directo
      if (Array.isArray(payload)) return payload;

      // 2) { messages: [...] }
      if (Array.isArray(payload?.messages)) return payload.messages;

      // 3) { data: { messages: [...] } }
      if (Array.isArray(payload?.data?.messages)) return payload.data.messages;

      // 4) { data: [...] }
      if (Array.isArray(payload?.data)) return payload.data;

      // 5) { data: { message: {...} } }
      if (payload?.data?.message) return [payload.data.message];

      // 6) { message: {...} } (muy común en messages.upsert / send.message)
      if (payload?.message) return [payload.message];

      // 7) algunos proveedores meten { result: [...] } o { rows: [...] }
      if (Array.isArray(payload?.result)) return payload.result;
      if (Array.isArray(payload?.rows))   return payload.rows;

      return [];
    } catch {
      return [];
    }
  }

  // ---------- guard opcional por token ----------
  router.use((req, res, next) => {
    const expected = process.env.WEBHOOK_TOKEN || 'evolution';
    const token = req.query?.token;

    // Si no viene token, dejamos pasar (Evolution no siempre lo manda);
    // si viene distinto al esperado, rechazamos.
    if (expected && token && token !== expected) {
      return res.status(401).json({ ok: false, error: 'Invalid webhook token' });
    }
    next();
  });

  // ---------- webhook “plano”: /api/webhook  (todos los eventos) ----------
  router.post('/webhook', express.json({ limit: '2mb' }), async (req, res) => {
    try {
      const instance =
        req.headers['x-evolution-instance'] ||
        req.body?.instance ||
        (req.query?.instance ? cleanInstance(req.query.instance) : null) ||
        'unknown';

      const event =
        req.headers['x-evolution-event'] ||
        req.body?.event ||
        req.query?.event ||
        'unknown';

      const payload = req.body?.data ?? req.body?.payload ?? req.body;

      // broadcast “general” y por instancia
      const envelope = { event, payload, instance };
      io.emit('evolution_event', envelope);
      io.to(String(instance)).emit('evolution_event', envelope);

      // si hay mensajes, emitimos canales específicos
      const msgs = extractMessages(payload);
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

      // devolvemos 200 siempre para que Evolution no reintente eternamente
      return res.status(200).json({ ok: true });
    } catch (e) {
      console.error('[WEBHOOK ERROR]', e?.message || e);
      return res.status(200).json({ ok: true, warn: 'handler error' });
    }
  });

  // ---------- webhook por-evento: /api/webhook/:event ----------
  router.post('/webhook/:event', express.json({ limit: '2mb' }), (req, res) => {
    try {
      const instance =
        req.headers['x-evolution-instance'] ||
        req.body?.instance ||
        (req.query?.instance ? cleanInstance(req.query.instance) : null) ||
        'unknown';

      const event =
        req.params?.event ||
        req.headers['x-evolution-event'] ||
        req.body?.event ||
        req.query?.event ||
        'unknown';

      const payload = req.body?.data ?? req.body?.payload ?? req.body;

      const envelope = { event, payload, instance };
      io.emit('evolution_event', envelope);
      io.to(String(instance)).emit('evolution_event', envelope);

      const msgs = extractMessages(payload);
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
    } catch (e) {
      console.error('[WEBHOOK ERROR]', e?.message || e);
      return res.status(200).json({ ok: true, warn: 'handler error' });
    }
  });

  return router;
}
