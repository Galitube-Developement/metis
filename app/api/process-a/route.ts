import { createOpenAI } from "@ai-sdk/openai";
import { generateObject } from "ai";
import { z } from "zod";

const requestSchema = z.object({
  topic: z.string().trim().min(2).max(300),
  languages: z.array(z.string().min(2).max(8)).min(1).max(6),
});
const resultSchema = z.object({
  results: z.array(z.object({
    german: z.string(),
    translations: z.record(z.string(), z.string()),
  })).length(200),
});

export async function POST(request: Request) {
  try {
    const input = requestSchema.parse(await request.json());
    const apiKey = process.env.OPENAI_API_KEY || process.env.AI_GATEWAY_API_KEY;
    const modelId = process.env.OPENAI_MODEL || process.env.AI_MODEL;
    if (!apiKey || !modelId) {
      return Response.json({ error: "Process A is missing OPENAI_API_KEY and OPENAI_MODEL in the environment." }, { status: 503 });
    }

    const provider = createOpenAI({ apiKey, baseURL: process.env.OPENAI_BASE_URL });
    const { object } = await generateObject({
      model: provider(modelId),
      schema: resultSchema,
      temperature: 0.8,
      prompt: `You are a specialist for YouTube search intent. Create exactly 200 distinct, natural search queries about "${input.topic}". Write each original search query in German. It must sound like a real person typing into YouTube search: concrete questions, comparisons, how-tos, experiences, mistakes, recommendations, and current angles. No numbering, no duplicates, no hashtags, and no invented facts. Then translate each query into these target languages: ${input.languages.join(", ")}. In translations, use each language's exact language code as the key. If German is selected, the German version is the translation under "de".`,
    });
    return Response.json(object);
  } catch (error) {
    if (error instanceof z.ZodError) return Response.json({ error: "Provide a topic and at least one target language." }, { status: 400 });
    console.error("Process A failed", error);
    return Response.json({ error: "Generation failed. Check the model and API access." }, { status: 500 });
  }
}
