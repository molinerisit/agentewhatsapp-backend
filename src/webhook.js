import express from 'express';

function getEventName(req) {
  return (
    req.body?.event ||
    req.query?.event ||
    req.headers['x-evolution-event'] ||
    'UNKNOWN_EVENT'
  );
}

function getInstanceId(req) {
  return (
    req.query.instance ||
    req.body?.instance ||
    req.headers['x-evolution-instance'] ||
    'unknown'
  );
}

// Devuelve un array de mensajes normalizados desde payload Evolution
function extractMessages(payload) {
  const pack = payload?.data ?? payload ?? {};
  // puede venir como {data:{messages:[...]}} o {messages:[...]} o directamente array
  if (Array.isArray(pack)) return pack;
  if (Array.isArray(pack.messages)) return pack.messages;
  if (pack.message) return [pack.message];
  return [];
}

export default function makeWebhookRouter(io) {
  const router = express.Router();

  // Webhook principal
  router.post('/webhook', async (req, res) => {
    try {
      const token = req.query.token;
      if (process.env.WEBHOOK_TOKEN && token !== process.env.WEBHOOK_TOKEN) {
        console.warn('[WEBHOOK] invalid token');
        return res.status(401).json({ ok: false, error: 'Invalid webhook token' });
      }

      const instance = getInstanceId(req);
      const event = getEventName(req);
      const payload = req.body;

      console.log('[WEBHOOK] event=', event, 'instance=', instance);
      // Emit global e instancia siempre (debug útil)
      io.emit('evolution_event', { instance, event, payload });
      io.to(String(instance)).emit('evolution_event', { instance, event, payload });

      // Si es MESSAGES_UPSERT (o eventos con mensajes), emitir por sala de chat
      if (event === 'MESSAGES_UPSERT' || event === 'MESSAGES_UPDATE' || event === 'MESSAGES_SET') {
        const msgs = extractMessages(payload);
        console.log(`[WEBHOOK] ${event} messages count=${msgs.length}`);
        for (const m of msgs) {
          const jid =
            m?.key?.remoteJid ||
            m?.remoteJid ||
            m?.chatId ||
            m?.jid;

          if (!jid) continue;
          const room = `${instance}:${jid}`;
          io.to(room).emit('evolution_event', { instance, event, payload: { data: { messages: [m] } } });
          console.log(`[WEBHOOK] -> emitted to room ${room} (id=${m?.key?.id || 'no-id'})`);
        }
      }

      return res.status(200).json({ ok: true });
    } catch (e) {
      console.error('[WEBHOOK ERROR]', e?.stack || e?.message || e);
      return res.status(200).json({ ok: true });
    }
  });

  // Endpoint para probar manualmente el flujo realtime (sin depender de Evolution)
  router.post('/webhook/test', async (req, res) => {
    const instance = req.query.instance || 'Orbytal';
    const jid = req.query.jid || '5493413738775@s.whatsapp.net';
    const text = req.query.text || 'Mensaje de prueba (local)';

    const fake = {
      event: 'MESSAGES_UPSERT',
      data: {
        messages: [{
          key: { id: 'test-' + Date.now(), remoteJid: jid, fromMe: false },
          message: { conversation: text },
          messageTimestamp: Date.now()
        }]
      }
    };

    console.log('[WEBHOOK][TEST] emitting to', instance, `${instance}:${jid}`);
    io.emit('evolution_event', { instance, event: fake.event, payload: fake });
    io.to(String(instance)).emit('evolution_event', { instance, event: fake.event, payload: fake });
    io.to(`${instance}:${jid}`).emit('evolution_event', { instance, event: fake.event, payload: fake });

    res.json({ ok: true, sent: true, instance, jid });
  });

  return router;
}
