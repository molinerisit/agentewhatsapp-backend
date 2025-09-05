// backend/src/routes.js
import express from 'express';
import {
  fetchInstances,
  connectionState,
  connect,
  sendText,
  findChats,
  findMessages,
  markAsRead
} from './evoClient.js';

const router = express.Router();

/* -------------------- Helpers -------------------- */

function normalizeJid(input = '') {
  const s = String(input || '').trim();
  if (!s) return '';
  if (s.includes('@s.whatsapp.net')) return s;
  const digits = s.replace(/\D+/g, '');
  return digits ? `${digits}@s.whatsapp.net` : s;
}

function numberFromJid(jid = '') {
  return String(jid || '').split('@', 1)[0];
}

function extractText(msg = {}) {
  const m = msg?.message ?? msg?.body ?? msg ?? {};
  if (typeof m?.conversation === 'string' && m.conversation) return m.conversation;
  const ext = m?.extendedTextMessage ?? {};
  if (typeof ext?.text === 'string' && ext.text) return ext.text;
  if (typeof m?.caption === 'string' && m.caption) return m.caption;
  if (typeof msg?.text === 'string' && msg.text) return msg.text;
  if (typeof msg?.body === 'string' && msg.body) return msg.body;
  return '';
}

function* iterateIncomingMessages(payload) {
  const events = Array.isArray(payload) ? payload : [payload];
  for (const ev of events) {
    if (ev && typeof ev === 'object' && 'event' in ev && 'data' in ev) {
      const d = ev.data ?? {};
      if (Array.isArray(d.messages)) {
        for (const m of d.messages) yield m;
        continue;
      }
      if (Array.isArray(d.data)) {
        for (const m of d.data) yield m;
        continue;
      }
      if (Array.isArray(d.message)) {
        for (const m of d.message) yield m;
        continue;
      }
      if (d.messages && typeof d.messages === 'object') {
        yield d.messages;
        continue;
      }
      if (d.message && typeof d.message === 'object') {
        yield d.message;
        continue;
      }
      if (Array.isArray(d)) {
        for (const m of d) yield m;
        continue;
      }
      continue;
    }
    if (Array.isArray(ev)) {
      for (const m of ev) yield m;
      continue;
    }
    if (ev && typeof ev === 'object') {
      yield ev;
    }
  }
}

