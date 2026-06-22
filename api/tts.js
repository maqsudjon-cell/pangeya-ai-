import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts';

// FREE neural text-to-speech using Microsoft Edge's online voices.
// No API key, no per-character cost — natural Azure neural voices, streamed.
const VOICES = [
  'en-GB-SoniaNeural', 'en-GB-RyanNeural', 'en-GB-LibbyNeural',
  'en-US-AriaNeural', 'en-US-JennyNeural', 'en-US-GuyNeural',
  'en-AU-NatashaNeural'
];
const DEFAULT_VOICE = 'en-GB-SoniaNeural';

function cors(res){
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

async function synth(res, text, voice){
  const v = VOICES.includes(voice) ? voice : DEFAULT_VOICE;
  const input = (text || '').toString().slice(0, 1500);
  const tts = new MsEdgeTTS();
  await tts.setMetadata(v, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
  const { audioStream } = tts.toStream(input);
  res.status(200);
  cors(res);
  res.setHeader('Content-Type', 'audio/mpeg');
  res.setHeader('Cache-Control', 'no-store');
  await new Promise((resolve, reject) => {
    audioStream.on('data', (d) => { try { res.write(d); } catch (_) {} });
    audioStream.on('end', resolve);
    audioStream.on('close', resolve);
    audioStream.on('error', reject);
  });
  try { tts.close(); } catch (_) {}
  res.end();
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') { res.status(200); cors(res); res.end(); return; }
  try {
    if (req.method === 'GET') {
      const text = (req.query?.text || '').toString();
      if (!text.trim()) { res.status(400); cors(res); res.json({ error: 'Missing text' }); return; }
      await synth(res, text, (req.query?.voice || '').toString());
      return;
    }
    if (req.method === 'POST') {
      const { text, voice } = req.body || {};
      if (!text || !String(text).trim()) { res.status(400); cors(res); res.json({ error: 'Missing text' }); return; }
      await synth(res, text, voice);
      return;
    }
    res.status(405); cors(res); res.json({ error: 'Method not allowed' });
  } catch (error) {
    if (!res.headersSent) { res.status(500); cors(res); res.json({ error: 'TTS error: ' + (error?.message || 'failed') }); }
    else { try { res.end(); } catch (_) {} }
  }
}
