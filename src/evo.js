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
// ——— MESSAGES (compat ++): prueba varias firmas y endpoints
export async function fetchMessagesCompat(instance, remoteJid, limit = 50) {
  const inst = encodeURIComponent(instance);
  const lim  = Number(limit) || 50;

  const attempts = [
    // v2 docs: where.key.remoteJid + orderBy/desc + take
    {
      kind: 'chat/findMessages key.remoteJid + orderBy/take',
      body: { where: { key: { remoteJid } }, orderBy: { messageTimestamp: 'desc' }, take: lim },
      path: `/chat/findMessages/${inst}`
    },
    // igual pero sin orderBy (algunos no lo soportan)
    {
      kind: 'chat/findMessages key.remoteJid',
      body: { where: { key: { remoteJid } }, limit: lim },
      path: `/chat/findMessages/${inst}`
    },
    // where.remoteJid directo
    {
      kind: 'chat/findMessages remoteJid',
      body: { where: { remoteJid }, limit: lim },
      path: `/chat/findMessages/${inst}`
    },
    // where.jid
    {
      kind: 'chat/findMessages jid',
      body: { where: { jid: remoteJid }, limit: lim },
      path: `/chat/findMessages/${inst}`
    },
    // endpoint alterno: chat/messages {remoteJid}
    {
      kind: 'chat/messages {remoteJid}',
      body: { remoteJid, limit: lim },
      path: `/chat/messages/${inst}`
    },
    // a veces hay path param para el jid
    {
      kind: 'chat/messages/:jid',
      pathParam: encodeURIComponent(remoteJid),
      path: `/chat/messages/${inst}/:jid`
    },
    // message/find con key.remoteJid
    {
      kind: 'message/find key.remoteJid',
      body: { where: { key: { remoteJid } }, limit: lim },
      path: `/message/find/${inst}`
    },
    // message/find con remoteJid directo
    {
      kind: 'message/find remoteJid',
      body: { where: { remoteJid }, limit: lim },
      path: `/message/find/${inst}`
    },
  ];

  for (const att of attempts) {
    try {
      let url = att.path;
      if (att.pathParam) url = url.replace('/:jid', `/${att.pathParam}`);
      const { data } = att.body
        ? await evo.post(url, att.body)
        : await evo.post(url); // por si algún endpoint no lleva body

      const arr = Array.isArray(data) ? data : (data?.messages || data?.data || []);
      if (Array.isArray(arr) && arr.length) {
        if (process.env.DEBUG_COMPAT === 'true') {
          console.log('[fetchMessagesCompat] OK via', att.kind, 'count=', arr.length);
        }
        return arr;
      }
      if (process.env.DEBUG_COMPAT === 'true') {
        console.log('[fetchMessagesCompat] vacío via', att.kind);
      }
    } catch (e) {
      if (process.env.DEBUG_COMPAT === 'true') {
        console.warn('[fetchMessagesCompat] fallo', att.kind, e?.response?.status || e.message);
      }
    }
  }
  return [];
}

// ——— SEND TEXT ———
export async function sendText(instance, number, text, quoted) {
  const payload = { number, text };
  if (quoted) payload.quoted = quoted;
  const { data } = await evo.post(`/message/sendText/${encodeURIComponent(instance)}`, payload);
  return data;
}
