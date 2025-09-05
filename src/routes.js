import express from 'express';
import { fetchInstances, connectionState, connect, sendText, findChats, findMessages, markAsRead } from './evoClient.js';

const router = express.Router();

// Auth simple para el front
router.use((req, res, next) => {
  const key = req.header('x-backend-key');
  if (!process.env.BACKEND_API_KEY) return next();
  if (key !== process.env.BACKEND_API_KEY) return res.status(401).json({ error: 'Unauthorized' });
  next();
});

router.get('/health', (req, res) => res.json({ ok: true, uptime: process.uptime() }));

router.get('/instances', async (req, res) => {
  try {
    const data = await fetchInstances();
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e?.response?.data || e.message });
  }
});

router.get('/instance/:instance/connection', async (req, res) => {
  try {
    const { instance } = req.params;
    const state = await connectionState(instance);

    let qr = null;
    if (!state?.connected) {
      // Intentamos traer un QR (pairing code/QR code)
      try {
        const conn = await connect(instance);
        qr = conn?.code || null; // base64 string para generar QR (si Evolution lo devuelve)
      } catch (_) {}
    }

    res.json({ state, qr });
  } catch (e) {
    res.status(500).json({ error: e?.response?.data || e.message });
  }
});

router.post('/chat/find', async (req, res) => {
  try {
    const { instance } = req.body;
    const data = await findChats(instance);
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e?.response?.data || e.message });
  }
});

router.post('/messages/find', async (req, res) => {
  try {
    const { instance, remoteJid, limit } = req.body;
    const data = await findMessages(instance, { remoteJid, limit });
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e?.response?.data || e.message });
  }
});

router.post('/messages/send', async (req, res) => {
  try {
    const { instance, number, text, quoted } = req.body;
    const data = await sendText(instance, { number, text, quoted });
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e?.response?.data || e.message });
  }
});

router.post('/messages/mark-read', async (req, res) => {
  try {
    const { instance, messages } = req.body; // messages: [{ remoteJid, fromMe, id }]
    const data = await markAsRead(instance, messages);
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e?.response?.data || e.message });
  }
});

export default router;
