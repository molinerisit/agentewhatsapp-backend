// src/evo.js
import axios from 'axios';

const baseURL = process.env.EVOLUTION_API_URL;
const apiKey  = process.env.EVOLUTION_API_KEY;

if (!baseURL || !apiKey) {
  console.error('[CONFIG ERROR] Set EVOLUTION_API_URL & EVOLUTION_API_KEY in .env');
}

export const evo = axios.create({
  baseURL,
  timeout: 20000,
  headers: {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    'apikey': apiKey
  }
});

/* ===================== Interceptores con logs ===================== */
evo.interceptors.request.use(req => {
  const u = `${req.baseURL || ''}${req.url}`;
  console.log(`[EVO ->] ${req.method?.toUpperCase()} ${u}`);
  if (req.data) {
    const bodyStr = typeof req.data === 'string' ? req.data : JSON.stringify(req.data);
    console.log(`[EVO ->] body[${bodyStr.length}]: ${bodyStr.slice(0, 500)}${bodyStr.length > 500 ? '…' : ''}`);
  }
  return req;
});

evo.interceptors.response.use(
  res => {
    const size = (() => {
      try { return JSON.stringify(res.data).length; } catch { return 0; }
    })();
    console.log(`[EVO <-] ${res.status} ${res.config.url} (${size} bytes)`);
    return res;
  },
  err => {
    const status = err?.response?.status;
    const data   = err?.response?.data;
    console.error('[EVO ERR]', status, data);
    return Promise.reject(err);
  }
);

/* ===================== Helpers ===================== */
function asArrayMessages(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.messages)) return payload.messages;
  if (Array.isArray(payload?.data)) return payload.data;
  // a veces viene { rows: [...] } o { result: [...] }
  if (Array.isArray(payload?.rows)) return payload.rows;
  if (Array.isArray(payload?.result)) return payload.result;
  return [];
}

function asArrayChats(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.chats)) return payload.chats;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.rows)) return payload.rows;
  if (Array.isArray(payload?.result)) return payload.result;
  return [];
}

/* ===================== CHATS ===================== */
export async function listChats(instance) {
  const { data } = await evo.post(`/chat/findChats/${encodeURIComponent(instance)}`);
  const arr = asArrayChats(data);
  console.log(`[listChats] instance=${instance} -> ${arr.length} chats`);
  return arr;
}

/* ===================== MESSAGES (compat agresivo) ===================== */
export async function fetchMessagesCompat(instance, remoteJid, limit = 50) {
  const inst = encodeURIComponent(instance);
  const lim  = Number(limit) || 50;

  // intentos en orden; dejamos muchos, porque forks de Evolution cambian nombres:
  const attempts = [
    // 1) v2 más común: where.key.remoteJid + orderBy/take
    {
      kind: 'chat/findMessages key.remoteJid + orderBy/take',
      method: 'POST',
      url: `/chat/findMessages/${inst}`,
      body: { where: { key: { remoteJid } }, orderBy: { messageTimestamp: 'desc' }, take: lim }
    },
    // 2) igual que (1) pero sin orderBy (algunos no lo soportan)
    {
      kind: 'chat/findMessages key.remoteJid + limit',
      method: 'POST',
      url: `/chat/findMessages/${inst}`,
      body: { where: { key: { remoteJid } }, limit: lim }
    },
    // 3) where.remoteJid directo
    {
      kind: 'chat/findMessages remoteJid + limit',
      method: 'POST',
      url: `/chat/findMessages/${inst}`,
      body: { where: { remoteJid }, limit: lim }
    },
    // 4) where.jid
    {
      kind: 'chat/findMessages jid + limit',
      method: 'POST',
      url: `/chat/findMessages/${inst}`,
      body: { where: { jid: remoteJid }, limit: lim }
    },
    // 5) endpoint alterno (algunos builds): chat/messages
    {
      kind: 'chat/messages body(remoteJid,limit)',
      method: 'POST',
      url: `/chat/messages/${inst}`,
      body: { remoteJid, limit: lim }
    },
    // 6) message/find con key.remoteJid
    {
      kind: 'message/find key.remoteJid',
      method: 'POST',
      url: `/message/find/${inst}`,
      body: { where: { key: { remoteJid } }, limit: lim }
    },
    // 7) message/find con remoteJid directo
    {
      kind: 'message/find remoteJid',
      method: 'POST',
      url: `/message/find/${inst}`,
      body: { where: { remoteJid }, limit: lim }
    },
    // 8) message/list (GET) con query
    {
      kind: 'message/list GET',
      method: 'GET',
      url: `/message/list/${inst}?remoteJid=${encodeURIComponent(remoteJid)}&limit=${lim}`
    },
    // 9) chat/messages (GET) con query
    {
      kind: 'chat/messages GET',
      method: 'GET',
      url: `/chat/messages/${inst}?remoteJid=${encodeURIComponent(remoteJid)}&limit=${lim}`
    }
  ];

  for (const att of attempts) {
    try {
      console.log(`[fetchMessagesCompat] trying ${att.kind} -> ${att.method} ${att.url}`);
      const res = att.method === 'GET'
        ? await evo.get(att.url)
        : await evo.post(att.url, att.body ?? {});
      const arr = asArrayMessages(res.data);
      console.log(`[fetchMessagesCompat] ${att.kind} -> ok count=${arr.length}`);
      if (arr.length) return arr;
      // si vuelve vacío pero hay estructura, seguimos probando otros
    } catch (e) {
      const st = e?.response?.status || 'ERR';
      const pl = e?.response?.data;
      console.warn(`[fetchMessagesCompat] FAIL ${att.kind} status=${st} data=${typeof pl === 'object' ? JSON.stringify(pl).slice(0,300) : pl}`);
    }
  }

  console.warn(`[fetchMessagesCompat] NO MATCH (0 msgs) instance=${instance} jid=${remoteJid}`);
  return [];
}

/* ===================== SEND TEXT ===================== */
export async function sendText(instance, number, text, quoted) {
  const payload = { number, text };
  if (quoted) payload.quoted = quoted;
  const { data } = await evo.post(`/message/sendText/${encodeURIComponent(instance)}`, payload);
  console.log(`[sendText] instance=${instance} to=${number} ok`);
  return data;
}

export default {
  evo,
  listChats,
  fetchMessagesCompat,
  sendText
};
