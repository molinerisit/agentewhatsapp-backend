
// backend/src/webhook.js
import express from 'express';

export default function makeWebhookRouter(io) {
  const router = express.Router();

  // Webhook global: Evolution enviará aquí TODOS los eventos
  router.post('/wa/webhook', async (req, res) => {
    try {
      const token = req.query.token;
      if (process.env.WEBHOOK_TOKEN && token !== process.env.WEBHOOK_TOKEN) {
        return res.status(401).json({ ok: false, error: 'Invalid webhook token' });
      }

      const instance = req.query.instance || req.body?.instance || req.headers['x-evolution-instance'] || 'unknown';
      const event = req.body?.event || req.query.event || req.headers['x-evolution-event'] || 'UNKNOWN_EVENT';

      // Emitimos a todos + a la sala de la instancia
      io.emit('evolution_event', { instance, event, payload: req.body });
      io.to(String(instance)).emit('evolution_event', { instance, event, payload: req.body });

      // Responder rápido evita reintentos y 500 en Evolution
      return res.status(200).json({ ok: true });
    } catch (e) {
      // Aun si algo falla, devolvemos 200 para no forzar reintentos del Evolution
      console.error('[WEBHOOK ERROR]', e?.message);
      return res.status(200).json({ ok: true });
    }
  });

  return router;
}