/* -------------------- Auth simple para el front -------------------- */
router.use((req, res, next) => {
  const key = req.header('x-backend-key');
  if (!process.env.BACKEND_API_KEY) return next();
  if (key !== process.env.BACKEND_API_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
});

/* -------------------- Health -------------------- */
router.get('/health', (req, res) => res.json({ ok: true, uptime: process.uptime() }));

/* -------------------- Instances -------------------- */
router.get('/instances', async (req, res) => {
  try {
    const data = await fetchInstances();
    return res.json({ ok: true, instances: data });
  } catch (e) {
    console.error('[instances ERROR]', e?.response?.status, e?.response?.data || e.message);
    return res.status(200).json({
      ok: false,
      instances: [],
      error: e?.response?.data || e.message
    });
  }
});

/* -------------------- Connection state -------------------- */
router.get('/instance/:instance/connection', async (req, res) => {
  try {
    const { instance } = req.params;
    const state = await connectionState(instance);
    res.json({ state });
  } catch (e) {
    console.error('[connection ERROR]', e?.response?.status, e?.response?.data || e.message);
    res.status(500).json({ error: e?.response?.data || e.message });
  }
});

/* -------------------- Crear instancia -------------------- */
router.post('/instance', async (req, res) => {
  try {
    const { instanceName } = req.body || {};
    if (!instanceName) {
      return res.status(400).json({ error: 'instanceName requerido' });
    }
    // aquí llamarías a Evolution para crear la instancia, simplificado:
    const created = { instanceName };
    let connectData = null;
    try {
      connectData = await connect(instanceName);
    } catch (err) {
      console.warn('[Create->Connect warning]', err?.response?.data || err?.message);
    }
    res.json({ ok: true, created, connect: connectData });
  } catch (e) {
    console.error('[Create Instance ERROR]', e?.response?.status, e?.response?.data || e.message);
    res.status(500).json({ error: e?.response?.data || e.message });
  }
});

/* -------------------- Chats / Messages -------------------- */
router.post('/chat/find', async (req, res) => {
  try {
    const { instance } = req.body;
    const chats = await findChats(instance);
    return res.json({ ok: true, chats });
  } catch (e) {
    console.error('[chat/find ERROR]', e?.response?.status, e?.response?.data || e.message);
    return res.status(200).json({ ok: false, chats: [], error: e?.response?.data || e.message });
  }
});

router.post('/messages/find', async (req, res) => {
  try {
    const { instance, remoteJid, limit } = req.body;
    const data = await findMessages(instance, { remoteJid, limit });
    res.json(data);
  } catch (e) {
    console.error('[messages/find ERROR]', e?.response?.status, e?.response?.data || e.message);
    res.status(500).json({ error: e?.response?.data || e.message });
  }
});

router.post('/messages/send', async (req, res) => {
  try {
    const { instance, number, text, quoted } = req.body;
    const data = await sendText(instance, { number, text, quoted });
    res.json(data);
  } catch (e) {
    console.error('[messages/send ERROR]', e?.response?.status, e?.response?.data || e.message);
    res.status(500).json({ error: e?.response?.data || e.message });
  }
});

router.post('/messages/mark-read', async (req, res) => {
  try {
    const { instance, messages } = req.body;
    const data = await markAsRead(instance, messages);
    res.json(data);
  } catch (e) {
    console.error('[messages/mark-read ERROR]', e?.response?.status, e?.response?.data || e.message);
    res.status(500).json({ error: e?.response?.data || e.message });
  }
});

/* -------------------- Forzar connect -------------------- */
router.get('/instance/:instance/connect', async (req, res) => {
  try {
    const { instance } = req.params;
    const conn = await connect(instance);
    const code = conn?.code || conn?.qrcode || conn?.base64 || null;
    const pairingCode = conn?.pairingCode || conn?.pairing_code || null;
    res.json({ ok: true, code, pairingCode, raw: conn });
  } catch (e) {
    console.error('[instance/connect ERROR]', e?.response?.status, e?.response?.data || e?.message);
    res.status(500).json({ error: e?.response?.data || e.message });
  }
});

/* -------------------- WEBHOOK Evolution -------------------- */
router.all(['/webhook', '/webhook/:event'], async (req, res) => {
  try {
    const { event } = req.params || {};
    const token = String(req.query?.token || '');
    const expected = process.env.WEBHOOK_TOKEN || 'evolution';
    if (token !== expected) {
      return res.status(403).json({ ok: false, error: 'invalid token' });
    }
    if (req.method === 'GET') {
      return res.json({ ok: true, ping: 'ok', instance: req.query?.instance || null, event: event || null });
    }
    const payload = req.body ?? {};
    let saved = 0;
    for (const msg of iterateIncomingMessages(payload)) {
      try {
        const key = msg?.key || {};
        const fromMe = Boolean(key?.fromMe);
        let remoteJid = key?.remoteJid || msg?.remoteJid || msg?.jid || '';
        if (!remoteJid) {
          const num = String(msg?.number || '').replace(/\D+/g, '');
          if (num) remoteJid = `${num}@s.whatsapp.net`;
        }
        if (!remoteJid) continue;
        const jidNorm = normalizeJid(remoteJid);
        const text = extractText(msg);
        if (fromMe === false && text) {
          console.log('[WEBHOOK] INCOMING', { instance: req.query?.instance, jid: jidNorm, number: numberFromJid(jidNorm), text });
          saved += 1;
        }
      } catch (err) {
        console.warn('[WEBHOOK] normalize error:', err?.message);
      }
    }
    return res.json({ ok: true, instance: req.query?.instance || null, event: event || null, saved });
  } catch (e) {
    console.error('[WEBHOOK] handler error:', e?.message);
    return res.json({ ok: true, note: 'handled-with-warning', warn: e?.message || String(e) });
  }
});

export default router;
