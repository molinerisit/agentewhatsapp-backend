import axios from 'axios';

const baseURL = process.env.EVOLUTION_API_URL;
const apiKey  = process.env.EVOLUTION_API_KEY;

if (!baseURL || !apiKey) {
  console.error('[CONFIG ERROR] Set EVOLUTION_API_URL & EVOLUTION_API_KEY in .env');
}

export const evo = axios.create({
  baseURL,
  timeout: 15000,
  headers: {
    'Content-Type': 'application/json',
    'apikey': apiKey
  }
});

export async function listChats(instance) {
  const { data } = await evo.post(`/chat/findChats/${encodeURIComponent(instance)}`);
  // Different builds return {chats} or direct array
  return Array.isArray(data) ? data : (data?.chats || data?.data || []);
}

export async function listMessages(instance, { remoteJid, limit = 50 } = {}) {
  const where = remoteJid ? { key: { remoteJid } } : undefined;
  const { data } = await evo.post(`/chat/findMessages/${encodeURIComponent(instance)}`, { where, limit });
  return Array.isArray(data) ? data : (data?.messages || data?.data || []);
}

export async function sendText(instance, number, text, quoted) {
  const payload = { number, text };
  if (quoted) payload.quoted = quoted;
  const { data } = await evo.post(`/message/sendText/${encodeURIComponent(instance)}`, payload);
  return data;
}
