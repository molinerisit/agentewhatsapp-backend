import express from 'express';
import { listChats, fetchMessagesCompat, sendText } from './evo.js';

const router = express.Router();

// helpers de normalización (igual que tenías)
function extractJid(obj) {
  const candidates = [
    obj?.key?.remoteJid,
    obj?.remoteJid,
    obj?.jid,
    obj?.chatId,
    obj?.id,
    obj?.lastMessage?.key?.remoteJid,
    obj?.lastMessage?.remoteJid,
    obj?.message?.key?.remoteJid,
  ].filter(Boolean);

  for (const x of candidates) {
    const s = String(x);
    if (/@/.test(s)) return s;
  }
  if (obj?.number) return `${obj.number}@s.whatsapp.net`;
  return null;
}
function extractName(obj) {
  return (
    obj?.name || obj?.pushName || obj?.subject || obj?.displayName || extractJid(obj) || obj?.id || 'chat'
  );
}
function extractPreview(obj) {
  const m = obj?.lastMessage?.message || obj?.previewMessage || obj?.message;
  if (!m) return '';
  return (
    m.conversation ||
    m.extendedTextMessage?.text ||
    m.imageMessage?.caption ||
    m.videoMessage?.caption ||
    m.buttonsResponseMessage?.selectedDisplayText ||
    m.listResponseMessage?.title ||
    ''
  ) || '';
}
function normalizeChat(c) {
  const jid = extractJid(c);
  return { jid, name: extractName(c), preview: extractPreview(c), _raw: c };
}

router.get('/health', (req, res) => res.json({ ok: true, uptime: process.uptime() }));

router.get('/chats', async (req, res) => {
  try {
    const { instance } = req.query;
    if (!instance) return res.status(400).json({ error: 'Missing "instance"' });
    const chats = await listChats(instance);
    const arr = Array.isArray(chats) ? chats : (chats?.chats || chats?.data || []);
    const normalized = arr.map(normalizeChat).filter(c => !!c.jid);
    res.json({ chats: normalized });
  } catch (e) {
    const status = e?.response?.status || 500;
    const payload = e?.response?.data || e.message;
    console.error('[chats ERROR]', status, payload);
    res.status(500).json({ error: payload, status });
  }
});

router.get('/messages', async (req, res) => {
  try {
    const { instance, remoteJid, limit } = req.query;
    if (!instance) return res.status(400).json({ error: 'Missing "instance"' });
    if (!remoteJid) return res.status(400).json({ error: 'Missing "remoteJid"' });

    // Forzamos que sea JID real (…@s.whatsapp.net/…@g.us)
    if (!/@/.test(String(remoteJid))) {
      return res.status(400).json({ error: 'remoteJid debe ser un JID válido (…@s.whatsapp.net / …@g.us)' });
    }

    const msgs = await fetchMessagesCompat(instance, String(remoteJid), limit ? Number(limit) : 50);
    res.json({ messages: Array.isArray(msgs) ? msgs : [] });
  } catch (e) {
    const status = e?.response?.status || 500;
    const payload = e?.response?.data || e.message;
    console.error('[messages ERROR]', status, payload);
    res.status(500).json({ error: payload, status });
  }
});

router.post('/send', async (req, res) => {
  try {
    const { instance, number, text, quoted } = req.body || {};
    if (!instance || !number || !text) return res.status(400).json({ error: 'instance, number, text are required' });
    if (!/@/.test(String(number))) return res.status(400).json({ error: 'number debe ser un JID (…@s.whatsapp.net / …@g.us)' });
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
