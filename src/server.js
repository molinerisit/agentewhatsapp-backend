import 'dotenv/config';
import express from 'express';
import http from 'http';
import { Server as SocketIOServer } from 'socket.io';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import makeRoutes from './routes.js';
import makeWebhookRouter from './webhook.js';

// ===== Memoria compartida (instance -> jid -> mensajes)
export const memoryStore = {
  buckets: Object.create(null),
  getBucket(inst, jid) {
    if (!this.buckets[inst]) this.buckets[inst] = Object.create(null);
    if (!this.buckets[inst][jid]) this.buckets[inst][jid] = [];
    return this.buckets[inst][jid];
  },
  push(inst, jid, msgs = []) {
    const b = this.getBucket(inst, jid);
    for (const m of msgs) {
      const id = m?.key?.id || m?.id;
      if (id && b.some(x => (x?.key?.id || x?.id) === id)) continue;
      b.push(m);
    }
    if (b.length > 200) this.buckets[inst][jid] = b.slice(-200);
    return this.buckets[inst][jid];
  },
  list(inst, jid, limit = 50) {
    const b = this.getBucket(inst, jid);
    return b.slice(-Number(limit || 50));
  }
};

const app = express();
const server = http.createServer(app);
const io = new SocketIOServer(server, {
  cors: { origin: true, methods: ['GET', 'POST'] }
});

// CORS simple
app.use((req, res, next) => {
  const origin = req.headers.origin || '*';
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,x-evolution-instance,x-evolution-event');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});
app.use(cors({ origin: (_o, cb) => cb(null, true) }));
app.use(helmet());
app.use(express.json({ limit: '10mb' }));
app.use(morgan('dev'));

// Static UI
app.use('/', express.static('public'));

// Pasamos memoryStore a routers
app.locals.memoryStore = memoryStore;

// Webhook y REST
app.use('/api', makeWebhookRouter(io, memoryStore));
app.use('/api', makeRoutes(memoryStore));

// Sockets
io.on('connection', socket => {
  console.log('[SOCKET] client connected id=' + socket.id);

  socket.on('join', ({ instance, jid }) => {
    if (instance) {
      socket.join(String(instance));
      console.log(`[SOCKET] ${socket.id} joined room=${instance}`);
    }
    if (instance && jid) {
      const room = `${instance}:${jid}`;
      socket.join(room);
      console.log(`[SOCKET] ${socket.id} joined room=${room}`);
    }
  });

  socket.on('disconnect', () => {
    console.log('[SOCKET] client disconnected id=' + socket.id);
  });
});

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
  console.log(`[Minimal] Listening on port ${PORT}`);
});
