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

/**
 * CORS ULTRA-COMPTATIBLE (primero de todo)
 * - Devuelve siempre los headers CORS
 * - Maneja OPTIONS (preflight) con 204
 * - Permite header x-backend-key
 * - Varia por Origin para caches
 */
app.use((req, res, next) => {
  const origin = req.headers.origin || '*';
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-backend-key');
  // No usamos credenciales (cookies) así que no seteamos Allow-Credentials
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  return next();
});

// (Opcional) también dejamos cors() para compatibilidad con libs que lo lean
app.use(cors({
  origin: (_origin, cb) => cb(null, true),
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'x-backend-key'],
  credentials: false,
  maxAge: 86400,
  optionsSuccessStatus: 204
}));

// Resto de middlewares
app.use(helmet());
app.use(express.json({ limit: '5mb' }));
app.use(morgan('dev'));

// Socket.IO con CORS abierto
const io = new SocketIOServer(server, {
  cors: {
    origin: true, // refleja el Origin
    methods: ['GET', 'POST']
  }
});

// Webhook sin auth del frontend
app.use('/api', makeWebhookRouter(io));

// API con auth simple
app.use('/api', routes);

// WebSocket
io.on('connection', socket => {
  socket.on('join', ({ instance }) => {
    if (instance) socket.join(String(instance));
  });
});

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
  console.log(`[Backend] Listening on port ${PORT}`);
});
