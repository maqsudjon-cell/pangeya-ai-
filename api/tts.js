import OpenAI from 'openai';
import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts';

// PRIMARY: Groq Orpheus (canopylabs/orpheus-v1-english) — expressive, human-sounding,
// fast on Groq LPUs, billed per character. FALLBACK: free Microsoft Edge neural voices.
// If Orpheus is unavailable (e.g. billing not enabled), we transparently fall back to Edge
// and tell the client via the X-TTS-Engine header so it stops retrying Orpheus.
const groqKey = process.env.GROQ_API_KEY;
const groq = groqKey ? new OpenAI({ apiKey: groqKey, baseURL: 'https://api.groq.com/openai/v1' }) : null;

const ORPHEUS_MODEL = 'canopylabs/orpheus-v1-english';
const ORPHEUS_VOICE = 'autumn';   // warm, natural, conversational female voice

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
  const v = (voice && /^[a-zA-Z]+$/.test(voice)) ? voice : ORPHEUS_VOICE;   // Orpheus uses bare names
  const r = await groq.audio.speech.create({
    model: ORPHEUS_MODEL, voice: v, input: text, response_format: 'mp3'
  });
  return Buffer.from(await r.arrayBuffer());
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
  if (want !== 'edge' && want !== 'orpheus') want = groq ? 'orpheus' : 'edge';

  let buf, used;
  if (want === 'orpheus' && groq) {
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
    const text = (p.text || '').toString();
    if (!text.trim()) { res.status(400); cors(res); res.json({ error: 'Missing text' }); return; }
    if (req.method !== 'GET' && req.method !== 'POST') { res.status(405); cors(res); res.json({ error: 'Method not allowed' }); return; }
    await speak(res, text, (p.voice || '').toString(), (p.engine || '').toString());
  } catch (error) {
    if (!res.headersSent) { res.status(500); cors(res); res.json({ error: 'TTS error: ' + (error?.message || 'failed') }); }
    else { try { res.end(); } catch (_) {} }
  }
}
