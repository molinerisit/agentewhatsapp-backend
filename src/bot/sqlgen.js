// src/bot/sqlgen.js
import pg from 'pg';
import OpenAI from 'openai';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

function sanitizeSQL(sql) {
  const s = String(sql || '').trim();
  // Sólo permitir SELECT …; sin ; extra, sin with/alter/drop/insert/update/delete
  const lowered = s.toLowerCase().replace(/\s+/g, ' ');
  if (!lowered.startsWith('select ')) throw new Error('Solo se permiten consultas SELECT');
  if (/;.*\S/.test(s.slice(s.indexOf(';') + 1))) throw new Error('Una sola sentencia permitida');
  if (/(insert|update|delete|drop|alter|truncate|create|grant|revoke|merge)\b/i.test(s)) {
    throw new Error('Operación no permitida');
  }
  // Forzar LIMIT si no hay
  if (!/\blimit\s+\d+/i.test(lowered)) return `${s.replace(/;?$/, '')} LIMIT 50;`;
  return s.endsWith(';') ? s : `${s};`;
}

export async function queryExternalDb(dbUrl, userQuery) {
  const pool = new pg.Pool({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });

  // 1) Schema discovery (todas menos las de sistema)
  const { rows: schemaRows } = await pool.query(`
    SELECT table_schema, table_name, column_name, data_type
    FROM information_schema.columns
    WHERE table_schema NOT IN ('pg_catalog','information_schema')
    ORDER BY table_schema, table_name, ordinal_position
  `);

  const schemaLines = schemaRows.map(r => `${r.table_schema}.${r.table_name}.${r.column_name} (${r.data_type})`);
  const schemaText = schemaLines.slice(0, 4000).join('\n'); // recorte defensivo

  // 2) Pedir SQL a OpenAI
  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0,
    messages: [
      {
        role: "system",
        content:
`Eres un generador de SQL para PostgreSQL. Reglas:
- Usa SOLO el siguiente esquema (tablas y columnas).
- NO inventes tablas/columnas.
- Genera UNA sola sentencia SELECT válida.
- Si faltan filtros, asumí valores razonables.
- Agrega ORDER BY y LIMIT si corresponde.
Esquema:
${schemaText}`
      },
      { role: "user", content: `Necesito un SELECT que responda: "${userQuery}"` }
    ]
  });

  let sql = completion.choices[0].message.content || '';
  sql = sanitizeSQL(sql);

  // 3) Ejecutar en modo sólo-lectura con timeouts
  let rows, error;
  const client = await pool.connect();
  try {
    await client.query(`SET statement_timeout = '5000ms'`);
    await client.query(`SET idle_in_transaction_session_timeout = '5000ms'`);
    // Solo ejecutar
    const res = await client.query(sql);
    rows = res.rows;
  } catch (e) {
    error = e.message;
  } finally {
    client.release();
    await pool.end();
  }

  return { sql, rows, error };
}
