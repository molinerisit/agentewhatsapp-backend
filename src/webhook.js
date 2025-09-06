import express from 'express';

/**
 * Memoria en caliente (process only) para mensajes recibidos por webhook.
 * Estructura: store[instance][jid] = Array<Message>
 */
const store = {};
export function getStore() { return store; }

function ensureStore(instance, jid) {
  store[instance] ||= {};
  store[instance][jid] ||= [];
  return store[instance][jid];
}

function pushMessages(instance, msgs = []) {
  if (!instance || !Array.isArray(msgs)) return 0;
  let added = 0;
  for (const m of msgs) {
    const jid =
      m?.key?.remoteJid ||
      m?.remoteJid ||
      m?.chatId ||
      m?.jid ||
      null;
    if (!jid) continue;

    const bucket = ensureStore(instance, jid);
    const id = m?.key?.id;
    // evitar duplicados por id
    if (id && bucket.some(x => x?.key?.id === id)) continue;
    bucket.push(m);
    added++;
  }
  return added;
}

function extractMessagesFromPayload(payload) {
  // formatos comunes que he visto en Evolution (varían por versión/plan)
  // 1) { messages: [ ... ] }
  if (Array.isArray(payload?.messages)) return payload.messages;

  // 2) { data: { messages: [ ... ] } }
  if (Array.isArray(payload?.data?.messages)) return payload.data.messages;

  // 3) { data: [ ... ] }
  if (Array.isArray(payload?.data)) return payload.data;

  // 4) { message: { ...uno... } }
  if (payload?.message) return [payload.message];

  // 5) { data: { message: { ... } } }
  if (payload?.data?.message) return [payload.data.message];

  // 6) algunos envían { entry: [{ changes: [{ value: { messages: [...] } }] }] } (estilo WhatsApp Cloud)
  const cloud = payload?.entry?.[0]?.changes?.[0]?.value?.messages;
  if (Array.isArray(cloud)) return cloud;

  return [];
}

export default function makeWebhookRouter(io) {
  const router = express.Router();

  // Acepta /webhook y /webhook/:event (Webhook by Events)
  router.post(['/webhook', '/webhook/:event'], async (req, res) => {
    try {
      const urlEvent  = (req.params?.event || '').trim(); // p.ej. "messages.upsert"
      const headerEvt = req.headers['x-evolution-event'];
      const queryEvt  = req.query.event;
      const eventName = String(urlEvent || headerEvt || queryEvt || '').toLowerCase() || 'unknown';

      // Token opcional
      const token = req.query.token;
      if (process.env.WEBHOOK_TOKEN && token !== process.env.WEBHOOK_TOKEN) {
        console.warn('[WEBHOOK] invalid token');
        return res.status(401).json({ ok: false });
      }

      // Instance desde query, headers o body
      const instance =
        req.query.instance ||
        req.headers['x-evolution-instance'] ||
        req.body?.instance ||
        'unknown';

      // Log crudo
      console.log('[WEBHOOK] event=', eventName, 'instance=', instance);

      // Emitir el crudo para debug del front
      io.emit('evolution_event', { event: eventName, instance, payload: req.body });
      io.to(String(instance)).emit('evolution_event', { event: eventName, instance, payload: req.body });

      // Extraer mensajes (si aplica)
      const msgs = extractMessagesFromPayload(req.body);
      if (msgs.length) {
        const added = pushMessages(String(instance), msgs);
        console.log(`[WEBHOOK] incoming messages count= ${msgs.length} (added to cache: ${added})`);

        // Emitir normalizados por instancia
        io.emit('message_upsert', { instance, messages: msgs });
        io.to(String(instance)).emit('message_upsert', { instance, messages: msgs });

        // Emitir por sala de chat, p/que el front de ese chat los tome directo
        const byJid = {};
        for (const m of msgs) {
          const jid = m?.key?.remoteJid || m?.remoteJid || m?.chatId || m?.jid;
          if (!jid) continue;
          (byJid[jid] ||= []).push(m);
        }
        for (const [jid, group] of Object.entries(byJid)) {
          io.to(`${instance}:${jid}`).emit('message_upsert_chat', { instance, jid, messages: group });
        }
      }

      // 200 SIEMPRE para no cortar reintentos de Evolution
      return res.status(200).json({ ok: true });
    } catch (e) {
      console.error('[WEBHOOK ERROR]', e?.message || e);
      // 200 igual (no forzar reintentos infinitos)
      return res.status(200).json({ ok: true });
    }
  });

  return router;
}
