// src/bot/audit.js
import { pool } from './config.js';

await pool.query(`
  CREATE TABLE IF NOT EXISTS bot_audit (
    id            bigserial primary key,
    instance_id   text not null,
    mode          text not null,
    action_id     text,
    params_json   jsonb,
    result_json   jsonb,
    external_db   text,
    operation_key text,
    created_at    timestamptz default now()
  )
`);

export async function saveAudit({ instance, mode, actionId, params, result, externalDb, operationKey }) {
  await pool.query(`
    INSERT INTO bot_audit (instance_id, mode, action_id, params_json, result_json, external_db, operation_key)
    VALUES ($1,$2,$3,$4,$5,$6,$7)
  `, [instance, mode, actionId, params, result, externalDb, operationKey || null]);
}
