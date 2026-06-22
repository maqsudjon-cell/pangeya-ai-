import { OpenAI } from 'openai';

// Initialize the OpenAI client using the API key from the environment.  Vercel
// provides environment variables through process.env when deployed.  The
// "OPENAI_API_KEY" variable must be defined in your Vercel project
// settings for this function to succeed.  Do not hard-code the key in
// source code to keep it secure.
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

/**
 * Vercel serverless function that proxies chat messages to OpenAI's chat API.
 *
 * The client should send a POST request with a JSON body containing the
 * following fields:
 *   - message: the latest user message (string)
 *   - chatHistory: array of prior messages in the format { role, content }
 *   - systemPrompt: a system prompt to instruct the assistant
 *   - model: (optional) the OpenAI model identifier to use
 *   - userId: (optional) a unique identifier for the user
 *
 * This function responds with a JSON payload containing either a
 * "reply" field with the assistant's message or an "error" field.
 * CORS headers are added to allow requests from any origin.
 */
export default async function handler(req, res) {
  // Allow preflight requests
  if (req.method === 'OPTIONS') {
    res.status(200)
      .setHeader('Access-Control-Allow-Origin', '*')
      .setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
      .setHeader('Access-Control-Allow-Headers', 'Content-Type')
      .end();
    return;
  }
  if (req.method !== 'POST') {
    res.status(405)
      .setHeader('Access-Control-Allow-Origin', '*')
      .json({ error: 'Method not allowed' });
    return;
  }
  // Extract payload
  const { message, chatHistory, systemPrompt, model, maxTokens } = req.body || {};
  if (!message || !Array.isArray(chatHistory) || !systemPrompt) {
    res.status(400)
      .setHeader('Access-Control-Allow-Origin', '*')
      .json({ error: 'Invalid request payload' });
    return;
  }
  try {
    // Construct messages array: system prompt first, followed by prior
    // conversation history and the latest user message.  The chat API will
    // use this context to generate a coherent reply.
    const messages = [
      { role: 'system', content: systemPrompt },
      ...chatHistory.map(m => ({ role: m.role, content: m.content })),
      { role: 'user', content: message }
    ];
    const params = {
      model: model || 'gpt-3.5-turbo',
      messages,
      temperature: 0.7
    };
    if (Number.isFinite(maxTokens) && maxTokens > 0) params.max_tokens = Math.min(maxTokens, 500);
    const completion = await openai.chat.completions.create(params);
    const reply = completion.choices?.[0]?.message?.content || '';
    res.status(200)
      .setHeader('Access-Control-Allow-Origin', '*')
      .json({ reply: reply.trim() });
  } catch (error) {
    console.error('Error in chat function:', error);
    // Surface a useful reason so the client (and you) can see what went wrong.
    const status = error?.status || error?.response?.status;
    let reason = 'Failed to generate a response from the AI.';
    if (status === 401) reason = 'OpenAI rejected the API key (401). Check OPENAI_API_KEY in Vercel.';
    else if (status === 429) reason = 'OpenAI rate limit or quota exceeded (429). Check your OpenAI billing/credits.';
    else if (status === 404) reason = 'Model not found (404). The model name may be unavailable on this key.';
    else if (error?.code === 'insufficient_quota') reason = 'OpenAI quota exhausted. Add credits to your OpenAI account.';
    else if (error?.message) reason = 'AI error: ' + error.message;
    res.status(status && status >= 400 ? status : 500)
      .setHeader('Access-Control-Allow-Origin', '*')
      .json({ error: reason });
  }
}
