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
  const { message, chatHistory, systemPrompt, model } = req.body || {};
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
    const completion = await openai.chat.completions.create({
      model: model || 'gpt-3.5-turbo',
      messages,
      temperature: 0.7
    });
    const reply = completion.choices?.[0]?.message?.content || '';
    res.status(200)
      .setHeader('Access-Control-Allow-Origin', '*')
      .json({ reply: reply.trim() });
  } catch (error) {
    console.error('Error in chat function:', error);
    res.status(500)
      .setHeader('Access-Control-Allow-Origin', '*')
      .json({ error: 'Failed to generate a response from the AI.' });
  }
}