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
  timeout: 45000 // ⏱ timeout más alto para evitar cortes
});

// helper de normalización a array
function toArray(x) {
  if (Array.isArray(x)) return x;
  if (Array.isArray(x?.instances)) return x.instances;
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
  return toArray(res.data);
}

export async function connectionState(instance) {
  const { data } = await evo.get(`/instance/connectionState/${encodeURIComponent(instance)}`);
  return data;
}

export async function connect(instance) {
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
  try {
    const { data } = await evo.get(`/chat/findChats/${encodeURIComponent(instance)}`);
    return toArray(data);
  } catch {
    try {
      const { data } = await evo.post(`/chat/findChats/${encodeURIComponent(instance)}`, {});
      return toArray(data);
    } catch {
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
  const { data } = await evo.post(`/chat/markMessageAsRead/${encodeURIComponent(instance)}`, {
    readMessages
  });
  return data;
}
