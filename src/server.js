// src/server.js
import 'dotenv/config';
import express from 'express';
import http from 'http';
import { Server as SocketIOServer } from 'socket.io';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import routes from './routes.js';
import makeWebhookRouter from './webhook.js';

const app = express();
const server = http.createServer(app);
const io = new SocketIOServer(server, {
  cors: { origin: true, methods: ['GET', 'POST'] }
});

// ---------- Boot logs ----------
console.log('[BOOT] ENV PORT=', process.env.PORT || 8080);
console.log('[BOOT] ENV WEBHOOK_TOKEN set =', !!process.env.WEBHOOK_TOKEN);
console.log('[BOOT] Timezone =', process.env.TZ || 'default');

// ---------- Trust proxy (si estás detrás de Railway/Heroku/Render) ----------
app.set('trust proxy', 1);

// ---------- Seguridad / CORS / Parsers ----------
app.use((req, res, next) => {
  const origin = req.headers.origin || '*';
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-evolution-instance, x-evolution-event');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});
app.use(cors({ origin: (_o, cb) => cb(null, true) }));
app.use(helmet());
app.use(express.json({ limit: '10mb' }));
app.use(morgan('dev'));

// ---------- Estáticos del Front ----------
app.use('/', express.static('public'));

// ---------- Socket.IO ----------
io.on('connection', socket => {
  console.log('[SOCKET] client connected id=' + socket.id);

  // El front puede llamar: socket.emit('join', { instance, remoteJid })
  socket.on('join', ({ instance, remoteJid }) => {
    if (instance) {
      socket.join(String(instance));
      console.log(`[SOCKET] ${socket.id} joined room=${instance}`);
    }
    if (instance && remoteJid) {
      const room = `${instance}:${remoteJid}`;
      socket.join(room);
      console.log(`[SOCKET] ${socket.id} joined room=${room}`);
    }
  });

  socket.on('disconnect', (reason) => {
    console.log(`[SOCKET] ${socket.id} disconnected (${reason})`);
  });
});

// ---------- Webhook Evolution (usa io para emitir eventos) ----------
app.use('/api', makeWebhookRouter(io));

// ---------- Rutas REST (proxy a Evolution + normalización) ----------
app.use('/api', routes);

// ---------- Endpoints de salud / debug ----------
app.get('/api/ping', (_req, res) => res.json({ ok: true, ts: Date.now() }));
app.get('/api/version', (_req, res) => {
  res.json({
    ok: true,
    node: process.version,
    env: {
      PORT: process.env.PORT || '8080',
      TZ: process.env.TZ || '',
      WEBHOOK_TOKEN_SET: !!process.env.WEBHOOK_TOKEN
    }
  });
});

// ---------- 404 handler para API ----------
app.use('/api', (req, res) => {
  console.warn('[HTTP 404]', req.method, req.originalUrl);
  res.status(404).json({ error: 'Not Found' });
});

// ---------- Error handler genérico ----------
app.use((err, _req, res, _next) => {
  console.error('[HTTP ERROR]', err?.stack || err?.message || err);
  res.status(500).json({ error: 'Internal Server Error' });
});

// ---------- Start ----------
const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
  console.log(`[Minimal] Listening on port ${PORT}`);
});
