import OpenAI from 'openai';

// Groq = free + extremely fast (LPU). OpenAI kept as a fallback if Groq is unset/errors.
const oaKey = process.env.OPENAI_API_KEY;
const groqKey = process.env.GROQ_API_KEY;
const oa = oaKey ? new OpenAI({ apiKey: oaKey }) : null;
const groq = groqKey ? new OpenAI({ apiKey: groqKey, baseURL: 'https://api.groq.com/openai/v1' }) : null;

const GROQ_MODEL = 'llama-3.3-70b-versatile';   // fast + good quality on Groq

function cors(res){
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') { res.status(200); cors(res); res.end(); return; }
  if (req.method !== 'POST') { res.status(405); cors(res); res.json({ error: 'Method not allowed' }); return; }

  const { message, chatHistory, systemPrompt, model, maxTokens } = req.body || {};
  if (!message || typeof message !== 'string') { res.status(400); cors(res); res.json({ error: 'Missing message' }); return; }

  const messages = [];
  if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
  if (Array.isArray(chatHistory)) {
    for (const m of chatHistory) {
      if (m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string') {
        messages.push({ role: m.role, content: m.content });
      }
    }
  }
  messages.push({ role: 'user', content: message });

  const base = { messages, temperature: 0.7 };
  if (Number.isFinite(maxTokens) && maxTokens > 0) base.max_tokens = Math.min(maxTokens, 500);

  const viaGroq   = async () => (await groq.chat.completions.create({ ...base, model: GROQ_MODEL })).choices?.[0]?.message?.content || '';
  const viaOpenAI = async () => (await oa.chat.completions.create({ ...base, model: model || 'gpt-4o-mini' })).choices?.[0]?.message?.content || '';

  try {
    let reply = '';
    if (groq) { try { reply = await viaGroq(); } catch (e) { if (oa) reply = await viaOpenAI(); else throw e; } }
    else if (oa) { reply = await viaOpenAI(); }
    else { res.status(500); cors(res); res.json({ error: 'No AI provider configured (set GROQ_API_KEY or OPENAI_API_KEY)' }); return; }

    res.status(200); cors(res); res.json({ reply });
  } catch (error) {
    const status = error?.status || error?.response?.status;
    let reason = 'AI request failed.';
    if (status === 401) reason = 'API key rejected (401).';
    else if (status === 429) reason = 'Rate limit or quota (429).';
    else if (error?.message) reason = 'AI error: ' + error.message;
    res.status(status && status >= 400 ? status : 500); cors(res); res.json({ error: reason });
  }
}
