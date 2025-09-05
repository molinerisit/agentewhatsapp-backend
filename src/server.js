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

const ORIGIN = process.env.FRONTEND_ORIGIN || 'http://localhost:5173';
app.use(cors({ origin: ORIGIN, credentials: true }));

// HTTP server + Socket.IO
const server = http.createServer(app);
const io = new SocketIOServer(server, {
  cors: { origin: ORIGIN, methods: ['GET','POST'] }
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
});
