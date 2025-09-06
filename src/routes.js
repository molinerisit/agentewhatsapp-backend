// src/routes.js
import express from 'express';
import { listChats, fetchMessagesCompat, sendText } from './evo.js';

const router = express.Router();

/* ===================== Helpers de normalización ===================== */
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

/* ===================== Rutas ===================== */
router.get('/health', (req, res) => res.json({ ok: true, uptime: process.uptime() }));

// GET /api/chats?instance=Orbytal
router.get('/chats', async (req, res) => {
  const t0 = Date.now();
  try {
    const { instance } = req.query;
    console.log(`[HTTP] GET /api/chats instance=${instance}`);
    if (!instance) return res.status(400).json({ error: 'Missing "instance"' });

    const raw = await listChats(instance);
    const arr = Array.isArray(raw) ? raw : (raw?.chats || raw?.data || []);
    const normalized = (arr || []).map(normalizeChat).filter(c => !!c.jid);

    console.log(`[HTTP] /api/chats -> input=${arr?.length ?? 0} normalized=${normalized.length} (${Date.now()-t0}ms)`);
    res.json({ chats: normalized });
  } catch (e) {
    const status = e?.response?.status || 500;
    const payload = e?.response?.data || e.message;
    console.error('[HTTP ERR /api/chats]', status, payload);
    res.status(500).json({ error: payload, status });
  }
});

// GET /api/messages?instance=Orbytal&remoteJid=xxx@…&limit=50
router.get('/messages', async (req, res) => {
  const t0 = Date.now();
  try {
    const { instance, remoteJid, limit } = req.query;
    console.log(`[HTTP] GET /api/messages instance=${instance} jid=${remoteJid} limit=${limit}`);
    if (!instance) return res.status(400).json({ error: 'Missing "instance"' });
    if (!remoteJid) return res.status(400).json({ error: 'Missing "remoteJid"' });

    const jid = String(remoteJid);
    if (!/@(s\.whatsapp\.net|g\.us)$/.test(jid)) {
      console.warn('[HTTP] /api/messages remoteJid no parece JID válido:', jid);
      return res.status(400).json({ error: 'remoteJid debe terminar en @s.whatsapp.net o @g.us' });
    }

    const lim = limit ? Number(limit) : 50;
    const msgs = await fetchMessagesCompat(instance, jid, lim);
    console.log(`[HTTP] /api/messages -> ${Array.isArray(msgs) ? msgs.length : 'non-array'} (${Date.now()-t0}ms)`);
    res.json({ messages: Array.isArray(msgs) ? msgs : [] });
  } catch (e) {
    const status = e?.response?.status || 500;
    const payload = e?.response?.data || e.message;
    console.error('[HTTP ERR /api/messages]', status, payload);
    res.status(500).json({ error: payload, status });
  }
});

// POST /api/send   { instance, number, text, quoted? }
router.post('/send', async (req, res) => {
  const t0 = Date.now();
  try {
    const { instance, number, text, quoted } = req.body || {};
    console.log(`[HTTP] POST /api/send instance=${instance} to=${number} len=${text?.length ?? 0}`);
    if (!instance || !number || !text) {
      console.warn('[HTTP] /api/send missing params', { instance, number, text: !!text });
      return res.status(400).json({ error: 'instance, number, text are required' });
    }
    if (!/@(s\.whatsapp\.net|g\.us)$/.test(String(number))) {
      return res.status(400).json({ error: 'number debe ser un JID (…@s.whatsapp.net / …@g.us)' });
    }
    const out = await sendText(instance, number, text, quoted);
    console.log(`[HTTP] /api/send -> ok (${Date.now()-t0}ms)`);
    res.json(out);
  } catch (e) {
    const status = e?.response?.status || 500;
    const payload = e?.response?.data || e.message;
    console.error('[HTTP ERR /api/send]', status, payload);
    res.status(500).json({ error: payload, status });
  }
});

export default router;
