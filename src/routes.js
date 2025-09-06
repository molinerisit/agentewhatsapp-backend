import express from 'express';
import { listChats, listMessages, sendText } from './evo.js';

const router = express.Router();

// ----- helpers de normalización -----
function extractJid(obj) {
  // intenta varias rutas frecuentes
  const candidates = [
    obj?.key?.remoteJid,
    obj?.remoteJid,
    obj?.jid,
    obj?.chatId,
    obj?.id,                    // solo si parece JID (tiene @)
    obj?.lastMessage?.key?.remoteJid,
    obj?.lastMessage?.remoteJid,
    obj?.message?.key?.remoteJid,
  ].filter(Boolean);

  for (const x of candidates) {
    const s = String(x);
    if (/@/.test(s)) return s;
  }
  // algunos devuelven { number: "549..." }
  if (obj?.number) return `${obj.number}@s.whatsapp.net`;
  return null;
}

function extractName(obj) {
  return (
    obj?.name ||
    obj?.pushName ||
    obj?.subject ||
    obj?.displayName ||
    extractJid(obj) ||
    obj?.id ||
    'chat'
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
  return {
    jid,                        // <— **lo que usará el front**
    name: extractName(c),
    preview: extractPreview(c),
    // lo demás por si querés inspeccionar
    _raw: c,
  };
}

// ----- endpoints -----

router.get('/health', (req, res) => res.json({ ok: true, uptime: process.uptime() }));

// Get chats (normalizado con jid)
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

// Get messages
router.get('/messages', async (req, res) => {
  try {
    const { instance, remoteJid, limit } = req.query;
    if (!instance) return res.status(400).json({ error: 'Missing "instance"' });

    // si te mandan un id interno (sin @), devolvé 400 para detectar rápido
    if (remoteJid && !/@/.test(String(remoteJid))) {
      return res.status(400).json({ error: 'remoteJid debe ser un JID válido (…@s.whatsapp.net / …@g.us)' });
    }

    const msgs = await listMessages(instance, { remoteJid, limit: limit ? Number(limit) : 50 });
    const arr = Array.isArray(msgs) ? msgs : (msgs?.messages || msgs?.data || []);
    res.json({ messages: Array.isArray(arr) ? arr : [] });
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
    if (!instance || !number || !text) {
      return res.status(400).json({ error: 'instance, number, text are required' });
    }
    // validar que "number" sea JID
    if (!/@/.test(String(number))) {
      return res.status(400).json({ error: 'number debe ser un JID (…@s.whatsapp.net / …@g.us)' });
    }
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
