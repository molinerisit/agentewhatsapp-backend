import express from 'express';
import { listChats, listMessages, sendText } from './evo.js';

const router = express.Router();

router.get('/health', (req, res) => res.json({ ok: true, uptime: process.uptime() }));

// Get chats
router.get('/chats', async (req, res) => {
  try {
    const { instance } = req.query;
    if (!instance) return res.status(400).json({ error: 'Missing "instance"' });
    const chats = await listChats(instance);
    res.json({ chats });
  } catch (e) {
    const status = e?.response?.status || 500;
    const payload = e?.response?.data || e.message;
    console.error('[chats ERROR]', status, payload);
    res.status(500).json({ error: payload, status });
  }
});

// Get messages
router.get('/messages', async (req, res) => {
  try {
    const { instance, remoteJid, limit } = req.query;
    if (!instance) return res.status(400).json({ error: 'Missing "instance"' });
    const msgs = await listMessages(instance, { remoteJid, limit: limit ? Number(limit) : 50 });
    res.json({ messages: msgs });
  } catch (e) {
    const status = e?.response?.status || 500;
    const payload = e?.response?.data || e.message;
    console.error('[messages ERROR]', status, payload);
    res.status(500).json({ error: payload, status });
  }
});

// Send text
router.post('/send', async (req, res) => {
  try {
    const { instance, number, text, quoted } = req.body || {};
    if (!instance || !number || !text) return res.status(400).json({ error: 'instance, number, text are required' });
    const out = await sendText(instance, number, text, quoted);
    res.json(out);
  } catch (e) {
    const status = e?.response?.status || 500;
    const payload = e?.response?.data || e.message;
    console.error('[send ERROR]', status, payload);
    res.status(500).json({ error: payload, status });
  }
});

export default router;
