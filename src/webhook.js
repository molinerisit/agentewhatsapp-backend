import express from 'express';

/** Memoria en caliente (solo proceso) */
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
    const jid = m?.key?.remoteJid || m?.remoteJid || m?.chatId || m?.jid || null;
    if (!jid) continue;
    const bucket = ensureStore(instance, jid);
    const id = m?.key?.id;
    if (id && bucket.some(x => x?.key?.id === id)) continue; // dedupe
    bucket.push(m);
    added++;
  }
  return added;
}

function extractMessagesFromPayload(payload) {
  if (Array.isArray(payload?.messages)) return payload.messages;
  if (Array.isArray(payload?.data?.messages)) return payload.data.messages;
  if (Array.isArray(payload?.data)) return payload.data;
  if (payload?.message) return [payload.message];
  if (payload?.data?.message) return [payload.data.message];
  // formato estilo Cloud:
  const cloud = payload?.entry?.[0]?.changes?.[0]?.value?.messages;
  if (Array.isArray(cloud)) return cloud;
  return [];
}

export default function makeWebhookRouter(io) {
  const router = express.Router();

  router.post(['/webhook', '/webhook/:event'], async (req, res) => {
    try {
      // detectar evento desde: path, header, query **y body**
      const urlEvent   = (req.params?.event || '').trim();
      const headerEvt  = req.headers['x-evolution-event'];
      const queryEvt   = req.query.event;
      const bodyEvt    = req.body?.event;
      const eventName  = String(urlEvent || headerEvt || queryEvt || bodyEvt || '').toLowerCase() || 'unknown';

      // token (opcional)
      const token = req.query.token;
      if (process.env.WEBHOOK_TOKEN && token !== process.env.WEBHOOK_TOKEN) {
        console.warn('[WEBHOOK] invalid token');
        return res.status(401).json({ ok: false });
      }

      const instance =
        req.query.instance ||
        req.headers['x-evolution-instance'] ||
        req.body?.instance ||
        'unknown';

      console.log('[WEBHOOK] event=', eventName, 'instance=', instance);

      // emitir crudo para debug en front
      io.emit('evolution_event', { event: eventName, instance, payload: req.body });
      io.to(String(instance)).emit('evolution_event', { event: eventName, instance, payload: req.body });

      // intentar extraer mensajes
      const msgs = extractMessagesFromPayload(req.body);
      if (msgs.length) {
        const added = pushMessages(String(instance), msgs);
        console.log(`[WEBHOOK] incoming messages count=${msgs.length} (added=${added})`);

        // por instancia
        io.emit('message_upsert', { instance, messages: msgs });
        io.to(String(instance)).emit('message_upsert', { instance, messages: msgs });

        // por chat
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

      return res.status(200).json({ ok: true }); // siempre 200
    } catch (e) {
      console.error('[WEBHOOK ERROR]', e?.message || e);
      return res.status(200).json({ ok: true });
    }
  });

  return router;
}
