import express from 'express';
import { listChats, fetchMessagesCompat, sendText } from './evo.js';

const router = express.Router();

// Helpers
function extractJid(obj) {
  const cands = [
    obj?.key?.remoteJid,
    obj?.remoteJid,
    obj?.jid,
    obj?.chatId,
    obj?.id,
    obj?.lastMessage?.key?.remoteJid,
    obj?.lastMessage?.remoteJid,
    obj?.message?.key?.remoteJid,
  ].filter(Boolean);

  for (const x of cands) {
    const s = String(x);
    if (/@/.test(s)) return s;
  }
  if (obj?.number) return `${obj.number}@s.whatsapp.net`;
  return null;
}
function extractName(obj) {
  return obj?.name || obj?.pushName || obj?.subject || obj?.displayName || extractJid(obj) || obj?.id || 'chat';
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

// Health simple
router.get('/health', (req, res) => res.json({ ok: true, uptime: process.uptime() }));

// Chats
router.get('/chats', async (req, res) => {
  try {
    const { instance } = req.query;
    if (!instance) return res.status(400).json({ error: 'Missing "instance"' });
    const chats = await listChats(instance);
    const arr = Array.isArray(chats) ? chats : (chats?.chats || chats?.data || []);
    const normalized = arr.map(normalizeChat).filter(c => !!c.jid);
    console.log('[HTTP] /api/chats -> input=%d normalized=%d', arr.length, normalized.length);
    res.json({ chats: normalized });
  } catch (e) {
    const status = e?.response?.status || 500;
    const payload = e?.response?.data || e.message;
    console.error('[chats ERROR]', status, payload);
    res.status(500).json({ error: payload, status });
  }
});

// Mensajes (pull — puede venir vacío en tu build)
router.get('/messages', async (req, res) => {
  try {
    const { instance, remoteJid, limit } = req.query;
    if (!instance) return res.status(400).json({ error: 'Missing "instance"' });
    if (!remoteJid) return res.status(400).json({ error: 'Missing "remoteJid"' });

    const jid = String(remoteJid);
    if (!/@/.test(jid)) {
      return res.status(400).json({ error: 'remoteJid debe terminar en @s.whatsapp.net o @g.us' });
    }

    const msgs = await fetchMessagesCompat(instance, jid, limit ? Number(limit) : 50);
    console.log('[HTTP] /api/messages -> %d', Array.isArray(msgs) ? msgs.length : 0);
    res.json({ messages: Array.isArray(msgs) ? msgs : [] });
  } catch (e) {
    const status = e?.response?.status || 500;
    const payload = e?.response?.data || e.message;
    console.error('[messages ERROR]', status, payload);
    res.status(500).json({ error: payload, status });
  }
});

// Enviar texto
router.post('/send', async (req, res) => {
  try {
    const { instance, number, text, quoted } = req.body || {};
    if (!instance || !number || !text) {
      return res.status(400).json({ error: 'instance, number, text are required' });
    }
    if (!/@/.test(String(number))) {
      return res.status(400).json({ error: 'number debe ser un JID (…@s.whatsapp.net / …@g.us)' });
    }
    console.log('[HTTP] POST /api/send instance=%s to=%s len=%d', instance, number, text.length);
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
