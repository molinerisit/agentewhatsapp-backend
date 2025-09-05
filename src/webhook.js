import express from 'express';

export default function makeWebhookRouter(io) {
  const router = express.Router();

  router.post('/webhook', async (req, res) => {
    try {
      const token = req.query.token;
      if (process.env.WEBHOOK_TOKEN && token !== process.env.WEBHOOK_TOKEN) {
        return res.status(401).json({ ok: false, error: 'Invalid webhook token' });
      }
      const instance = req.query.instance || req.body?.instance || req.headers['x-evolution-instance'] || 'unknown';
      const event = req.body?.event || req.query.event || req.headers['x-evolution-event'] || 'UNKNOWN_EVENT';

      // broadcast to all, and to room per instance
      io.emit('evolution_event', { instance, event, payload: req.body });
      io.to(String(instance)).emit('evolution_event', { instance, event, payload: req.body });

      return res.status(200).json({ ok: true });
    } catch (e) {
      console.error('[WEBHOOK ERROR]', e?.message);
      return res.status(200).json({ ok: true });
    }
  });

  return router;
}
