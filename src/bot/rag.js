// src/bot/rag.js
import { pool } from './config.js';
// Import correcto para Node (quita el warning):
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import OpenAI from 'openai';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const EMB_MODEL = process.env.EMBEDDING_MODEL || 'text-embedding-3-small';
const EMB_DIM_BY_MODEL = { 'text-embedding-3-small': 1536, 'text-embedding-3-large': 3072 };
const EMB_DIM = EMB_DIM_BY_MODEL[EMB_MODEL] || 1536;

// Si RAG_USE_PGVECTOR=false -> fuerza fallback
const FORCE_NO_PGV = String(process.env.RAG_USE_PGVECTOR || '').toLowerCase() === 'false';

// ---------- utils ----------
function toSqlArray(arr) { return `{${(arr || []).map(v => Number.isFinite(v) ? v : 0).join(',')}}`; }

function chunkText(text, maxTokens = 700, overlap = 100) {
  const size = maxTokens * 4, olap = overlap * 4;
  const out = [];
  for (let i = 0; i < text.length; ) {
    const end = Math.min(text.length, i + size);
    out.push(text.slice(i, end));
    if (end === text.length) break;
    i = Math.max(0, end - olap);
  }
  return out.map(t => t.trim()).filter(Boolean);
}

async function embedBatch(texts, batchSize = 64) {
  const all = [];
  for (let i = 0; i < texts.length; i += batchSize) {
    const slice = texts.slice(i, i + batchSize);
    const res = await openai.embeddings.create({ model: EMB_MODEL, input: slice });
    for (const d of res.data) all.push(d.embedding);
  }
  return all;
}

async function extractPdfText(buffer) {
  const loadingTask = getDocument({ data: buffer });
  const pdf = await loadingTask.promise;
  let full = '';
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    full += content.items.map(it => it.str).join(' ') + '\n';
  }
  return full.trim();
}

// ---------- detección de pgvector (sin CREATE EXTENSION) ----------
let USE_PGVECTOR = !FORCE_NO_PGV;
if (USE_PGVECTOR) {
  try {
    // Si la extensión ya está instalada en el server, aparece acá:
    const { rows } = await pool.query(
      `SELECT 1 FROM pg_extension WHERE extname = 'vector' LIMIT 1`
    );
    if (!rows.length) {
      console.warn('[RAG] pgvector NO instalado; uso fallback real[]');
      USE_PGVECTOR = false;
    } else {
      console.log('[RAG] pgvector detectado; uso tipo vector');
    }
  } catch (e) {
    console.warn('[RAG] No puedo chequear pg_extension; uso fallback real[]:', e?.message || e);
    USE_PGVECTOR = false;
  }
}
if (FORCE_NO_PGV) console.log('[RAG] Forzado sin pgvector por env RAG_USE_PGVECTOR=false');

// ---------- esquema ----------
await pool.query(`
  CREATE TABLE IF NOT EXISTS rag_sources (
    id           bigserial PRIMARY KEY,
    instance_id  text NOT NULL,
    title        text,
    filename     text,
    bytes        int,
    created_at   timestamptz DEFAULT now()
  )
`);

if (USE_PGVECTOR) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS rag_chunks (
      id           bigserial PRIMARY KEY,
      source_id    bigint REFERENCES rag_sources(id) ON DELETE CASCADE,
      instance_id  text NOT NULL,
      chunk_ix     int NOT NULL,
      text         text NOT NULL,
      embedding    vector(${EMB_DIM})
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS rag_chunks_instance_idx ON rag_chunks(instance_id)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS rag_chunks_source_idx   ON rag_chunks(source_id)`);
  // índice aproximado (si falla, seguimos igual)
  try {
    await pool.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE c.relname = 'rag_chunks_embedding_ivfflat_idx'
        ) THEN
          EXECUTE 'CREATE INDEX rag_chunks_embedding_ivfflat_idx ON rag_chunks USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100)';
        END IF;
      END$$;
    `);
  } catch {}
} else {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS rag_chunks (
      id           bigserial PRIMARY KEY,
      source_id    bigint REFERENCES rag_sources(id) ON DELETE CASCADE,
      instance_id  text NOT NULL,
      chunk_ix     int NOT NULL,
      text         text NOT NULL,
      embedding    real[]
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS rag_chunks_instance_idx ON rag_chunks(instance_id)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS rag_chunks_source_idx   ON rag_chunks(source_id)`);
  console.log('[RAG] Esquema fallback listo (embedding real[])');
}

// ---------- API ----------
export async function ingestPdf(instanceId, fileBuffer, fileName = 'rules.pdf') {
  const text = (await extractPdfText(fileBuffer)).replace(/\s+\n/g, '\n').trim();
  if (!text) throw new Error('PDF sin texto extraíble');

  const { rows: srcRows } = await pool.query(
    'INSERT INTO rag_sources (instance_id, title, filename, bytes) VALUES ($1,$2,$3,$4) RETURNING id',
    [instanceId, fileName, fileName, fileBuffer?.length || 0]
  );
  const sourceId = srcRows[0].id;

  const chunks = chunkText(text);
  if (!chunks.length) return { sourceId, chunks: 0 };

  const embeddings = await embedBatch(chunks);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (USE_PGVECTOR) {
      for (let i = 0; i < chunks.length; i++) {
        const vec = `[${embeddings[i].map(v => (Number.isFinite(v) ? v : 0)).join(',')}]`;
        await client.query(
          'INSERT INTO rag_chunks (source_id, instance_id, chunk_ix, text, embedding) VALUES ($1,$2,$3,$4,$5::vector)',
          [sourceId, instanceId, i, chunks[i], vec]
        );
      }
    } else {
      for (let i = 0; i < chunks.length; i++) {
        const arr = toSqlArray(embeddings[i]);
        await client.query(
          'INSERT INTO rag_chunks (source_id, instance_id, chunk_ix, text, embedding) VALUES ($1,$2,$3,$4,$5::real[])',
          [sourceId, instanceId, i, chunks[i], arr]
        );
      }
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK'); throw e;
  } finally {
    client.release();
  }

  return { sourceId, chunks: chunks.length };
}

function cosine(a, b) {
  let dot = 0, na = 0, nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const x = a[i] || 0, y = b[i] || 0;
    dot += x * y; na += x * x; nb += y * y;
  }
  if (!na || !nb) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

export async function ragSearch(instanceId, query, k = 5) {
  const { data } = await openai.embeddings.create({ model: EMB_MODEL, input: query });
  const qvec = data[0].embedding;

  if (USE_PGVECTOR) {
    const q = `[${qvec.map(v => (Number.isFinite(v) ? v : 0)).join(',')}]`;
    const { rows } = await pool.query(
      `
      SELECT id, text, 1 - (embedding <=> $1::vector) AS score
      FROM rag_chunks
      WHERE instance_id = $2
      ORDER BY embedding <=> $1::vector
      LIMIT $3
      `,
      [q, instanceId, k]
    );
    return rows;
  }

  // Fallback: ranking en Node
  const { rows } = await pool.query(
    `SELECT id, text, embedding FROM rag_chunks WHERE instance_id=$1 LIMIT 1000`,
    [instanceId]
  );
  return rows
    .map(r => ({ id: r.id, text: r.text, score: cosine(qvec, r.embedding || []) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
}

export async function parsePdfBuffer(buffer) {
  try { return await extractPdfText(buffer); }
  catch (err) { console.error('[RAG][PDF] Error parseando:', err.message); return ''; }
}
