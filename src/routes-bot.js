// src/routes-bot.js
import express from 'express';
import multer from 'multer';
import { getBotConfig, upsertBotConfig } from './bot/config.js';
import { ingestPdf, ragSearch } from './bot/rag.js';
import { queryExternalDb } from './bot/sqlgen.js';

const upload = multer({ limits: { fileSize: 10 * 1024 * 1024 } });
const router = express.Router();

router.get('/bot/config', async (req,res) => {
  try {
    const { instance } = req.query;
    if (!instance) return res.status(400).json({ error: 'Missing instance' });
    const cfg = await getBotConfig(instance);
    res.json({ config: cfg });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/bot/config', express.json(), async (req,res) => {
  try {
    const { instance, mode, externalDbUrl, ragEnabled, writeEnabled, confirmRequired } = req.body || {};
    if (!instance || !mode) return res.status(400).json({ error: 'instance & mode required' });
    const out = await upsertBotConfig({
      instanceId: instance,
      mode,
      externalDbUrl: externalDbUrl || null,
      ragEnabled: ragEnabled !== false,
      writeEnabled: !!writeEnabled,
      confirmRequired: confirmRequired !== false
    });
    res.json({ ok:true, config: out });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/bot/upload', upload.single('file'), async (req,res) => {
  try {
    const { instance } = req.query;
    if (!instance) return res.status(400).json({ error: 'Missing instance' });
    if (!req.file) return res.status(400).json({ error: 'Missing file' });
    const out = await ingestPdf(instance, req.file.buffer, req.file.originalname);
    res.json({ ok:true, ...out });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/bot/search', async (req,res) => {
  try {
    const { instance, q } = req.query;
    if (!instance || !q) return res.status(400).json({ error: 'instance & q required' });
    const hits = await ragSearch(instance, q, 5);
    res.json({ hits });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/bot/query', async (req,res) => {
  try {
    const { dbUrl, q } = req.query;
    if (!dbUrl || !q) return res.status(400).json({ error: 'dbUrl & q required' });
    const out = await queryExternalDb(dbUrl, q);
    res.json(out);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

export default router;
