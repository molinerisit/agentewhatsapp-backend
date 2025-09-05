# WhatsApp Minimal (Evolution API)

Mini proyecto para **ver chats**, **leer mensajes** y **enviar texto** usando Evolution API.
La conexión (QR/pairing) la hacés desde el **dashboard de Evolution**. Opcionalmente podés
configurar el **webhook** para recibir mensajes en tiempo real.

## 1) Variables de entorno

Crea `.env` con:
```
EVOLUTION_API_URL=https://TU-EVOLUTION.up.railway.app
EVOLUTION_API_KEY=TU_API_KEY
PORT=8080
WEBHOOK_TOKEN=evolution
```

> O usa `.env.example` como base.

## 2) Instalar y correr
```
npm i
npm run start
# abre http://localhost:8080
```

## 3) Webhook (opcional, recomendado)
En Evolution, seteá:
```
WEBHOOK_URL = https://TU-BACKEND/api/webhook?token=evolution&instance={{instance}}
WEBHOOK_GLOBAL_EVENTS = true
```
Así, los nuevos mensajes llegan al navegador por Socket.IO.
