// src/bot/rag.js
import { pool } from './config.js';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.js';
import OpenAI from 'openai';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const EMB_MODEL = process.env.EMBEDDING_MODEL || 'text-embedding-3-small';

// Dimensión por modelo
const EMB_DIM_BY_MODEL = {
  'text-embedding-3-small': 1536,
  'text-embedding-3-large': 3072
};
const EMB_DIM = EMB_DIM_BY_MODEL[EMB_MODEL] || 1536;

/* ------------------------- Helpers ------------------------- */

// Convierte array JS -> literal SQL pgvector: "[0.1,0.2,...]"
function toSqlVector(arr) {
  return `[${arr.map(v => (Number.isFinite(v) ? v : 0)).join(',')}]`;
}

// Segmenta texto aprox por tokens con solapado real
function chunkText(text, maxTokens = 700, overlap = 100) {
  const size = maxTokens * 4; // aprox chars/token
  const olap = overlap   * 4;
  const out = [];
  let i = 0;
  while (i < text.length) {
    const end = Math.min(text.length, i + size);
    out.push(text.slice(i, end));
    if (end === text.length) break;
    i = Math.max(0, end - olap);
  }
  return out.map(t => t.trim()).filter(Boolean);
}

// Embeddings por lotes para evitar rate limits
async function embedBatch(texts, batchSize = 64) {
  const all = [];
  for (let i = 0; i < texts.length; i += batchSize) {
    const slice = texts.slice(i, i + batchSize);
    const res = await openai.embeddings.create({ model: EMB_MODEL, input: slice });
    for (const d of res.data) all.push(d.embedding);
  }
  return all;
}

// Extrae texto de PDF desde un Buffer usando pdfjs-dist
async function extractPdfText(buffer) {
  const loadingTask = pdfjs.getDocument({ data: buffer });
  const pdf = await loadingTask.promise;
  let full = '';
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    full += content.items.map(it => it.str).join(' ') + '\n';
  }
  return full.trim();
}

/* --------------------- Bootstrap DB ----------------------- */

await pool.query(`CREATE EXTENSION IF NOT EXISTS vector`);
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

// Índice ANN ivfflat para cosine (se crea una vez)
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

/* ------------------------ API ----------------------------- */

// Ingesta de PDF: parte en chunks, embebe y guarda
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

    for (let i = 0; i < chunks.length; i++) {
      const vec = toSqlVector(embeddings[i]);
      await client.query(
        'INSERT INTO rag_chunks (source_id, instance_id, chunk_ix, text, embedding) VALUES ($1,$2,$3,$4,$5::vector)',
        [sourceId, instanceId, i, chunks[i], vec]
      );
    }

    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }

  return { sourceId, chunks: chunks.length };
}

// Búsqueda semántica: devuelve top-k con score (cosine similarity)
export async function ragSearch(instanceId, query, k = 5) {
  const { data } = await openai.embeddings.create({ model: EMB_MODEL, input: query });
  const qvec = toSqlVector(data[0].embedding);

  const { rows } = await pool.query(
    `
    SELECT id, text, 1 - (embedding <=> $1::vector) AS score
    FROM rag_chunks
    WHERE instance_id = $2
    ORDER BY embedding <=> $1::vector
    LIMIT $3
    `,
    [qvec, instanceId, k]
  );

  return rows;
}

// Parser de PDF expuesto (opcional)
export async function parsePdfBuffer(buffer) {
  try {
    return await extractPdfText(buffer);
  } catch (err) {
    console.error('[RAG][PDF] Error parseando:', err.message);
    return '';
  }
}
