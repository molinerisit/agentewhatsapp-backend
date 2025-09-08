// src/bot/engine.js
import { getBotConfig } from './config.js';
import { ragSearch } from './rag.js';
import { queryExternalDb } from './sqlgen.js';
import { planAction } from './planner.js';
import { findAction } from './actions.js';
import { execTemplateOnExternalDb, hashOperation } from './executor.js';
import { saveAudit } from './audit.js';
import { sendText } from '../evo.js';

/* ===================== Utils ===================== */

// Extracción de texto robusta (evita “mensaje sin texto”)
function extractText(msg) {
  if (!msg) return '';
  const unwrap = (x) => (x?.message ? unwrap(x.message) : x);
  const m = unwrap(msg.message || msg);

  const t =
    m?.conversation ||
    m?.extendedTextMessage?.text ||
    m?.imageMessage?.caption ||
    m?.videoMessage?.caption ||
    m?.documentMessage?.caption ||
    m?.audioMessage?.caption ||
    m?.stickerMessage?.caption ||
    m?.buttonsResponseMessage?.selectedDisplayText ||
    m?.listResponseMessage?.title ||
    m?.contactMessage?.displayName || '';

  if (t) return String(t).trim();

  if (m?.protocolMessage?.type === 0) return '[mensaje eliminado]';
  if (m?.viewOnceMessage)            return '[vista única]';
  if (m?.imageMessage)               return '[imagen]';
  if (m?.videoMessage)               return '[video]';
  if (m?.documentMessage)            return '[documento]';
  if (m?.audioMessage)               return '[audio]';
  if (m?.stickerMessage)             return '[sticker]';
  return '';
}

function isGreeting(t)      { return /(^|\s)(hola|buenas|hello|hi)(!|,|\.|\s|$)/i.test(t); }
function isReservaIntent(t) { return /(turno|cita|agenda|reserv|disponibilidad)/i.test(t); }
function isVentaIntent(t)   { return /(precio|stock|comprar|producto|cat[aá]logo)/i.test(t); }

// Confirmación tipo: "CONFIRMAR ab12cd34"
function parseConfirm(text) {
  const m = text.trim().match(/^confirmar\s+([a-f0-9]{8})$/i);
  return m ? m[1].toLowerCase() : null;
}

// Mem-cache de operaciones pendientes: key corto -> payload
const pendingOps = new Map();

/* ===================== Respuestas por modo (lectura) ===================== */

async function replyReservasRead({ instance, text, externalDbUrl }) {
  // 1) SQL natural language -> SELECT (solo lectura)
  if (externalDbUrl) {
    const { sql, rows, error } = await queryExternalDb(externalDbUrl, text);
    if (!error && rows && rows.length) {
      const sample = JSON.stringify(rows.slice(0, 5), null, 2);
      return `📅 Esto encontré en la agenda:\n${sample}\n\n(SQL: ${sql})`;
    }
  }
  // 2) RAG como respaldo
  const hits = await ragSearch(instance, `Reservas: ${text}`, 5);
  const ctx = hits.map(h => `• ${h.text}`).join('\n').slice(0, 1500);
  if (isGreeting(text)) {
    return `¡Hola! Soy tu asistente de reservas. Decime día y hora preferidos y tu nombre.${ctx ? '\n\nNotas:\n' + ctx : ''}`;
  }
  if (isReservaIntent(text)) {
    return `Para agendar necesito: nombre, fecha y franja horaria.${ctx ? '\n\nReglas:\n' + ctx : ''}`;
  }
  return `Te ayudo a tomar turnos.${ctx ? '\n\nReglas:\n' + ctx : ''}`;
}

async function replyVentasRead({ instance, text, externalDbUrl }) {
  if (externalDbUrl) {
    const { sql, rows, error } = await queryExternalDb(externalDbUrl, text);
    if (!error && rows && rows.length) {
      const sample = JSON.stringify(rows.slice(0, 5), null, 2);
      return `🛍️ Esto encontré:\n${sample}\n\n(SQL: ${sql})`;
    }
  }
  const hits = await ragSearch(instance, `Ventas: ${text}`, 5);
  const ctx = hits.map(h => `• ${h.text}`).join('\n').slice(0, 1500);
  if (isGreeting(text)) return `¡Hola! Soy tu asistente de ventas. ¿Qué producto te interesa?${ctx ? '\n\nNotas:\n' + ctx : ''}`;
  if (isVentaIntent(text)) return `Según las reglas:\n${ctx || 'No hay reglas cargadas.'}`;
  return `Puedo ayudarte con productos, precios y stock.${ctx ? '\n\nNotas:\n' + ctx : ''}`;
}

