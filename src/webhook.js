// backend/src/webhook.js
// ESM: export default una fábrica que devuelve un Router válido
import express from 'express';
import { handleIncomingMessage } from './bot/engine.js';

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
 // extractor robusto de mensajes (soporta múltiples layouts) — versión que preserva `key`
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

    // 5) { data: { message: {...}, key? } }
    if (payload?.data?.message) {
      // si viene data.message con data.key, preservamos el objeto completo
      if (payload?.data?.key || payload?.data?.remoteJid || payload?.data?.chatId) {
        return [payload.data];
      }
      // sino, al menos devolvemos wrapper con `message`
      return [{ message: payload.data.message }];
    }

    // 6) { message: {...}, key? }  (muy común en messages.upsert / send.message)
    if (payload?.message) {
      if (payload?.key || payload?.remoteJid || payload?.chatId) {
        return [payload]; // ← preserva key/ids/metadata
      }
      return [{ message: payload.message }];
    }

    // 7) otros contenedores
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
    // <- RESPUESTA DEL BOT (solo entrantes)
    if (!m?.key?.fromMe) {
      handleIncomingMessage({ instance, message: m }).catch(err =>
        console.error('[BOT ERROR]', err?.message || err)
      );
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
