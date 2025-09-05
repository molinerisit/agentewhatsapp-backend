// backend/src/evoClient.js
import axios from 'axios';

const baseURL = process.env.EVOLUTION_API_URL;
const apiKey = process.env.EVOLUTION_API_KEY;

if (!baseURL || !apiKey) {
  console.error('\n[CONFIG ERROR] EVOLUTION_API_URL y/o EVOLUTION_API_KEY no configurados.');
}

export const evo = axios.create({
  baseURL,
  headers: {
    'Content-Type': 'application/json',
    'apikey': apiKey
  },
  // Aumentamos timeout: Evolution a veces demora en responder (histórico, etc.)
  timeout: 45000
});

// Helper de normalización a array (por si Evolution cambia el shape)
function toArray(x) {
  if (Array.isArray(x)) return x;
  if (Array.isArray(x?.chats)) return x.chats;
  if (Array.isArray(x?.data)) return x.data;
  if (Array.isArray(x?.items)) return x.items;
  return [];
}

export async function fetchInstances({ instanceName, instanceId } = {}) {
  const res = await evo.get('/instance/fetchInstances', {
    params: {
      instanceName: instanceName || undefined,
      instanceId: instanceId || undefined
    }
  });
  return res.data;
}

export async function connectionState(instance) {
  const { data } = await evo.get(`/instance/connectionState/${encodeURIComponent(instance)}`);
  return data;
}

export async function connect(instance) {
  // Devuelve pairingCode + code (QR) + count (según setup Evolution)
  const { data } = await evo.get(`/instance/connect/${encodeURIComponent(instance)}`);
  return data;
}

export async function sendText(instance, { number, text, quoted }) {
  const payload = { number, text };
  if (quoted) payload.quoted = quoted;
  const { data } = await evo.post(`/message/sendText/${encodeURIComponent(instance)}`, payload);
  return data;
}

export async function findChats(instance) {
  // Algunas versiones 2.1.x esperan GET; si falla o viene vacío, probamos POST.
  try {
    const { data } = await evo.get(`/chat/findChats/${encodeURIComponent(instance)}`);
    return toArray(data);
  } catch (err) {
    try {
      const { data } = await evo.post(`/chat/findChats/${encodeURIComponent(instance)}`, {});
      return toArray(data);
    } catch (err2) {
      return [];
    }
  }
}

export async function findMessages(instance, { remoteJid, limit = 50 } = {}) {
  const where = remoteJid ? { key: { remoteJid } } : undefined;
  const { data } = await evo.post(`/chat/findMessages/${encodeURIComponent(instance)}`, { where, limit });
  return data;
}

export async function markAsRead(instance, readMessages) {
  // v2 usa POST y propiedad readMessages
  const { data } = await evo.post(`/chat/markMessageAsRead/${encodeURIComponent(instance)}`, {
    readMessages
  });
  return data;
}
