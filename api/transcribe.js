import { OpenAI, toFile } from 'openai';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

function cors(res){
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

/**
 * Speech-to-text proxy (for browsers without Web Speech, e.g. iOS Safari).
 * Client POSTs the raw recorded audio bytes (Content-Type audio/webm or audio/mp4).
 * Returns { text }. Uses OpenAI Whisper.
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
    const file = await toFile(buf, 'audio.' + ext, { type: ct });

    const tr = await openai.audio.transcriptions.create({ file, model: 'whisper-1', language: 'en' });
    res.status(200); cors(res); res.json({ text: (tr.text || '').trim() });
  } catch (error) {
    const status = error?.status || error?.response?.status;
    let reason = 'Transcription failed.';
    if (status === 401) reason = 'OpenAI rejected the API key (401).';
    else if (status === 429) reason = 'OpenAI rate limit or quota (429).';
    else if (error?.message) reason = 'STT error: ' + error.message;
    res.status(status && status >= 400 ? status : 500); cors(res); res.json({ error: reason });
  }
}
