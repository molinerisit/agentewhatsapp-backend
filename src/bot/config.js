// src/bot/config.js
import pg from 'pg';
const { Pool } = pg;

/* ========== Conn a Postgres (con logs y ssl) ========== */
function getDbUrl() {
  let url = (process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL || '').trim();

  const masked = url
    ? url.replace(/\/\/([^:]+):([^@]+)@/, (_m, u) => `//${u}:***@`)
    : '(vacía)';
  console.log('[DB] DATABASE_URL=', masked);

  if (!url) {
    throw new Error('DATABASE_URL no configurado. Debe ser postgresql://USER:PASS@HOST:PORT/DB?sslmode=require');
  }
  if (!/^postgres(ql)?:\/\//i.test(url)) {
    throw new Error(`DATABASE_URL inválido (falta protocolo postgres:// o postgresql://): ${masked}`);
  }
  if (!/[?&]sslmode=/i.test(url) && !/[?&]ssl=/.test(url)) {
    url += (url.includes('?') ? '&' : '?') + 'sslmode=require';
  }
  return url;
}

const connectionString = getDbUrl();

export const pool = new Pool({
  connectionString,
  ssl: { rejectUnauthorized: false },
});

// Ping de diagnóstico
try {
  const r = await pool.query('select 1 as ok');
  console.log('[DB] ping ok:', r.rows[0]);
} catch (e) {
  console.error('[DB] ping error:', e?.message || e);
  throw e;
}

/* ========== Config del BOT (tabla y helpers) ========== */
// Tabla para guardar config por instancia
await pool.query(`
  CREATE TABLE IF NOT EXISTS bot_config (
    instance_id      text PRIMARY KEY,
    mode             text NOT NULL DEFAULT 'ventas',         -- 'ventas' | 'reservas'
    external_db_url  text,                                    -- URL completa a Postgres externo
    rag_enabled      boolean NOT NULL DEFAULT true,
    write_enabled    boolean NOT NULL DEFAULT false,          -- permitir escribir en DB externa
    confirm_required boolean NOT NULL DEFAULT true,           -- pedir "CONFIRMAR XXXX" antes de ejecutar
    updated_at       timestamptz NOT NULL DEFAULT now()
  )
`);

// Valores por defecto si no hay fila
const DEFAULTS = {
  mode: 'ventas',
  external_db_url: null,
  rag_enabled: true,
  write_enabled: false,
  confirm_required: true,
};

export async function getBotConfig(instanceId) {
  if (!instanceId) throw new Error('getBotConfig: instanceId requerido');
  const { rows } = await pool.query(
    `SELECT instance_id, mode, external_db_url, rag_enabled, write_enabled, confirm_required
     FROM bot_config WHERE instance_id = $1`,
    [instanceId]
  );
  if (!rows.length) {
    return { instance_id: instanceId, ...DEFAULTS };
  }
  const r = rows[0];
  return {
    instance_id: r.instance_id,
    mode: r.mode || DEFAULTS.mode,
    external_db_url: r.external_db_url || DEFAULTS.external_db_url,
    rag_enabled: r.rag_enabled ?? DEFAULTS.rag_enabled,
    write_enabled: r.write_enabled ?? DEFAULTS.write_enabled,
    confirm_required: r.confirm_required ?? DEFAULTS.confirm_required,
  };
}

export async function upsertBotConfig({
  instanceId,
  mode,
  externalDbUrl,
  ragEnabled = true,
  writeEnabled = false,
  confirmRequired = true,
}) {
  if (!instanceId) throw new Error('upsertBotConfig: instanceId requerido');
  const { rows } = await pool.query(
    `INSERT INTO bot_config (instance_id, mode, external_db_url, rag_enabled, write_enabled, confirm_required, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,now())
     ON CONFLICT (instance_id)
     DO UPDATE SET
       mode=$2,
       external_db_url=$3,
       rag_enabled=$4,
       write_enabled=$5,
       confirm_required=$6,
       updated_at=now()
     RETURNING instance_id, mode, external_db_url, rag_enabled, write_enabled, confirm_required`,
    [instanceId, mode, externalDbUrl, ragEnabled, writeEnabled, confirmRequired]
  );
  const r = rows[0];
  return {
    instance_id: r.instance_id,
    mode: r.mode,
    external_db_url: r.external_db_url,
    rag_enabled: r.rag_enabled,
    write_enabled: r.write_enabled,
    confirm_required: r.confirm_required,
  };
}
