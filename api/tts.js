import { OpenAI } from 'openai';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const VOICES = ['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer'];

function cors(res){
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

async function synth(res, text, voice, model){
  const input = (text || '').slice(0, 1500);
  const v = VOICES.includes(voice) ? voice : 'fable';
  const speech = await openai.audio.speech.create({ model: model || 'tts-1', voice: v, input, response_format: 'mp3' });
  res.status(200);
  cors(res);
  res.setHeader('Content-Type', 'audio/mpeg');
  res.setHeader('Cache-Control', 'no-store');
  const body = speech.body;
  // stream chunks as they arrive (low latency); fall back to buffered
  if (body && typeof body.getReader === 'function') {
    const reader = body.getReader();
    for (;;) { const { done, value } = await reader.read(); if (done) break; res.write(Buffer.from(value)); }
    res.end();
  } else if (body && typeof body.pipe === 'function') {
    body.pipe(res);
  } else {
    res.end(Buffer.from(await speech.arrayBuffer()));
  }
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') { res.status(200); cors(res); res.end(); return; }
  try {
    if (req.method === 'GET') {
      const text = (req.query?.text || '').toString();
      if (!text.trim()) { res.status(400); cors(res); res.json({ error: 'Missing text' }); return; }
      await synth(res, text, (req.query?.voice || '').toString(), (req.query?.model || '').toString());
      return;
    }
    if (req.method === 'POST') {
      const { text, voice, model } = req.body || {};
      if (!text || !String(text).trim()) { res.status(400); cors(res); res.json({ error: 'Missing text' }); return; }
      await synth(res, text, voice, model);
      return;
    }
    res.status(405); cors(res); res.json({ error: 'Method not allowed' });
  } catch (error) {
    const status = error?.status || error?.response?.status;
    let reason = 'Text-to-speech failed.';
    if (status === 401) reason = 'OpenAI rejected the API key (401).';
    else if (status === 429) reason = 'OpenAI rate limit or quota (429).';
    else if (error?.message) reason = 'TTS error: ' + error.message;
    if (!res.headersSent) { res.status(status && status >= 400 ? status : 500); cors(res); res.json({ error: reason }); }
    else { try { res.end(); } catch (_) {} }
  }
}
