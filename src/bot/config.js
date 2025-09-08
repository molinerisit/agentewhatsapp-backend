// src/bot/config.js
import pg from 'pg';
const { Pool } = pg;

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

await pool.query(`
  CREATE TABLE IF NOT EXISTS bot_instances (
    instance_id      text PRIMARY KEY,
    mode             text NOT NULL CHECK (mode IN ('reservas','ventas')),
    external_db_url  text,
    rag_enabled      boolean DEFAULT true,
    write_enabled    boolean DEFAULT false,         -- NUEVO: habilita escrituras
    confirm_required boolean DEFAULT true,          -- NUEVO: requiere confirmación
    updated_at       timestamptz DEFAULT now()
  )
`);

export async function getBotConfig(instanceId) {
  const { rows } = await pool.query(
    `SELECT instance_id, mode, external_db_url, rag_enabled, write_enabled, confirm_required, updated_at
     FROM bot_instances WHERE instance_id=$1`, [instanceId]
  );
  if (rows.length) return rows[0];
  return {
    instance_id: instanceId,
    mode: 'ventas',
    external_db_url: null,
    rag_enabled: true,
    write_enabled: false,
    confirm_required: true
  };
}

export async function upsertBotConfig({ instanceId, mode, externalDbUrl, ragEnabled, writeEnabled, confirmRequired }) {
  const { rows } = await pool.query(`
    INSERT INTO bot_instances (instance_id, mode, external_db_url, rag_enabled, write_enabled, confirm_required)
    VALUES ($1,$2,$3,$4,$5,$6)
    ON CONFLICT (instance_id)
    DO UPDATE SET mode=EXCLUDED.mode,
                  external_db_url=EXCLUDED.external_db_url,
                  rag_enabled=EXCLUDED.rag_enabled,
                  write_enabled=EXCLUDED.write_enabled,
                  confirm_required=EXCLUDED.confirm_required,
                  updated_at=now()
    RETURNING instance_id, mode, external_db_url, rag_enabled, write_enabled, confirm_required, updated_at
  `, [instanceId, mode, externalDbUrl, ragEnabled, writeEnabled, confirmRequired]);
  return rows[0];
}
