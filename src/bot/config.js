// src/bot/config.js
import pg from 'pg';
const { Pool } = pg;

function getDbUrl() {
  // Toma primero PUBLIC, luego la normal
  let url = (process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL || '').trim();

  // Log de diagnóstico (enmascarado)
  const masked = url
    ? url.replace(/\/\/([^:]+):([^@]+)@/, (_m, u) => `//${u}:***@`)
    : '(vacía)';
  console.log('[DB] DATABASE_URL=', masked);

  if (!url) {
    throw new Error(
      'DATABASE_URL no configurado. Definí DATABASE_URL=postgresql://USER:PASS@HOST:PORT/DB?sslmode=require'
    );
  }

  // Debe empezar con postgres:// o postgresql://
  if (!/^postgres(ql)?:\/\//i.test(url)) {
    throw new Error(`DATABASE_URL inválido (falta protocolo postgres:// o postgresql://): ${masked}`);
  }

  // Asegurar ssl
  if (!/[?&]sslmode=/i.test(url) && !/[?&]ssl=/.test(url)) {
    url += (url.includes('?') ? '&' : '?') + 'sslmode=require';
  }
  return url;
}

const connectionString = getDbUrl();

export const pool = new Pool({
  connectionString,
  // Railway usa certificados manejados, esto suele ser necesario:
  ssl: { rejectUnauthorized: false },
});

// Ping en arranque (diagnóstico)
try {
  const r = await pool.query('select 1 as ok');
  console.log('[DB] ping ok:', r.rows[0]);
} catch (e) {
  console.error('[DB] ping error:', e?.message || e);
  throw e;
}
