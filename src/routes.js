// backend/src/routes.js
import express from 'express';
import {
  evo,
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
  // Varios formatos: message.conversation, extendedTextMessage.text, caption, text, body
  const m = msg?.message ?? msg?.body ?? msg ?? {};
  if (typeof m?.conversation === 'string' && m.conversation) return m.conversation;
  const ext = m?.extendedTextMessage ?? {};
  if (typeof ext?.text === 'string' && ext.text) return ext.text;
  if (typeof m?.caption === 'string' && m.caption) return m.caption;
  if (typeof msg?.text === 'string' && msg.text) return msg.text;
  if (typeof msg?.body === 'string' && msg.body) return msg.body;
  return '';
}

// Devuelve true si el payload de estado denota "conectado"
function isConnectedStatePayload(js = {}) {
  try {
    const b = js?.body ?? js ?? {};
    const s = (b?.instance?.state || b?.state || js?.state || '').toString().toLowerCase();
    return s === 'open' || s === 'connected';
  } catch {
    return false;
  }
}

// Convierte cualquier forma de "QR" que devuelva Evolution en un único string
function pickQrField(obj = {}) {
  return obj?.code || obj?.qrcode || obj?.qrCode || obj?.base64 || obj?.dataUrl || null;
}

function pickPairingField(obj = {}) {
  return obj?.pairingCode || obj?.pairing_code || obj?.pin || obj?.code_short || null;
}

// Normaliza el/los eventos que manda Evolution a una lista de mensajes individuales
function* iterateIncomingMessages(payload) {
  // Puede venir: objeto, arreglo de objetos, o "envoltura" { event, instanceName, data }
  const events = Array.isArray(payload) ? payload : [payload];

  for (const ev of events) {
    // Caso "envoltura": { event, instanceName, data: {...} }
    if (ev && typeof ev === 'object' && 'event' in ev && 'data' in ev) {
      const d = ev.data ?? {};
      // data.messages puede ser lista, un objeto o ausente
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
      // A veces el propio data trae key/message/...
      if (d && typeof d === 'object') {
        yield d;
        continue;
      }
      // Si data raramente fuera un array "crudo"
      if (Array.isArray(d)) {
        for (const m of d) yield m;
        continue;
      }
      // Si no hay nada util, seguimos con el siguiente evento
      continue;
    }

    // Caso crudo: un mensaje estilo Baileys o un array de ellos
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
    res.json(data);
  } catch (e) {
    console.error('[instances ERROR]', e?.response?.status, e?.response?.data || e.message);
    res.status(500).json({ error: e?.response?.data || e.message });
  }
});

/* -------------------- Connection state + QR -------------------- */
router.get('/instance/:instance/connection', async (req, res) => {
  try {
    const { instance } = req.params;
    const fresh = req.query.fresh === '1';

    const st = await connectionState(instance);
    const connected = isConnectedStatePayload(st);

    let qr = null;
    let pairingCode = null;

    if (!connected && fresh) {
      try {
        const conn = await connect(instance);
        qr = pickQrField(conn) || null;
        pairingCode = pickPairingField(conn) || null;
      } catch (err) {
        console.warn('[connection fresh connect warn]', err?.response?.data || err?.message);
      }
    }

    // 👉 ahora devolvemos un booleano explícito
    res.json({ state: st, connected, qr, pairingCode });
  } catch (e) {
    console.error('[connection ERROR]', e?.response?.status, e?.response?.data || e.message);
    res.status(500).json({ error: e?.response?.data || e.message });
  }
});



