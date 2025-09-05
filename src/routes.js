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

// === NUEVO: crear instancia en Evolution ===
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

    // Webhook absoluto opcional: si definís BACKEND_PUBLIC_URL, lo usamos
    const webhookUrl =
      process.env.BACKEND_PUBLIC_URL
        ? `${process.env.BACKEND_PUBLIC_URL.replace(/\/$/, '')}/api/wa/webhook?token=${encodeURIComponent(process.env.WEBHOOK_TOKEN || 'evolution')}&instance={{instance}}`
        : undefined;

    const payload = {
      instanceName,
      integration,
      qrcode,
      alwaysOnline,
      readMessages,
      readStatus,
      syncFullHistory,
      ...(webhookUrl
        ? { webhook: { url: webhookUrl, byEvents: true, base64: true } }
        : {})
    };

    // Llamamos al Evolution para crear la instancia
    const created = await evo.post('/instance/create', payload).then(r => r.data);

    // Opcional: forzar connect para que ya venga code/pairing
    let connectData = null;
    try {
      connectData = await connect(instanceName);
    } catch (_) {}

    res.json({ ok: true, created, connect: connectData });
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

// === NUEVO: forzar connect y devolver QR/pairing ===
router.get('/instance/:instance/connect', async (req, res) => {
  try {
    const { instance } = req.params;
    const conn = await connect(instance);                 // intenta crear/actualizar sesión
    // conn suele traer: { pairingCode, code (QR base64), count, ... }
    res.json({ ok: true, ...conn });
  } catch (e) {
    res.status(500).json({ error: e?.response?.data || e.message });
  }
});


export default router;
