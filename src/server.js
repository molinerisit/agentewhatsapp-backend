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

// CORS básico + logs
app.use((req, res, next) => {
  const origin = req.headers.origin || '*';
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.use(cors({ origin: (_o, cb) => cb(null, true) }));
app.use(helmet());
app.use(express.json({ limit: '5mb' }));
app.use(morgan('dev'));

// UI estática
app.use('/', express.static('public'));

// Webhook Evolution
app.use('/api', makeWebhookRouter(io));

// REST
app.use('/api', routes);

// Sockets
io.on('connection', socket => {
  console.log('[SOCKET] client connected', socket.id);
  socket.on('join', ({ instance }) => {
    console.log('[SOCKET] join', socket.id, 'instance=', instance);
    if (instance) socket.join(String(instance));
  });
  socket.on('disconnect', reason => {
    console.log('[SOCKET] client disconnected', socket.id, 'reason=', reason);
  });
});

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
  console.log(`[Minimal] Listening on port ${PORT}`);
});
