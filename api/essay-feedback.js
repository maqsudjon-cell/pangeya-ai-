import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

export default async function handler(req, res) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  // Preflight
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  // ONLY POST allowed
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { essay } = req.body;

    if (!essay || essay.trim().length < 50) {
      return res.status(400).json({
        error: "Essay text is missing or too short"
      });
    }

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content:
            "You are an IELTS examiner. Give clear IELTS Writing Task feedback with band score, strengths, weaknesses and improvements."
        },
        {
          role: "user",
          content: essay
        }
      ],
      temperature: 0.4
    });

    const feedback = completion.choices[0].message.content;

    return res.status(200).json({ feedback });
  } catch (error) {
    console.error("Essay feedback error:", error);
    return res.status(500).json({
      error: "AI feedback failed"
    });
  }
}
