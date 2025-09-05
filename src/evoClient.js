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
  timeout: 15000
});

// === Instancias ===
export async function fetchInstances({ instanceName } = {}) {
  if (instanceName) {
    const { data } = await evo.get(`/instance/${encodeURIComponent(instanceName)}`);
    return [data];
  }
  const { data } = await evo.get('/instance/all');
  return data;
}

// === Estado de conexión ===
export async function connectionState(instanceName) {
  const { data } = await evo.get(`/instance/connectionState`, {
    params: { instanceName }
  });
  return data;
}

// === Conectar (QR/pairing) ===
export async function connect(instanceName) {
  const { data } = await evo.get(`/instance/connect/${encodeURIComponent(instanceName)}`);
  return data;
}

// === Mensajes ===
export async function sendText(instanceName, { number, text, quoted }) {
  const payload = { instanceName, number, text };
  if (quoted) payload.quoted = quoted;
  const { data } = await evo.post(`/message/sendText`, payload);
  return data;
}

export async function findChats(instanceName) {
  const { data } = await evo.post(`/chat/findChats`, { instanceName });
  return data;
}

export async function findMessages(instanceName, { remoteJid, limit = 50 } = {}) {
  const where = remoteJid ? { key: { remoteJid } } : undefined;
  const { data } = await evo.post(`/chat/findMessages`, { instanceName, where, limit });
  return data;
}

export async function markAsRead(instanceName, readMessages) {
  const { data } = await evo.post(`/chat/markMessageAsRead`, {
    instanceName,
    readMessages
  });
  return data;
}
