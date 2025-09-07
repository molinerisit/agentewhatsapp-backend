// src/server.js
import 'dotenv/config';
import express from 'express';
import http from 'http';
import { Server as SocketIOServer } from 'socket.io';
import helmet from 'helmet';
import morgan from 'morgan';
import cors from 'cors';
import path from 'node:path';
import routes from './routes.js';
import makeWebhookRouter from './webhook.js';

const app = express();
const server = http.createServer(app);
const io = new SocketIOServer(server, {
  cors: { origin: true, methods: ['GET', 'POST'] }
});

// —— Logs de arranque útiles ——
(function bootLog() {
  const mask = (s = '') => String(s).slice(0, 4) + '***';
  console.log('[BOOT] PORT=', process.env.PORT || 8080);
  console.log('[BOOT] EVOLUTION_API_URL=', process.env.EVOLUTION_API_URL || '(missing)');
  console.log('[BOOT] EVOLUTION_API_KEY=', process.env.EVOLUTION_API_KEY ? mask(process.env.EVOLUTION_API_KEY) : '(missing)');
  console.log('[BOOT] WEBHOOK_TOKEN=', process.env.WEBHOOK_TOKEN ? mask(process.env.WEBHOOK_TOKEN) : '(none)');
})();

// —— Middlewares base ——
app.set('trust proxy', 1);
app.use((req, res, next) => {
  const origin = req.headers.origin || '*';
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-evolution-event, x-evolution-instance');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});
app.use(cors({ origin: (_o, cb) => cb(null, true) }));
app.use(helmet());
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(morgan('dev'));

// —— Healthcheck ——
app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    uptime: process.uptime(),
    now: new Date().toISOString(),
  });
});

// —— Static UI (carpeta public) ——
app.use('/', express.static(path.resolve('public')));

// —— Webhook (debe ser SIEMPRE un Router válido) ——
const webhookRouter = makeWebhookRouter?.(io);
if (!webhookRouter) {
  console.error('[BOOT] webhookRouter no construido — revisá export default de ./webhook.js');
} else {
  app.use('/api', webhookRouter);
}

// —— Rutas REST (/api/chats, /api/messages, /api/send, etc.) ——
app.use('/api', routes);

// —— 404 para APIs (después de montar routers) ——
app.use('/api', (_req, res) => res.status(404).json({ error: 'Not Found' }));

// —— Manejo de errores global ——
app.use((err, _req, res, _next) => {
  console.error('[HTTP ERROR]', err?.stack || err);
  res.status(500).json({ error: err?.message || 'Internal Server Error' });
});

// —— Socket.IO ——
io.on('connection', (socket) => {
  console.log('[SOCKET] connected id=', socket.id);

  // Unirse a sala por instancia o a una “sala compuesta” inst:jid (front usa ambos)
  socket.on('join', ({ instance }) => {
    if (!instance) return;
    const room = String(instance);
    socket.join(room);
    console.log('[SOCKET]', socket.id, 'joined room=', room);
  });

  // Compat: suscripción explícita a sala de chat
  socket.on('joinChat', ({ room }) => {
    if (!room) return;
    socket.join(String(room));
    console.log('[SOCKET]', socket.id, 'joined room=', room);
  });

  // Limpieza opcional
  socket.on('disconnect', (reason) => {
    console.log('[SOCKET] disconnected id=', socket.id, 'reason=', reason);
  });
});

// —— Hardening de procesos ——
process.on('unhandledRejection', (e) => {
  console.error('[UNHANDLED REJECTION]', e);
});
process.on('uncaughtException', (e) => {
  console.error('[UNCAUGHT EXCEPTION]', e);
});

// —— Start ——
const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
  console.log(`[Minimal] Listening on port ${PORT}`);
});