/* ===================== Flujo Write-Safe ===================== */
/**
 * 1) Planificar acción (elige plantilla + params)
 * 2) Si confirm_required=true -> pedir confirmación (CONFIRMAR xxxx)
 * 3) Si confirman (o confirm_required=false) -> ejecutar transaccional
 * 4) Auditar
 */

async function tryPlanAndMaybeExecute({ instance, jid, mode, dbUrl, userText, confirmRequired }) {
  // (Opcional) schemaSynopsis podría pasar un resumen de tablas/columnas para ayudar al planner.
  const schemaSynopsis = ''; // simplificado para performance

  const plan = await planAction({ mode, userText, schemaSynopsis });

  // No hay acción adecuada -> volver a lectura
  if (!plan || plan.action === 'none') return null;

  const template = findAction(mode, plan.action);
  if (!template) return null;

  const paramsObj = plan.params || {};
  const opKeyFull = hashOperation(instance, template.id, paramsObj);
  const opKeyShort = opKeyFull.slice(0, 8);
  const resumen = plan.summary || template.description;

  if (confirmRequired) {
    // Guardar como pendiente y pedir confirmación
    pendingOps.set(opKeyShort, { instance, jid, mode, template, params: paramsObj, dbUrl });
    await sendText(instance, jid,
      `⚠️ Voy a ejecutar *${template.description}* con:\n` +
      '```\n' + JSON.stringify(paramsObj, null, 2) + '\n```\n' +
      (resumen ? `Resumen: ${resumen}\n` : '') +
      `Si estás de acuerdo respondé:\n*CONFIRMAR ${opKeyShort}*`
    );
    return { askedConfirmation: true };
  }

  // Ejecutar directo (sin confirmación)
  const result = await execTemplateOnExternalDb(dbUrl, template, paramsObj, { instance, operationKey: opKeyShort });
  await saveAudit({
    instance,
    mode,
    actionId: template.id,
    params: paramsObj,
    result,
    externalDb: dbUrl,
    operationKey: opKeyShort
  });

  const ok = !result.error;
  await sendText(
    instance,
    jid,
    ok
      ? `✅ Hecho.\nResultado: ${JSON.stringify(result.rows?.[0] || result.rows || {}, null, 2)}`
      : `❌ Error al ejecutar: ${result.error}`
  );
  return { executed: ok, error: result.error || null };
}

/* ===================== Handler principal ===================== */

export async function handleIncomingMessage({ instance, message }) {
  if (String(process.env.BOT_ENABLED).toLowerCase() !== 'true') return;

  const text = extractText(message);
  if (!text) return;

  const jid = message?.key?.remoteJid || message?.remoteJid || message?.chatId;
  const fromMe = !!(message?.key?.fromMe);
  if (!jid || fromMe) return; // solo respondemos a mensajes entrantes

  const cfg = await getBotConfig(instance);
  const mode = (cfg?.mode || 'ventas');
  const dbUrl = cfg?.external_db_url || null;
  const writeEnabled = !!cfg?.write_enabled;
  const confirmRequired = cfg?.confirm_required !== false; // true por default

  // 0) ¿Confirman una operación previa?
  const confirmHash = parseConfirm(text);
  if (confirmHash) {
    const op = pendingOps.get(confirmHash);
    if (op && op.instance === instance && op.jid === jid) {
      const result = await execTemplateOnExternalDb(op.dbUrl, op.template, op.params, { instance, operationKey: confirmHash });
      await saveAudit({
        instance,
        mode,
        actionId: op.template.id,
        params: op.params,
        result,
        externalDb: op.dbUrl,
        operationKey: confirmHash
      });
      pendingOps.delete(confirmHash);

      const ok = !result.error;
      await sendText(
        instance,
        jid,
        ok
          ? `✅ Listo. Operación ejecutada.\nResultado: ${JSON.stringify(result.rows?.[0] || result.rows || {}, null, 2)}`
          : `❌ No se pudo ejecutar: ${result.error}`
      );
      return;
    }
    // Si el código no corresponde, sigue el flujo normal
  }

  // 1) Si hay DB externa y write_enabled, intentar planificar acción
  if (dbUrl && writeEnabled) {
    const r = await tryPlanAndMaybeExecute({
      instance, jid, mode, dbUrl, userText: text, confirmRequired
    });
    // Si pedimos confirmación, no respondemos más ahora
    if (r?.askedConfirmation || r?.executed) return;
    // Si r === null, no hubo match de acción → caemos a lectura
  }

  // 2) Lectura por modo (SQL de solo lectura + RAG)
  let out;
  if (mode === 'reservas') {
    out = await replyReservasRead({ instance, text, externalDbUrl: dbUrl });
  } else {
    out = await replyVentasRead({ instance, text, externalDbUrl: dbUrl });
  }

  if (out) await sendText(instance, jid, out);
}
