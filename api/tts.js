import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts';

// FREE neural TTS via Microsoft Edge's online voices (no key, no cost).
// The clip is synthesized fully, then served with Content-Length + HTTP Range support so
// iOS Safari plays it progressively/seekably. A no-Content-Length chunked stream stalls on
// iOS; for the short examiner replies, buffer-then-serve is fast, and the front-end also
// falls back to an instant on-device voice if synthesis is ever slow.
// Orpheus (Groq) stays reachable via ?engine=orpheus but isn't the default (needs terms/billing).
const groqKey = process.env.GROQ_API_KEY;

const ORPHEUS_MODEL = 'canopylabs/orpheus-v1-english';
const ORPHEUS_VOICE = 'autumn';

const EDGE_DEFAULT = 'en-US-JennyNeural'; // natural AND fast to synthesize (Multilingual voices like Ava are slower)
const EDGE_SAFE    = 'en-GB-SoniaNeural'; // known-good retry if a voice is unavailable
const VOICE_RE = /^[a-zA-Z]{2}-[A-Za-z]{2,}-[A-Za-z]+$/;

// 48kbit mono mp3 (~6 KB/s) is compact; the package exposes only 48k/96k mono mp3.
// mp3 is the safe choice for iOS <audio> (opus support there is inconsistent).
const FORMAT = OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3;

function cors(res){
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Range');
  res.setHeader('Access-Control-Expose-Headers', 'X-TTS-Engine, Content-Length, Content-Range, Accept-Ranges');
}

// Synthesize the whole clip into a Buffer (Edge emits chunks; we collect them).
async function edgeBuffer(text, voice){
  const synth = async (v) => {
    const t = new MsEdgeTTS();
    await t.setMetadata(v, FORMAT);
    const { audioStream } = t.toStream(text);
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

// Serve an audio Buffer with Content-Length + Range (206) so iOS plays/seeks reliably.
function sendAudio(req, res, buf, engine){
  cors(res);
  res.setHeader('Content-Type', 'audio/mpeg');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('X-TTS-Engine', engine);
  const total = buf.length;
  const range = req.headers && req.headers.range;
  const m = range && /bytes=(\d*)-(\d*)/.exec(range);
  if (m) {
    let start = m[1] === '' ? 0 : parseInt(m[1], 10);
    let end   = m[2] === '' ? total - 1 : parseInt(m[2], 10);
    if (isNaN(start) || start < 0) start = 0;
    if (isNaN(end) || end >= total) end = total - 1;
    if (start > end) start = 0;
    const slice = buf.subarray(start, end + 1);
    res.setHeader('Content-Range', `bytes ${start}-${end}/${total}`);
    res.setHeader('Content-Length', slice.length);
    res.statusCode = 206;
    res.end(slice);
    return;
  }
  res.setHeader('Content-Length', total);
  res.statusCode = 200;
  res.end(buf);
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

async function speak(req, res, text, voice, engine){
  const input = (text || '').toString().slice(0, 1200);
  const want = (engine || '').toLowerCase() === 'orpheus' ? 'orpheus' : 'edge';
  if (want === 'orpheus' && groqKey) {
    try { const buf = await viaOrpheus(input, voice); sendAudio(req, res, buf, 'orpheus'); return; }
    catch (e) { /* fall through to Edge */ }
  }
  const buf = await edgeBuffer(input, voice);
  sendAudio(req, res, buf, 'edge');
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
    await speak(req, res, text, (p.voice || '').toString(), (p.engine || '').toString());
  } catch (error) {
    if (!res.headersSent) { res.status(500); cors(res); res.json({ error: 'TTS error: ' + (error?.message || 'failed') }); }
    else { try { res.end(); } catch (_) {} }
  }
}
