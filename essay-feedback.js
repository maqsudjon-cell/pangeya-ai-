import { OpenAI } from 'openai';

// Initialise OpenAI with the API key stored in the environment.  Do not
// commit API keys to source code; Vercel exposes env vars at runtime.
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

/**
 * Serverless function for generating AI feedback on a single essay.  The
 * client should POST a JSON body with an "essay" field containing the
 * essay text.  The response will contain an IELTS-style evaluation
 * including estimated band score, strengths, weaknesses and suggested
 * improvements.
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
    res.status(405)
      .setHeader('Access-Control-Allow-Origin', '*')
      .json({ error: 'Method not allowed' });
    return;
  }
  const { essay } = req.body || {};
  if (!essay || typeof essay !== 'string' || !essay.trim()) {
    res.status(400)
      .setHeader('Access-Control-Allow-Origin', '*')
      .json({ error: 'Invalid essay text' });
    return;
  }
  try {
    // Define a system prompt instructing the model to evaluate the essay as
    // an IELTS examiner would.  The prompt requests a band score and
    // clear feedback following IELTS band descriptors.  Feel free to
    // adjust this prompt to fine‑tune feedback style.
    const systemPrompt = `You are PangeyaAI, an IELTS examiner. Evaluate the candidate's essay using the IELTS Writing Task 2 band descriptors. Provide:\n\n` +
      `• An estimated band score (e.g., Band 6.5)\n` +
      `• Strengths of the essay in terms of task response, coherence/cohesion, lexical resource, and grammatical range/accuracy\n` +
      `• Weaknesses or areas for improvement in the same categories\n` +
      `• Specific suggestions on how to improve the essay for a higher band score\n` +
      `Use clear bullet points or short paragraphs for readability. Do not mention being an AI or a model.`;
    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: essay.trim() }
    ];
    const completion = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages,
      temperature: 0.7
    });
    const feedback = completion.choices?.[0]?.message?.content || '';
    res.status(200)
      .setHeader('Access-Control-Allow-Origin', '*')
      .json({ feedback: feedback.trim() });
  } catch (error) {
    console.error('Error in essay feedback function:', error);
    res.status(500)
      .setHeader('Access-Control-Allow-Origin', '*')
      .json({ error: 'Failed to generate AI feedback' });
  }
}