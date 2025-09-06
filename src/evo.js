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

// ——— CHATS ———
export async function listChats(instance) {
  const { data } = await evo.post(`/chat/findChats/${encodeURIComponent(instance)}`);
  return Array.isArray(data) ? data : (data?.chats || data?.data || []);
}

// ——— MESSAGES (compat) ———
// Intenta varias firmas / endpoints hasta traer algo
export async function fetchMessagesCompat(instance, remoteJid, limit = 50) {
  const inst = encodeURIComponent(instance);
  const lim  = Number(limit) || 50;

  const attempts = [
    // v2 (clásico en docs): where.key.remoteJid
    {
      kind: 'chat/findMessages key.remoteJid',
      fn: () => evo.post(`/chat/findMessages/${inst}`, {
        where: { key: { remoteJid } },
        limit: lim
      })
    },
    // algunas builds: where.remoteJid (sin key)
    {
      kind: 'chat/findMessages remoteJid',
      fn: () => evo.post(`/chat/findMessages/${inst}`, {
        where: { remoteJid },
        limit: lim
      })
    },
    // otras: { jid }
    {
      kind: 'chat/findMessages jid',
      fn: () => evo.post(`/chat/findMessages/${inst}`, {
        where: { jid: remoteJid },
        limit: lim
      })
    },
    // endpoint alternativo: /chat/messages
    {
      kind: 'chat/messages {remoteJid}',
      fn: () => evo.post(`/chat/messages/${inst}`, {
        remoteJid,
        limit: lim
      })
    },
    // algunos exponen /message/find
    {
      kind: 'message/find key.remoteJid',
      fn: () => evo.post(`/message/find/${inst}`, {
        where: { key: { remoteJid } },
        limit: lim
      })
    },
    // variante /message/find with remoteJid directo
    {
      kind: 'message/find remoteJid',
      fn: () => evo.post(`/message/find/${inst}`, {
        where: { remoteJid },
        limit: lim
      })
    },
  ];

  for (const att of attempts) {
    try {
      const { data } = await att.fn();
      const arr = Array.isArray(data) ? data : (data?.messages || data?.data || []);
      if (Array.isArray(arr) && arr.length) {
        return arr;
      }
      // si viene array vacío, seguimos probando
    } catch (e) {
      // ignoramos 404/400 y seguimos probando siguientes firmas
      if (process.env.DEBUG_COMPAT === 'true') {
        console.warn(`[fetchMessagesCompat] ${att.kind} fallo`, e?.response?.status || e.message);
      }
    }
  }
  // si ninguna funcionó, devolvemos array vacío
  return [];
}

// ——— SEND TEXT ———
export async function sendText(instance, number, text, quoted) {
  const payload = { number, text };
  if (quoted) payload.quoted = quoted;
  const { data } = await evo.post(`/message/sendText/${encodeURIComponent(instance)}`, payload);
  return data;
}
