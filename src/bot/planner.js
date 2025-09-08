// src/bot/planner.js
import OpenAI from 'openai';
import { getActionsForMode } from './actions.js';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export async function planAction({ mode, userText, schemaSynopsis }) {
  // schemaSynopsis: string opcional con tablas/columnas detectadas (mejora precisión)
  const actions = getActionsForMode(mode);
  const actionsDesc = actions.map(a => `- ${a.id}: ${a.description}; params: ${a.params.join(', ')}`).join('\n');

  const sys = `Sos un planner de acciones sobre Postgres.
- Elegí SOLO una acción de la lista.
- Extraé parámetros en JSON. Respetá nombres de params.
- Si un param termina con "?", es opcional.
- Si NO hay acción adecuada, responde {"action":"none"}.
${schemaSynopsis ? `\nSchema:\n${schemaSynopsis}\n` : ''}`;

  const user = `Texto del usuario: """${userText}"""
Acciones disponibles:
${actionsDesc}
Devolvé un JSON con forma:
{"action":"<id>", "params":{"param1":"..."},"summary":"..."}
o {"action":"none"}`;

  const comp = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0,
    messages: [{ role:'system', content: sys }, { role:'user', content: user }]
  });

  let out = comp.choices[0].message.content || '';
  try { out = JSON.parse(out); } catch { out = { action: 'none' }; }
  if (!out || typeof out !== 'object') return { action:'none' };
  return out;
}
