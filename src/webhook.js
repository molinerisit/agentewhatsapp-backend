import express from 'express';

function pickArray(x) {
  if (!x) return [];
  if (Array.isArray(x)) return x;
  // algunas builds envían { messages:[...] } dentro de x
  if (Array.isArray(x.messages)) return x.messages;
  if (Array.isArray(x.data)) return x.data;
  // a veces { data:{ messages:[...] } }
  if (x.data && Array.isArray(x.data.messages)) return x.data.messages;
  // a veces { message:{...} } único
  if (x.message) return [x.message];
  return [];
}

function extractMessages(body) {
  // intentamos varias rutas comunes
  const candidates = [
    body?.messages,
    body?.data,
    body,
  ];
  for (const c of candidates) {
    const arr = pickArray(c);
    if (arr.length) return arr;
  }
  return [];
}

// Algunos paneles mandan distintos nombres de evento
const EVENT_ALIASES = new Map([
  ['MESSAGES_UPSERT', 'MESSAGES_UPSERT'],
  ['messages.upsert', 'MESSAGES_UPSERT'],
  ['MESSAGE_RECEIVED', 'MESSAGES_UPSERT'],
  ['MESSAGE', 'MESSAGES_UPSERT'],
  ['NEW_MESSAGE', 'MESSAGES_UPSERT'],
]);

export default function makeWebhookRouter(io) {
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

      const event = EVENT_ALIASES.get(rawEvent) || rawEvent;

      // ==== LOG de entrada
      const len = JSON.stringify(req.body || {}).length;
      console.log(`[WEBHOOK] event=${rawEvent} (norm=${event}) instance=${instance} body=${len}B`);

      // Emitimos SIEMPRE el evento crudo para debug del front
      io.emit('evolution_event', { instance, event: rawEvent, payload: req.body });
      io.to(String(instance)).emit('evolution_event', { instance, event: rawEvent, payload: req.body });

      // Si es un evento de “mensajes”, normalizamos y emitimos un canal más simple
      if (event === 'MESSAGES_UPSERT') {
        const messages = extractMessages(req.body);
        const count = messages.length;
        console.log(`[WEBHOOK] upsert -> instance=${instance} msgs=${count}`);

        if (count > 0) {
          // Emisión general y por sala de instancia
          io.emit('message_upsert', { instance, messages });
          io.to(String(instance)).emit('message_upsert', { instance, messages });

          // Emisión por cada remoteJid para que el front pueda filtrar fino
          for (const m of messages) {
            const jid =
              m?.key?.remoteJid ||
              m?.remoteJid ||
              m?.chatId ||
              m?.jid;
            if (jid) {
              io.to(`${instance}:${jid}`).emit('message_upsert_chat', { instance, jid, messages: [m] });
              // Log por cada mensaje
              const txt =
                m?.message?.conversation ||
                m?.message?.extendedTextMessage?.text ||
                m?.message?.imageMessage?.caption ||
                m?.message?.videoMessage?.caption ||
                '';
              console.log(`[SOCKET] emit message_upsert_chat inst=${instance} jid=${jid} fromMe=${!!m?.key?.fromMe} text="${txt}"`);
            }
          }
        }
      }

      return res.status(200).json({ ok: true });
    } catch (e) {
      console.error('[WEBHOOK ERROR]', e?.stack || e?.message || e);
      return res.status(200).json({ ok: true });
    }
  });

  return router;
}
