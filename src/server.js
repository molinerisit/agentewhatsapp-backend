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
  cors: {
    origin: (process.env.CORS_ORIGIN || '*').split(',').map(s => s.trim()),
    methods: ['GET', 'POST']
  }
});

// Middlewares
app.use(helmet());
app.use(express.json({ limit: '5mb' }));
app.use(cors({ origin: (process.env.CORS_ORIGIN || '*').split(',').map(s => s.trim()), credentials: false }));
app.use(morgan('dev'));

// Webhook sin auth del frontend
app.use('/api', makeWebhookRouter(io));

// API con auth simple
app.use('/api', routes);

// WebSocket
io.on('connection', socket => {
  // El front puede unirse a una sala por instancia
  socket.on('join', ({ instance }) => {
    if (instance) socket.join(String(instance));
  });
});

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
  console.log(`[Backend] Listening on port ${PORT}`);
});
