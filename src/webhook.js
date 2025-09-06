import express from 'express';

// Extraer mensajes del body en distintas variantes
function extractMessagesFromPayload(body) {
  if (!body) return [];
  // casos frecuentes
  if (Array.isArray(body?.data?.messages)) return body.data.messages;
  if (Array.isArray(body?.messages)) return body.messages;
  if (Array.isArray(body?.data)) return body.data;
  if (body?.message) return [body.message];
  // algunos envían { data: { message: {...} } }
  if (body?.data?.message) return [body.data.message];
  return [];
}

function getRemoteJid(m) {
  return (
    m?.key?.remoteJid ||
    m?.remoteJid ||
    m?.jid ||
    m?.chatId ||
    m?.message?.key?.remoteJid ||
    null
  );
}

export default function makeWebhookRouter(io, memoryStore) {
  const router = express.Router();

  router.post('/webhook', async (req, res) => {
    try {
      const token = req.query.token;
      if (process.env.WEBHOOK_TOKEN && token !== process.env.WEBHOOK_TOKEN) {
        console.warn('[WEBHOOK] invalid token:', token);
        return res.status(401).json({ ok: false, error: 'Invalid webhook token' });
      }

      const instance =
        req.query.instance ||
        req.body?.instance ||
        req.headers['x-evolution-instance'] ||
        'unknown';

      const rawEvent =
        req.body?.event ||
        req.query.event ||
        req.headers['x-evolution-event'] ||
        'UNKNOWN_EVENT';

      const ev = String(rawEvent).toLowerCase().replace(/_/g, '.');
      console.log('[WEBHOOK] event=', ev, 'instance=', instance);

      // SIEMPRE emitir crudo por compat
      io.emit('evolution_event', { instance, event: rawEvent, payload: req.body });
      io.to(String(instance)).emit('evolution_event', { instance, event: rawEvent, payload: req.body });

      // ¿Es evento con mensajes?
      const isMsgEvent =
        /(messages?\.(upsert|set|update|received|new)|send\.message)/.test(ev);

      if (isMsgEvent) {
        const msgs = extractMessagesFromPayload(req.body);
        console.log('[WEBHOOK] incoming messages count=', msgs.length);

        if (msgs.length) {
          // Guardar, emitir normalizado y por sala
          for (const m of msgs) {
            const jid = getRemoteJid(m);
            if (!jid) continue;

            memoryStore.push(String(instance), String(jid), [m]);

            // normalizado
            io.emit('message_upsert', { instance, messages: [m] });
            io.to(String(instance)).emit('message_upsert', { instance, messages: [m] });
            io.to(`${instance}:${jid}`).emit('message_upsert_chat', { instance, jid, messages: [m] });
          }
        }
      }

      return res.status(200).json({ ok: true });
    } catch (e) {
      console.error('[WEBHOOK ERROR]', e?.stack || e?.message || e);
      // respondemos 200 para evitar reintentos excesivos
      return res.status(200).json({ ok: true });
    }
  });

  return router;
}
