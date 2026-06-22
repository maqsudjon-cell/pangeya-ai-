import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts';

// PRIMARY: Groq Orpheus (canopylabs/orpheus-v1-english) — expressive, human-sounding.
// We call Groq's OpenAI-compatible /audio/speech endpoint with a RAW fetch (the OpenAI SDK
// mishandles Groq's binary audio response and throws a spurious "Connection error").
// FALLBACK: free Microsoft Edge neural voices. The X-TTS-Engine header tells the client
// which one actually served, so it stops retrying Orpheus when it's unavailable.
const groqKey = process.env.GROQ_API_KEY;

const ORPHEUS_MODEL = 'canopylabs/orpheus-v1-english';
const ORPHEUS_VOICE = 'autumn';   // warm, natural, conversational voice

const EDGE_VOICES = [
  'en-GB-SoniaNeural', 'en-GB-RyanNeural', 'en-GB-LibbyNeural',
  'en-US-AriaNeural', 'en-US-JennyNeural', 'en-US-GuyNeural',
  'en-AU-NatashaNeural'
];
const EDGE_DEFAULT = 'en-GB-SoniaNeural';

function cors(res){
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Expose-Headers', 'X-TTS-Engine');
}

async function viaOrpheus(text, voice){
  const v = (voice && /^[a-zA-Z]+$/.test(voice)) ? voice : ORPHEUS_VOICE;   // Orpheus uses bare voice names
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
      e.status = r.status;
      throw e;
    }
    return Buffer.from(await r.arrayBuffer());
  } finally {
    clearTimeout(timer);
  }
}

async function viaEdge(text, voice){
  const v = EDGE_VOICES.includes(voice) ? voice : EDGE_DEFAULT;
  const tts = new MsEdgeTTS();
  await tts.setMetadata(v, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
  const { audioStream } = tts.toStream(text);
  const chunks = [];
  await new Promise((resolve, reject) => {
    audioStream.on('data', d => chunks.push(d));
    audioStream.on('end', resolve);
    audioStream.on('close', resolve);
    audioStream.on('error', reject);
  });
  try { tts.close(); } catch (_) {}
  return Buffer.concat(chunks);
}

async function speak(res, text, voice, engine){
  const input = (text || '').toString().slice(0, 1200);
  let want = (engine || '').toLowerCase();
  if (want !== 'edge' && want !== 'orpheus') want = groqKey ? 'orpheus' : 'edge';

  let buf, used;
  if (want === 'orpheus' && groqKey) {
    try { buf = await viaOrpheus(input, voice); used = 'orpheus'; }
    catch (e) { buf = await viaEdge(input, voice); used = 'edge'; }
  } else {
    buf = await viaEdge(input, voice); used = 'edge';
  }

  cors(res);
  res.setHeader('Content-Type', 'audio/mpeg');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-TTS-Engine', used);
  res.status(200).end(buf);
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') { res.status(200); cors(res); res.end(); return; }
  try {
    const p = req.method === 'GET' ? (req.query || {}) : (req.body || {});
    if (p.debug) {
      const out = { groqConfigured: !!groqKey, model: ORPHEUS_MODEL, voice: ORPHEUS_VOICE };
      if (groqKey) {
        try { const b = await viaOrpheus('Hello, this is a quick test of the examiner voice.', (p.voice || '').toString()); out.orpheus = 'ok'; out.bytes = b.length; out.engineWouldUse = 'orpheus'; }
        catch (e) { out.orpheus = 'FAILED'; out.orpheusError = (e && (e.message || String(e))) || 'unknown'; out.orpheusStatus = (e && (e.status || null)) || null; out.engineWouldUse = 'edge (orpheus failed -> fallback)'; }
      } else { out.engineWouldUse = 'edge (GROQ_API_KEY not set)'; }
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