/* -------------------- Crear instancia (v2.1.x / v2.3.x) -------------------- */
router.post('/instance', async (req, res) => {
  try {
    const {
      instanceName,
      integration = 'WHATSAPP-BAILEYS',
      qrcode = true,
      alwaysOnline = true,
      readMessages = true,
      readStatus = true,
      syncFullHistory = false
    } = req.body || {};

    if (!instanceName) {
      return res.status(400).json({ error: 'instanceName requerido' });
    }

    const backendBase = process.env.BACKEND_PUBLIC_URL
      ? process.env.BACKEND_PUBLIC_URL.replace(/\/$/, '')
      : null;

    const payload = {
      instanceName,
      integration,
      qrcode,
      alwaysOnline,
      readMessages,
      readStatus,
      syncFullHistory
    };

    if (backendBase) {
      payload.webhook = `${backendBase}/api/wa/webhook?token=${encodeURIComponent(process.env.WEBHOOK_TOKEN || 'evolution')}&instance={{instance}}`;
      payload.webhook_by_events = true;
      payload.events = [
        'APPLICATION_STARTUP',
        'QRCODE_UPDATED',
        'CONNECTION_UPDATE',
        'MESSAGES_UPSERT'
      ];
      payload.webhook_base64 = true;
    }

    const created = await evo.post('/instance/create', payload).then(r => r.data);

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

/* -------------------- Chats / Messages passthrough -------------------- */
router.post('/chat/find', async (req, res) => {
  try {
    const { instance } = req.body;
    const data = await findChats(instance);
    res.json(data);
  } catch (e) {
    console.error('[chat/find ERROR]', e?.response?.status, e?.response?.data || e.message);
    res.status(500).json({ error: e?.response?.data || e.message });
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
    const { instance, messages } = req.body; // messages: [{ remoteJid, fromMe, id }]
    const data = await markAsRead(instance, messages);
    res.json(data);
  } catch (e) {
    console.error('[messages/mark-read ERROR]', e?.response?.status, e?.response?.data || e.message);
    res.status(500).json({ error: e?.response?.data || e.message });
  }
});

/* -------------------- Forzar connect (QR/pairing normalizado) -------------------- */
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


/* -------------------- WEBHOOK Evolution (¡NUEVO!) -------------------- */
// Aceptar GET (ping) y POST (eventos). También soporta /webhook/:event
router.all(['/webhook', '/webhook/:event'], async (req, res) => {
  try {
    const { event } = req.params || {};
    const token = String(req.query?.token || '');
    const instance = req.query?.instance ? String(req.query.instance) : undefined;

    // 1) auth por token query
    const expected = process.env.WEBHOOK_TOKEN || 'evolution';
    if (token !== expected) {
      return res.status(403).json({ ok: false, error: 'invalid token' });
    }

    // 2) GET = ping
    if (req.method === 'GET') {
      return res.json({ ok: true, ping: 'ok', instance, event: event || null });
    }

    // 3) leer body “tal cual”
    const payload = req.body ?? {};
    // Log básico no intrusivo
    try {
      const len = Buffer.isBuffer(req.rawBody)
        ? req.rawBody.length
        : Buffer.byteLength(JSON.stringify(payload || {}));
      console.log('[WEBHOOK] POST', req.originalUrl, '| len=', len, '| qs=', req.query);
    } catch { /* noop */ }

    // 4) Normalizar mensajes
    let saved = 0;
    for (const msg of iterateIncomingMessages(payload)) {
      try {
        const key = msg?.key || {};
        const fromMe = Boolean(key?.fromMe);
        let remoteJid =
          key?.remoteJid ||
          msg?.remoteJid ||
          msg?.jid ||
          '';

        if (!remoteJid) {
          const num = String(msg?.number || '').replace(/\D+/g, '');
          if (num) remoteJid = `${num}@s.whatsapp.net`;
        }

        if (!remoteJid) continue;

        const jidNorm = normalizeJid(remoteJid);
        const text = extractText(msg);
        const ts =
          msg?.messageTimestamp ||
          msg?.timestamp ||
          Math.floor(Date.now() / 1000);

        // Aquí podrías persistir a DB si lo deseas.
        // Por ahora, sólo logueamos entrantes (fromMe === false) con texto.
        if (fromMe === false && text) {
          console.log('[WEBHOOK] INCOMING',
            { instance, jid: jidNorm, number: numberFromJid(jidNorm), text, ts });
          saved += 1;
        }
      } catch (err) {
        console.warn('[WEBHOOK] normalize error:', err?.message);
      }
    }

    // 5) Siempre devolver 200 para evitar reintentos si el body estaba “raro”
    return res.json({
      ok: true,
      instance: instance || null,
      event: event || null,
      saved
    });
  } catch (e) {
    // Nunca 500 por estructura desconocida; devuelve 200 con detalle
    console.error('[WEBHOOK] handler error:', e?.message);
    return res.json({ ok: true, note: 'handled-with-warning', warn: e?.message || String(e) });
  }
});

export default router;
