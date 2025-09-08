// src/bot/rag.js
import { pool } from './config.js';
import pdf from 'pdf-parse';
import OpenAI from 'openai';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const EMB_MODEL = process.env.EMBEDDING_MODEL || 'text-embedding-3-small';

// bootstrap de extensión y tablas
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
    embedding    vector(1536)
  )
`);
await pool.query(`CREATE INDEX IF NOT EXISTS rag_chunks_instance_idx ON rag_chunks(instance_id)`);
await pool.query(`CREATE INDEX IF NOT EXISTS rag_chunks_source_idx ON rag_chunks(source_id)`);

function chunkText(text, maxTokens = 700, overlap = 100) {
  const size = maxTokens * 4;
  const olap = overlap * 4;
  const out = [];
  let i = 0;
  while (i < text.length) {
    const end = Math.min(text.length, i + size);
    out.push(text.slice(i, end));
    i = Math.max(end - olap, end); // sin solapado hacia atrás para simplificar
  }
  return out.map(t => t.trim()).filter(Boolean);
}

async function embedBatch(texts) {
  const res = await openai.embeddings.create({ model: EMB_MODEL, input: texts });
  return res.data.map(d => d.embedding);
}

export async function ingestPdf(instanceId, fileBuffer, fileName = 'rules.pdf') {
  const data = await pdf(fileBuffer);
  const text = (data.text || '').replace(/\s+\n/g, '\n').trim();
  if (!text) throw new Error('PDF sin texto extraíble');

  const { rows: srcRows } = await pool.query(
    'INSERT INTO rag_sources (instance_id, title, filename, bytes) VALUES ($1,$2,$3,$4) RETURNING id',
    [instanceId, fileName, fileName, fileBuffer?.length || 0]
  );
  const sourceId = srcRows[0].id;

  const chunks = chunkText(text);
  const embeddings = await embedBatch(chunks);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (let i = 0; i < chunks.length; i++) {
      await client.query(
        'INSERT INTO rag_chunks (source_id, instance_id, chunk_ix, text, embedding) VALUES ($1,$2,$3,$4,$5)',
        [sourceId, instanceId, i, chunks[i], embeddings[i]]
      );
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK'); throw e;
  } finally {
    client.release();
  }

  return { sourceId, chunks: chunks.length };
}

export async function ragSearch(instanceId, query, k = 5) {
  const { data } = await openai.embeddings.create({ model: EMB_MODEL, input: query });
  const qvec = data[0].embedding;

  const { rows } = await pool.query(`
    SELECT id, text, 1 - (embedding <=> $1) AS score
    FROM rag_chunks
    WHERE instance_id = $2
    ORDER BY embedding <=> $1
    LIMIT $3
  `, [qvec, instanceId, k]);

  return rows;
}
