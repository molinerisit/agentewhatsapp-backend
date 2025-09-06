import 'dotenv/config';
import express from 'express';
import http from 'http';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { Server as SocketIOServer } from 'socket.io';

// Rutas REST propias (ya las tenés): /api/chats, /api/messages, /api/send
import routes from './routes.js';

const app = express();
const server = http.createServer(app);
const io = new SocketIOServer(server, {
  cors: { origin: true, methods: ['GET', 'POST'] }
});

// ------------------- Middlewares base -------------------
app.use((req, res, next) => {
  const origin = req.headers.origin || '*';
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Requested-With');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});
app.use(cors({ origin: (_o, cb) => cb(null, true) }));
app.use(helmet());
app.use(express.json({ limit: '5mb' }));

// Morgan + logger simple extra
app.use(morgan(':method :url :status :response-time ms - :res[content-length]'));

// ------------------- Archivos estáticos (frontend) -------------------
app.use('/', express.static('public'));

// ------------------- Sockets -------------------
io.on('connection', (socket) => {
  console.log('[SOCKET] client connected id=%s', socket.id);

  socket.on('join', ({ instance }) => {
    const room = String(instance || 'default');
    socket.join(room);
    console.log('[SOCKET] %s joined room=%s', socket.id, room);
  });

  socket.on('disconnect', (reason) => {
    console.log('[SOCKET] client disconnected id=%s reason=%s', socket.id, reason);
  });
});

// ------------------- Webhook Evolution -------------------
// Acepta múltiples nombres de evento y formatos.
// Emitimos SIEMPRE por 'message_upsert' con payload normalizado {instance, remoteJid?, messages:[]}
app.post('/api/webhook', async (req, res) => {
  try {
    const token = req.query.token;
    const expected = process.env.WEBHOOK_TOKEN;
    if (expected && token !== expected) {
      console.warn('[WEBHOOK] invalid token=%s expected=%s', token, expected);
      return res.status(401).json({ ok: false, error: 'Invalid token' });
    }

    const instance =
      req.query.instance ||
      req.body?.instance ||
      req.headers['x-evolution-instance'] ||
      'unknown';

    // nombre del evento (varía según build)
    const rawEvent =
      req.body?.event ||
      req.query.event ||
      req.headers['x-evolution-event'] ||
      req.body?.type ||
      'UNKNOWN';

    // estructura del body (puede variar)
    const body = req.body || {};
    const possibleArrays = [
      body.messages,
      body.data?.messages,
      body.data,
      Array.isArray(body) ? body : null,
    ].filter(Boolean);

    let messages = [];
    for (const a of possibleArrays) {
      if (Array.isArray(a)) { messages = a; break; }
    }

    // Si viene un único mensaje suelto:
    if (!messages.length && (body.message || body.msg)) {
      messages = [body.message || body.msg];
    }

    // Intento de remoteJid top-level (no siempre está)
    const remoteJid =
      body.remoteJid ||
      body.chatId ||
      messages?.[0]?.key?.remoteJid ||
      messages?.[0]?.remoteJid ||
      null;

    const normalized = { instance, remoteJid, messages };

    console.log(
      '[WEBHOOK] event=%s instance=%s msgs=%d keys=%o',
      rawEvent,
      instance,
      messages.length,
      Object.keys(body)
    );

    // Emitimos por canal general y por sala de instancia
    io.emit('message_upsert', normalized);
    io.to(String(instance)).emit('message_upsert', normalized);

    return res.json({ ok: true });
  } catch (e) {
    console.error('[WEBHOOK ERROR]', e?.stack || e?.message);
    return res.status(200).json({ ok: true }); // no queremos que Evolution reintente infinito
  }
});

// ------------------- Endpoints de DEBUG -------------------
const debugRouter = express.Router();

// Ver rápidamente si el backend recibe POST desde afuera (útil para probar WEBHOOK_URL)
debugRouter.post('/echo', (req, res) => {
  console.log('[DEBUG /echo] headers=%o body=%o', req.headers, req.body);
  res.json({ ok: true, got: req.body });
});

// Simular un message_upsert para probar el front sin depender de Evolution
debugRouter.post('/mock-upsert', (req, res) => {
  const instance = req.body?.instance || req.query.instance || 'Orbytal';
  const remoteJid = req.body?.remoteJid || '5493413738775@s.whatsapp.net';
  const text = req.body?.text || `mock ${Date.now()}`;

  const msg = {
    key: { id: `mock-${Date.now()}`, remoteJid, fromMe: false },
    message: { conversation: text },
    messageTimestamp: Date.now()
  };

  const payload = { instance, remoteJid, messages: [msg] };

  console.log('[DEBUG mock-upsert] emit -> instance=%s jid=%s text=%s', instance, remoteJid, text);

  io.emit('message_upsert', payload);
  io.to(String(instance)).emit('message_upsert', payload);

  res.json({ ok: true, sent: payload });
});

app.use('/api/debug', debugRouter);

// ------------------- Rutas REST (chats/messages/send) -------------------
app.use('/api', routes);

// ------------------- Arranque -------------------
const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
  console.log(`[Minimal] Listening on port ${PORT}`);
  if (process.env.WEBHOOK_TOKEN) {
    console.log('[CFG] WEBHOOK_TOKEN set');
  } else {
    console.warn('[CFG] WEBHOOK_TOKEN is NOT set (webhook /api/webhook no validará token)');
  }
});
