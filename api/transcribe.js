import { OpenAI, toFile } from 'openai';

// Groq Whisper (whisper-large-v3-turbo) runs on LPUs at ~216x real-time — far
// faster than OpenAI whisper-1 for the same clip. OpenAI is kept as a fallback.
const groqKey = process.env.GROQ_API_KEY;
const oaKey   = process.env.OPENAI_API_KEY;
const groq = groqKey ? new OpenAI({ apiKey: groqKey, baseURL: 'https://api.groq.com/openai/v1' }) : null;
const oa   = oaKey   ? new OpenAI({ apiKey: oaKey }) : null;

const GROQ_STT_MODEL = 'whisper-large-v3-turbo';

function cors(res){
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

/**
 * Speech-to-text proxy (for browsers without Web Speech, e.g. iOS Safari).
 * Client POSTs the raw recorded audio bytes (Content-Type audio/webm or audio/mp4).
 * Returns { text }. Uses Groq Whisper turbo, falling back to OpenAI Whisper.
 */
export default async function handler(req, res) {
  if (req.method === 'OPTIONS') { res.status(200); cors(res); res.end(); return; }
  if (req.method !== 'POST') { res.status(405); cors(res); res.json({ error: 'Method not allowed' }); return; }
  try {
    let buf;
    if (Buffer.isBuffer(req.body)) buf = req.body;
    else { const chunks = []; for await (const c of req) chunks.push(c); buf = Buffer.concat(chunks); }
    if (!buf || buf.length < 100) { res.status(400); cors(res); res.json({ error: 'No audio' }); return; }

    const ct = (req.headers['content-type'] || 'audio/webm').toString();
    const ext = ct.includes('mp4') || ct.includes('m4a') ? 'mp4' : (ct.includes('ogg') ? 'ogg' : (ct.includes('wav') ? 'wav' : 'webm'));

    // Build a fresh file per attempt so the fallback isn't fed a consumed stream.
    const makeFile = () => toFile(buf, 'audio.' + ext, { type: ct });

    const viaGroq = async () => (await groq.audio.transcriptions.create({
      file: await makeFile(), model: GROQ_STT_MODEL, language: 'en', response_format: 'json', temperature: 0
    })).text || '';
    const viaOpenAI = async () => (await oa.audio.transcriptions.create({
      file: await makeFile(), model: 'whisper-1', language: 'en'
    })).text || '';

    let text = '';
    if (groq) { try { text = await viaGroq(); } catch (e) { if (oa) text = await viaOpenAI(); else throw e; } }
    else if (oa) { text = await viaOpenAI(); }
    else { res.status(500); cors(res); res.json({ error: 'No STT provider configured (set GROQ_API_KEY or OPENAI_API_KEY)' }); return; }

    res.status(200); cors(res); res.json({ text: (text || '').trim() });
  } catch (error) {
    const status = error?.status || error?.response?.status;
    let reason = 'Transcription failed.';
    if (status === 401) reason = 'STT key rejected (401).';
    else if (status === 429) reason = 'STT rate limit or quota (429).';
    else if (error?.message) reason = 'STT error: ' + error.message;
    res.status(status && status >= 400 ? status : 500); cors(res); res.json({ error: reason });
  }
}
