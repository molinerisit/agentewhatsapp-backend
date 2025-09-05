# Evolution Bot Backend (Express + Socket.IO)

Servidor que expone endpoints simples y un puente de WebSocket/Socket.IO para
integrarse con Evolution API. Diseñado para funcionar con el frontend Vite incluido.

## Variables de entorno

Copia `.env.example` a `.env` y completa:

- `EVOLUTION_API_BASE`: URL base de Evolution API.
- `EVOLUTION_API_KEY`: Bearer token.
- `PORT`: Puerto del backend (default 4000).
- `FRONTEND_ORIGIN`: Origen permitido por CORS (default `http://localhost:5173`).
- `WEBHOOK_SECRET`: Clave simple para validar el webhook (opcional).

## Scripts

```bash
npm install
npm run dev
# o
npm start
```

## Webhook

Configura en Evolution API tu webhook apuntando a:
`POST http://<tu-backend>/webhook/evolution?secret=<WEBHOOK_SECRET>`

Este backend retransmite los eventos entrantes por Socket.IO a los clientes conectados.
