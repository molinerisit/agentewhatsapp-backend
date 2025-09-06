import express from 'express';
import { listChats, fetchMessagesCompat, sendText } from './evo.js';

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

export default function makeRoutes(memoryStore) {
  const router = express.Router();

  router.get('/health', (req, res) => res.json({ ok: true, uptime: process.uptime() }));

  // CHATS
  router.get('/chats', async (req, res) => {
    try {
      const { instance } = req.query;
      if (!instance) return res.status(400).json({ error: 'Missing "instance"' });
      console.log('[HTTP] GET /api/chats instance=', instance);
      const chats = await listChats(instance);
      const arr = Array.isArray(chats) ? chats : (chats?.chats || chats?.data || []);
      const normalized = arr.map(normalizeChat).filter(c => !!c.jid);
      console.log('[HTTP] /api/chats -> input=', arr.length, 'normalized=', normalized.length);
      res.json({ chats: normalized });
    } catch (e) {
      const status = e?.response?.status || 500;
      const payload = e?.response?.data || e.message;
      console.error('[chats ERROR]', status, payload);
      res.status(500).json({ error: payload, status });
    }
  });

  // MESSAGES (+ fallback a memoria)
  router.get('/messages', async (req, res) => {
    try {
      const { instance, remoteJid, limit } = req.query;
      if (!instance) return res.status(400).json({ error: 'Missing "instance"' });
      if (!remoteJid) return res.status(400).json({ error: 'Missing "remoteJid"' });

      const jid = String(remoteJid);
      if (!/@/.test(jid)) {
        return res.status(400).json({ error: 'remoteJid debe terminar en @s.whatsapp.net o @g.us' });
      }

      console.log('[HTTP] GET /api/messages inst=', instance, 'jid=', jid, 'limit=', limit);
      const msgs = await fetchMessagesCompat(instance, jid, limit ? Number(limit) : 50);
      let out = Array.isArray(msgs) ? msgs : [];

      if (!out.length) {
        // fallback a memoria (lo que llegó por webhook)
        out = memoryStore.list(String(instance), String(jid), limit ? Number(limit) : 50);
        console.log('[HTTP] /api/messages -> FALLBACK memory count=', out.length);
      } else {
        console.log('[HTTP] /api/messages -> evo count=', out.length);
      }

      return res.json({ messages: out });
    } catch (e) {
      const status = e?.response?.status || 500;
      const payload = e?.response?.data || e.message;
      console.error('[messages ERROR]', status, payload);
      res.status(500).json({ error: payload, status });
    }
  });

  // SEND TEXT
  router.post('/send', async (req, res) => {
    try {
      const { instance, number, text, quoted } = req.body || {};
      if (!instance || !number || !text) return res.status(400).json({ error: 'instance, number, text are required' });
      if (!/@/.test(String(number))) return res.status(400).json({ error: 'number debe ser un JID (…@s.whatsapp.net / …@g.us)' });

      console.log('[HTTP] POST /api/send instance=%s to=%s len=%d', instance, number, text?.length || 0);
      const out = await sendText(instance, number, text, quoted);
      console.log('[sendText] instance=%s to=%s ok', instance, number);

      // también lo metemos a memoria para que aparezca al instante
      const optimistic = { key:{ id:`tmp-${Date.now()}`, fromMe:true, remoteJid: number }, message:{ conversation: text } };
      memoryStore.push(String(instance), String(number), [optimistic]);

      res.json(out);
    } catch (e) {
      const status = e?.response?.status || 500;
      const payload = e?.response?.data || e.message;
      console.error('[send ERROR]', status, payload);
      res.status(500).json({ error: payload, status });
    }
  });

  return router;
}
