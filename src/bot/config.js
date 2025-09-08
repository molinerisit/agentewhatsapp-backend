// src/bot/config.js
import pg from 'pg';
const { Pool } = pg;

/** En Railway:
 *  - Poné en el servicio del backend:
 *      DATABASE_URL = ${{Base-Sistema.DATABASE_URL}}
 *  - NO declares DATABASE_PUBLIC_URL.
 */

function maskUrl(u = '') {
  try {
    return u.replace(/\/\/([^:]+):([^@]+)@/, (_m, user) => `//${user}:***@`);
  } catch { return u; }
}

function getDbUrl() {
  let url = (process.env.DATABASE_URL || '').trim();
  console.log('[DB] DATABASE_URL=', url ? maskUrl(url) : '(vacía)');
  if (!url) {
    throw new Error('DATABASE_URL no configurado.');
  }
  // ✅ Remover cualquier sslmode de la query (lo forzamos por código)
  url = url.replace(/([?&])sslmode=[^&]*/ig, '$1').replace(/[?&]$/,'');
  return url;
}

const connectionString = getDbUrl();

// ✅ Fuerza SSL sin validar CA (evita "self-signed certificate")
export const pool = new Pool({
  connectionString,
  ssl: { require: true, rejectUnauthorized: false },
});

// Ping de diagnóstico
try {
  const r = await pool.query('select 1 as ok');
  console.log('[DB] ping ok:', r.rows[0]);
} catch (e) {
  console.error('[DB] ping error:', e?.message || e);
  throw e;
}

/* ---------------- Bot Config table + helpers ---------------- */
await pool.query(`
  CREATE TABLE IF NOT EXISTS bot_config (
    instance_id      text PRIMARY KEY,
    mode             text NOT NULL DEFAULT 'ventas',      -- 'ventas' | 'reservas'
    external_db_url  text,                                -- URL a otra Postgres (opcional)
    rag_enabled      boolean NOT NULL DEFAULT true,
    write_enabled    boolean NOT NULL DEFAULT false,
    confirm_required boolean NOT NULL DEFAULT true,
    updated_at       timestamptz NOT NULL DEFAULT now()
  )
`);

export async function getBotConfig(instanceId) {
  const { rows } = await pool.query(
    'SELECT * FROM bot_config WHERE instance_id=$1',
    [instanceId]
  );
  return rows[0] || null;
}

export async function upsertBotConfig({
  instanceId,
  mode = 'ventas',
  externalDbUrl = null,
  ragEnabled = true,
  writeEnabled = false,
  confirmRequired = true,
}) {
  const { rows } = await pool.query(
    `INSERT INTO bot_config (instance_id, mode, external_db_url, rag_enabled, write_enabled, confirm_required, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6, now())
     ON CONFLICT (instance_id)
     DO UPDATE SET
       mode=$2,
       external_db_url=$3,
       rag_enabled=$4,
       write_enabled=$5,
       confirm_required=$6,
       updated_at=now()
     RETURNING *`,
    [instanceId, mode, externalDbUrl, ragEnabled, writeEnabled, confirmRequired]
  );
  return rows[0];
}
