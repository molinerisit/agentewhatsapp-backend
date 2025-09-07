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
const io = new SocketIOServer(server, { cors: { origin: true, methods: ['GET','POST'] } });

// Logs de arranque
const mask = (s='') => String(s).slice(0,4) + '***';
console.log('[BOOT] PORT=', process.env.PORT || 8080);
console.log('[BOOT] EVOLUTION_API_URL=', process.env.EVOLUTION_API_URL || '(missing)');
console.log('[BOOT] EVOLUTION_API_KEY=', process.env.EVOLUTION_API_KEY ? mask(process.env.EVOLUTION_API_KEY) : '(missing)');

// Middlewares
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

// Health
app.get('/api/health', (_req, res) => res.json({ ok:true, now:new Date().toISOString(), uptime:process.uptime() }));

// Static UI
app.use('/', express.static(path.resolve('public')));

// 🔒 Montaje del webhook con guardas fuertes
let webhookMounted = false;
try {
  if (typeof makeWebhookRouter === 'function') {
    const webhookRouter = makeWebhookRouter(io);
    if (webhookRouter && typeof webhookRouter === 'function') {
      app.use('/api', webhookRouter);
      webhookMounted = true;
      console.log('[BOOT] Webhook router montado en /api/webhook');
    } else {
      console.error('[BOOT] makeWebhookRouter() NO devolvió un Router válido');
    }
  } else {
    console.error('[BOOT] makeWebhookRouter NO es una función. Revisa export default en ./webhook.js');
  }
} catch (err) {
  console.error('[BOOT] Error montando webhook router:', err);
}

// REST API
if (!routes || typeof routes !== 'function') {
  throw new Error('routes.js no exporta default un express.Router()');
}
app.use('/api', routes);

// 404 para APIs
app.use('/api', (_req, res) => res.status(404).json({ error: 'Not Found' }));

// Error handler
app.use((err, _req, res, _next) => {
  console.error('[HTTP ERROR]', err?.stack || err);
  res.status(500).json({ error: err?.message || 'Internal Server Error' });
});

// Socket.IO
io.on('connection', (socket) => {
  console.log('[SOCKET] connected id=', socket.id);

  socket.on('join', ({ instance }) => {
    if (instance) {
      socket.join(String(instance));
      console.log('[SOCKET]', socket.id, 'joined room=', String(instance));
    }
  });

  socket.on('joinChat', ({ room }) => {
    if (room) {
      socket.join(String(room));
      console.log('[SOCKET]', socket.id, 'joined room=', String(room));
    }
  });

  socket.on('disconnect', (reason) => {
    console.log('[SOCKET] disconnected id=', socket.id, 'reason=', reason);
  });
});

process.on('unhandledRejection', (e) => console.error('[UNHANDLED REJECTION]', e));
process.on('uncaughtException', (e) => console.error('[UNCAUGHT EXCEPTION]', e));

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
  console.log(`[Minimal] Listening on port ${PORT} — webhook=${webhookMounted ? 'ON':'OFF'}`);
});
