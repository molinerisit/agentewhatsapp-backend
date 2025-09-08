// src/bot/executor.js
import pg from 'pg';
import crypto from 'node:crypto';

export function hashOperation(instance, actionId, params) {
  return crypto.createHash('sha256')
               .update(JSON.stringify({ instance, actionId, params }), 'utf8')
               .digest('hex')
               .slice(0, 32);
}

export async function execTemplateOnExternalDb(dbUrl, template, paramsObj, { instance, operationKey }) {
  const pool = new pg.Pool({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });

  // mapear params en orden de $1, $2 ...
  const values = [];
  for (const p of template.params) {
    const [name, opt] = p.endsWith('?') ? [p.slice(0,-1), true] : [p, false];
    if (!opt && (paramsObj[name] === undefined || paramsObj[name] === null)) {
      throw new Error(`Falta parámetro requerido: ${name}`);
    }
    values.push(paramsObj[name] ?? null);
  }

  // auditoría en tu DB backend (si querés guardar ahí, hacelo en otro modulo).
  const client = await pool.connect();
  try {
    await client.query(`SET statement_timeout = '5000ms'`);
    await client.query(`BEGIN`);
    // Idempotencia básica (opcional): si querés, crear tabla en la DB EXTERNA.
    // Por simplicidad, ejecutamos directo.
    const res = await client.query(template.sql, values);
    await client.query(`COMMIT`);
    return { rows: res.rows };
  } catch (e) {
    try { await client.query(`ROLLBACK`); } catch {}
    return { error: e.message };
  } finally {
    client.release();
    await pool.end();
  }
}
