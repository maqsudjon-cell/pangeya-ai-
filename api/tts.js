import { OpenAI } from 'openai';

// Reuses the same OPENAI_API_KEY env var already configured in Vercel for chat.
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const VOICES = ['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer'];

/**
 * Text-to-speech proxy. POST { text, voice?, model? } -> audio/mpeg (mp3).
 * Gives the AI examiner a natural, human-sounding voice instead of the
 * robotic browser speech synthesis. CORS is open so GitHub Pages can call it.
 */
export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.status(200)
      .setHeader('Access-Control-Allow-Origin', '*')
      .setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
      .setHeader('Access-Control-Allow-Headers', 'Content-Type')
      .end();
    return;
  }
  if (req.method !== 'POST') {
    res.status(405).setHeader('Access-Control-Allow-Origin', '*').json({ error: 'Method not allowed' });
    return;
  }

  const { text, voice, model } = req.body || {};
  if (!text || typeof text !== 'string' || !text.trim()) {
    res.status(400).setHeader('Access-Control-Allow-Origin', '*').json({ error: 'Missing text' });
    return;
  }

  const input = text.slice(0, 1500);                       // cap length for cost/latency
  const v = VOICES.includes(voice) ? voice : 'fable';      // warm, British-leaning examiner voice

  try {
    const speech = await openai.audio.speech.create({
      model: model || 'tts-1',
      voice: v,
      input,
      response_format: 'mp3'
    });
    const buffer = Buffer.from(await speech.arrayBuffer());

    res.status(200);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Cache-Control', 'no-store');
    res.end(buffer);
  } catch (error) {
    const status = error?.status || error?.response?.status;
    let reason = 'Text-to-speech failed.';
    if (status === 401) reason = 'OpenAI rejected the API key (401). Check OPENAI_API_KEY in Vercel.';
    else if (status === 429) reason = 'OpenAI rate limit or quota exceeded (429).';
    else if (status === 404) reason = 'TTS model not found (404) for this key.';
    else if (error?.code === 'insufficient_quota') reason = 'OpenAI quota exhausted.';
    else if (error?.message) reason = 'TTS error: ' + error.message;
    res.status(status && status >= 400 ? status : 500)
      .setHeader('Access-Control-Allow-Origin', '*')
      .json({ error: reason });
  }
}
