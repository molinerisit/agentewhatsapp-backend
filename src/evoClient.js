import axios from 'axios';

const baseURL = process.env.EVOLUTION_API_URL;
const apiKey  = process.env.EVOLUTION_API_KEY;

if (!baseURL || !apiKey) {
  console.error('[CONFIG ERROR] Falta EVOLUTION_API_URL o EVOLUTION_API_KEY');
}

export const evo = axios.create({
  baseURL,
  headers: { 'Content-Type': 'application/json', apikey: apiKey },
  timeout: 20000
});

// util de compat: intenta GET en orden y devuelve el primero que no sea 404
async function tryGet(paths, config) {
  let lastErr;
  for (const p of paths) {
    try {
      const { data } = await evo.get(p, config);
      return data;
    } catch (e) {
      if (e?.response?.status !== 404) throw e;
      lastErr = e;
    }
  }
  throw lastErr || new Error('All GET variants 404');
}

// util de compat: intenta POST en orden y devuelve el primero que no sea 404
async function tryPost(paths, body) {
  let lastErr;
  for (const p of paths) {
    try {
      const { data } = await evo.post(p, body);
      return data;
    } catch (e) {
      if (e?.response?.status !== 404) throw e;
      lastErr = e;
    }
  }
  throw lastErr || new Error('All POST variants 404');
}

/** ===================== Instancias ===================== **/

// Lista de instancias
export async function fetchInstances({ instanceName } = {}) {
  if (instanceName) {
    // detalle de una instancia (v2.1 y v2.3 suelen soportar esto)
    return [await tryGet([`/instance/${encodeURIComponent(instanceName)}`])];
  }
  // variantes conocidas por versión
  return await tryGet([
    '/instance/all',          // v2.1.x en algunos builds
    '/instance/list',         // otras builds
    '/instances',             // alternativa en forks
    '/instance'               // algunas dev builds devuelven listado
  ]);
}

/** ===================== Estado / Conexión ===================== **/

export async function connectionState(instanceName) {
  // v2.1.x suele requerir query param; v2.3.x usa path
  try {
    // v2.1.x style
    return await tryGet(['/instance/connectionState'], { params: { instanceName } });
  } catch {
    // v2.3.x style
    return await tryGet([`/instance/connectionState/${encodeURIComponent(instanceName)}`]);
  }
}

export async function connect(instanceName) {
  // la mayoría usa path
  return await tryGet([
    `/instance/connect/${encodeURIComponent(instanceName)}`, // v2.1/2.3
  ]);
}

/** ===================== Mensajería / Chats ===================== **/

export async function sendText(instanceName, { number, text, quoted }) {
  // v2.1.x: POST /message/sendText  body: { instanceName, number, text, quoted? }
  // v2.3.x: POST /message/sendText/:instance  body: { number, text, quoted? }
  const bodyV21 = { instanceName, number, text };
  if (quoted) bodyV21.quoted = quoted;

  try {
    return await tryPost(['/message/sendText'], bodyV21);
  } catch {
    const bodyV23 = { number, text };
    if (quoted) bodyV23.quoted = quoted;
    return await tryPost([`/message/sendText/${encodeURIComponent(instanceName)}`], bodyV23);
  }
}

export async function findChats(instanceName) {
  // v2.1.x: POST /chat/findChats   body: { instanceName }
  // v2.3.x: POST /chat/findChats/:instance
  try {
    return await tryPost(['/chat/findChats'], { instanceName });
  } catch {
    return await tryPost([`/chat/findChats/${encodeURIComponent(instanceName)}`], {});
  }
}

export async function findMessages(instanceName, { remoteJid, limit = 50 } = {}) {
  const where = remoteJid ? { key: { remoteJid } } : undefined;

  // v2.1.x body incluye instanceName
  try {
    return await tryPost(['/chat/findMessages'], { instanceName, where, limit });
  } catch {
    // v2.3.x path + body sin instanceName
    return await tryPost([`/chat/findMessages/${encodeURIComponent(instanceName)}`], { where, limit });
  }
}

export async function markAsRead(instanceName, readMessages) {
  // v2.1.x
  try {
    return await tryPost(['/chat/markMessageAsRead'], { instanceName, readMessages });
  } catch {
    // v2.3.x
    return await tryPost([`/chat/markMessageAsRead/${encodeURIComponent(instanceName)}`], { readMessages });
  }
}
