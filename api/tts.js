import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts';

// FREE neural TTS via Microsoft Edge's online voices (no key, no cost). Audio is STREAMED
// to the client so playback starts almost immediately (no waiting for the full clip).
// Orpheus (Groq) stays reachable via ?engine=orpheus but is not the default (needs terms/billing).
const groqKey = process.env.GROQ_API_KEY;

const ORPHEUS_MODEL = 'canopylabs/orpheus-v1-english';
const ORPHEUS_VOICE = 'autumn';

const EDGE_DEFAULT = 'en-US-AvaMultilingualNeural'; // natural, warm, free
const EDGE_SAFE    = 'en-GB-SoniaNeural';           // known-good retry if a voice is unavailable
const VOICE_RE = /^[a-zA-Z]{2}-[A-Za-z]{2,}-[A-Za-z]+$/;

function cors(res){
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Expose-Headers', 'X-TTS-Engine');
}

async function setupEdge(text, voice){
  const t = new MsEdgeTTS();
  await t.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
  const { audioStream } = t.toStream(text);
  return { t, audioStream };
}

// Fast path: stream Edge audio chunks to the response as they're produced.
async function edgeStream(res, text, voice){
  const wanted = (voice && VOICE_RE.test(voice)) ? voice : EDGE_DEFAULT;
  let s;
  try { s = await setupEdge(text, wanted); }
  catch (e) { if (wanted !== EDGE_SAFE) s = await setupEdge(text, EDGE_SAFE); else throw e; }
  cors(res);
  res.setHeader('Content-Type', 'audio/mpeg');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-TTS-Engine', 'edge');
  res.status(200);
  await new Promise((resolve, reject) => {
    s.audioStream.on('data', d => { try { res.write(d); } catch (_) {} });
    s.audioStream.on('end', resolve);
    s.audioStream.on('close', resolve);
    s.audioStream.on('error', reject);
  });
  try { s.t.close(); } catch (_) {}
  res.end();
}

// Buffered Edge (used only by ?debug=1).
async function edgeBuffer(text, voice){
  const synth = async (v) => {
    const { t, audioStream } = await setupEdge(text, v);
    const chunks = [];
    await new Promise((resolve, reject) => {
      audioStream.on('data', d => chunks.push(d));
      audioStream.on('end', resolve);
      audioStream.on('close', resolve);
      audioStream.on('error', reject);
    });
    try { t.close(); } catch (_) {}
    return Buffer.concat(chunks);
  };
  const wanted = (voice && VOICE_RE.test(voice)) ? voice : EDGE_DEFAULT;
  try { return await synth(wanted); }
  catch (e) { if (wanted !== EDGE_SAFE) return await synth(EDGE_SAFE); throw e; }
}

async function viaOrpheus(text, voice){
  const v = (voice && /^[a-zA-Z]+$/.test(voice)) ? voice : ORPHEUS_VOICE;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12000);
  try {
    const r = await fetch('https://api.groq.com/openai/v1/audio/speech', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + groqKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: ORPHEUS_MODEL, voice: v, input: text, response_format: 'mp3' }),
      signal: ctrl.signal
    });
    if (!r.ok) {
      const body = await r.text().catch(() => '');
      const e = new Error('Groq TTS HTTP ' + r.status + (body ? (': ' + body.slice(0, 300)) : ''));
      e.status = r.status; throw e;
    }
    return Buffer.from(await r.arrayBuffer());
  } finally { clearTimeout(timer); }
}

async function speak(res, text, voice, engine){
  const input = (text || '').toString().slice(0, 1200);
  const want = (engine || '').toLowerCase() === 'orpheus' ? 'orpheus' : 'edge';
  if (want === 'orpheus' && groqKey) {
    try {
      const buf = await viaOrpheus(input, voice);
      cors(res); res.setHeader('Content-Type', 'audio/mpeg'); res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-TTS-Engine', 'orpheus');
      res.status(200).end(buf); return;
    } catch (e) { /* fall through to streaming Edge */ }
  }
  await edgeStream(res, input, voice);
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') { res.status(200); cors(res); res.end(); return; }
  try {
    const p = req.method === 'GET' ? (req.query || {}) : (req.body || {});
    if (p.debug) {
      const out = { groqConfigured: !!groqKey, edgeDefault: EDGE_DEFAULT };
      try { const b = await edgeBuffer('Hello, this is a quick test of the examiner voice.', (p.voice || '').toString()); out.edge = 'ok'; out.bytes = b.length; }
      catch (e) { out.edge = 'FAILED'; out.edgeError = (e && (e.message || String(e))) || 'unknown'; }
      cors(res); res.status(200).json(out); return;
    }
    const text = (p.text || '').toString();
    if (!text.trim()) { res.status(400); cors(res); res.json({ error: 'Missing text' }); return; }
    if (req.method !== 'GET' && req.method !== 'POST') { res.status(405); cors(res); res.json({ error: 'Method not allowed' }); return; }
    await speak(res, text, (p.voice || '').toString(), (p.engine || '').toString());
  } catch (error) {
    if (!res.headersSent) { res.status(500); cors(res); res.json({ error: 'TTS error: ' + (error?.message || 'failed') }); }
    else { try { res.end(); } catch (_) {} }
  }
}
