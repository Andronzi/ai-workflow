import * as dotenv from "dotenv";
import Groq from "groq-sdk";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";
import { z } from "zod";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: resolve(__dirname, "../../.env") });

console.log("Groq API Key:", process.env.GROQ_API_KEY ? "Loaded" : "Missing");

const client = new Groq({
  apiKey: process.env.GROQ_API_KEY!,
});

export async function callLLM<T>(
  system: string,
  user: string,
  schema: z.ZodSchema<T>,
  maxTokens = 800
): Promise<T> {
  const res = await client.chat.completions.create({
    model: "llama-3.3-70b-versatile",
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    temperature: 0.2,
    response_format: { type: "json_object" },
    max_tokens: maxTokens,
  });

  const raw = JSON.parse(res.choices[0].message.content!);
  return schema.parse(raw);
}
