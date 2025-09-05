import express from 'express';
import http from 'http';
import { Server as SocketIOServer } from 'socket.io';
import cors from 'cors';
import morgan from 'morgan';
import dotenv from 'dotenv';
import api from './services/evolution.js';
dotenv.config();

const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(morgan('dev'));

/**
 * =========================
 * CORS por variables de entorno
 * =========================
 * - CORS_ORIGINS: lista separada por comas (ej: "https://tu-frontend.vercel.app,http://localhost:5173")
 *                 o "*" para permitir todos los orígenes (solo si NO usás credenciales).
 * - CORS_CREDENTIALS: "true" | "false"  (si usás "*", esto se fuerza a false)
 * - ALLOWED_HEADERS: lista separada por comas (default: "Content-Type, Authorization, X-Requested-With")
 * - FRONTEND_ORIGIN: compat. hacia atrás; si no hay CORS_ORIGINS, toma este valor
 */
const envOrigins =
  process.env.CORS_ORIGINS?.trim() ||
  process.env.FRONTEND_ORIGIN?.trim() || // compat
  'http://localhost:5173';

const ORIGINS = envOrigins.split(',').map(s => s.trim()).filter(Boolean);
const ANY = ORIGINS.includes('*');

const CREDENTIALS_ENV = String(process.env.CORS_CREDENTIALS || 'false').toLowerCase() === 'true';
// Si se usa "*", no se pueden usar credenciales (norma del navegador)
const CREDENTIALS = ANY ? false : CREDENTIALS_ENV;

const ALLOWED_HEADERS = (process.env.ALLOWED_HEADERS || 'Content-Type, Authorization, X-Requested-With')
  .split(',').map(s => s.trim());

const corsOptions = {
  origin(origin, cb) {
    if (!origin) return cb(null, true);
    if (ANY) return cb(null, true);
    if (ORIGINS.includes(origin)) return cb(null, true);
    return cb(new Error(`CORS blocked: ${origin}`));
  },
  credentials: CREDENTIALS,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  // 👇 QUITAR ESTA LÍNEA PARA QUE cors REFLEJE LO QUE PIDA EL NAVEGADOR
  // allowedHeaders: ALLOWED_HEADERS 
};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions));


// Aplicar CORS y responder preflight
app.use(cors(corsOptions));
app.options('*', cors(corsOptions)); // importante para OPTIONS

// HTTP server + Socket.IO (con la misma política CORS)
const server = http.createServer(app);
const io = new SocketIOServer(server, {
  cors: {
    origin: ANY ? '*' : ORIGINS,
    methods: ['GET', 'POST'],
    credentials: CREDENTIALS
  }
});

io.on('connection', socket => {
  console.log('Socket connected', socket.id);
  socket.on('disconnect', () => console.log('Socket disconnected', socket.id));
});

// ---- Helpers para emitir eventos al frontend
function emit(event, payload) {
  io.emit(event, payload);
}

// ---- Rutas REST ligeras que proxyean Evolution API
app.get('/health', (req, res) => res.json({ ok: true }));

app.get('/instances', async (req, res) => {
  try {
    const data = await api.listInstances();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: formatErr(err) });
  }
});

app.post('/instances', async (req, res) => {
  try {
    const { name } = req.body;
    const data = await api.createInstance(name);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: formatErr(err) });
  }
});

app.delete('/instances/:id', async (req, res) => {
  try {
    const data = await api.deleteInstance(req.params.id);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: formatErr(err) });
  }
});

app.get('/instances/:id/qr', async (req, res) => {
  try {
    const data = await api.getQr(req.params.id);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: formatErr(err) });
  }
});

app.get('/instances/:id/state', async (req, res) => {
  try {
    const data = await api.getState(req.params.id);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: formatErr(err) });
  }
});

app.get('/instances/:id/chats', async (req, res) => {
  try {
    const data = await api.listChats(req.params.id);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: formatErr(err) });
  }
});

app.get('/instances/:id/messages', async (req, res) => {
  try {
    const { jid, cursor } = req.query;
    const data = await api.listMessages(req.params.id, jid, cursor);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: formatErr(err) });
  }
});

app.post('/instances/:id/messages', async (req, res) => {
  try {
    const { to, text } = req.body;
    const data = await api.sendText(req.params.id, to, text);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: formatErr(err) });
  }
});

// Webhook para eventos entrantes desde Evolution
app.post('/webhook/evolution', (req, res) => {
  const secret = req.query.secret;
  if (process.env.WEBHOOK_SECRET && secret !== process.env.WEBHOOK_SECRET) {
    return res.status(401).json({ error: 'Invalid webhook secret' });
  }
  // Reenviar todo al frontend
  emit('evolution:event', req.body);
  res.json({ ok: true });
});

// 404
app.use((req, res) => res.status(404).json({ error: 'Not found' }));

// Error handler
function formatErr(err) {
  if (!err) return 'Unknown error';
  if (err.response) {
    return {
      status: err.response.status,
      data: err.response.data
    };
  }
  return String(err.message || err);
}

const port = process.env.PORT || 4000;
server.listen(port, () => {
  console.log('Backend listening on port', port);
  console.log('CORS_ORIGINS:', ORIGINS.join(', '));
  console.log('CREDENTIALS:', CREDENTIALS);
});
