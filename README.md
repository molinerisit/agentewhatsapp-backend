# Backend – WhatsApp Evolution Proxy + WebSocket

1) Copia `.env.example` a `.env` y completa tus variables.
2) En Railway, crea un servicio Node (o usa este Dockerfile).
3) En Evolution API, pone el `WEBHOOK_URL` apuntando a tu backend:
   `https://TU-BACKEND.railway.app/api/wa/webhook?token=evolution&instance={{instance}}`
4) Asegurate que `WEBHOOK_TOKEN` == `token=` del `WEBHOOK_URL`.
5) Define `CORS_ORIGIN` con tu dominio de Vercel y localhost si querés.
