import * as dotenv from "dotenv";
import Groq from "groq-sdk";
import OpenAI from "openai";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";
import { z } from "zod";

/* ------------------------------------------------------------------ */
/* ENV                                                                */
/* ------------------------------------------------------------------ */

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: resolve(__dirname, "../../.env") });

if (!process.env.LLM_API_KEY) {
  console.error("❌ LLM_API_KEY не найден в .env файле");
  process.exit(1);
}

const LLM_PROVIDER = (process.env.LLM_PROVIDER || "openai") as
  | "openai"
  | "groq";

console.log(`✅ LLM API Key загружен`);
console.log(`🤖 LLM Provider: ${LLM_PROVIDER}`);

/* ------------------------------------------------------------------ */
/* CLIENT                                                             */
/* ------------------------------------------------------------------ */

const openaiClient =
  LLM_PROVIDER === "openai"
    ? new OpenAI({ apiKey: process.env.LLM_API_KEY })
    : null;

const groqClient =
  LLM_PROVIDER === "groq"
    ? new Groq({ apiKey: process.env.LLM_API_KEY })
    : null;

async function createChatCompletion(params: {
  system: string;
  user: string;
  temperature: number;
  maxTokens: number;
}) {
  const { system, user, temperature, maxTokens } = params;

  if (LLM_PROVIDER === "groq") {
    return groqClient!.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      temperature,
      max_tokens: maxTokens,
      response_format: { type: "json_object" },
      stream: false,
    });
  }

  // OpenAI
  return openaiClient!.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    temperature,
    max_tokens: maxTokens,
    response_format: { type: "json_object" },
  });
}

/* ------------------------------------------------------------------ */
/* JSON SAFETY                                                        */
/* ------------------------------------------------------------------ */

function safeJsonParse(jsonString: string): any {
  try {
    return JSON.parse(jsonString);
  } catch (error) {
    console.warn("⚠️ Пытаемся исправить неполный JSON...");

    let cleaned = jsonString.trim();

    if (!cleaned.endsWith("}")) {
      const lastBrace = cleaned.lastIndexOf("}");
      if (lastBrace > 0) {
        cleaned = cleaned.substring(0, lastBrace + 1);
      } else {
        cleaned += "}";
      }
    }

    const quoteCount = (cleaned.match(/"/g) || []).length;
    if (quoteCount % 2 !== 0) {
      const lastQuote = cleaned.lastIndexOf('"');
      if (lastQuote > cleaned.lastIndexOf("}")) {
        cleaned = cleaned.substring(0, lastQuote);
      }
    }

    try {
      return JSON.parse(cleaned);
    } catch {
      console.error("❌ Не удалось исправить JSON:", cleaned.substring(0, 200));
      throw error;
    }
  }
}

/* ------------------------------------------------------------------ */
/* PUBLIC API                                                         */
/* ------------------------------------------------------------------ */

export async function callLLMWithRetry<T>(
  system: string,
  user: string,
  schema: z.ZodSchema<T>,
  maxTokens = 800,
  maxRetries = 3
): Promise<T> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`🔄 Попытка ${attempt}/${maxRetries}...`);

      const temperature = Math.max(0.05, 0.2 - attempt * 0.05);

      const enhancedSystem = `${system}

ВАЖНО:
1. Отвечай ТОЛЬКО в формате JSON
2. JSON должен быть ПОЛНЫМ и ЗАКОНЧЕННЫМ
3. Все строки должны быть в кавычках
4. Не обрывай JSON на середине
5. Не добавляй комментарии`;

      const enhancedUser = `${user}

Пожалуйста, убедись что твой JSON ответ ПОЛНЫЙ и ВАЛИДНЫЙ.
Пример полного JSON ответа:
{
  "confirmed": true,
  "file": "auth.ts",
  "line": 15,
  "severity": "high",
  "description": "Полное описание проблемы",
  "suggestion": "Конкретное предложение по исправлению",
  "violatesRequirement": "Store passwords in plain text"
}`;

      const res = await createChatCompletion({
        system: enhancedSystem,
        user: enhancedUser,
        temperature,
        maxTokens,
      });

      const content = res.choices[0].message.content?.trim() || "";

      console.log(
        `📝 Ответ от LLM (попытка ${attempt}):`,
        content.substring(0, 300)
      );

      let cleanContent = content;
      const jsonMatch = cleanContent.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
      if (jsonMatch) {
        cleanContent = jsonMatch[1].trim();
      }

      if (!cleanContent.startsWith("{") || !cleanContent.endsWith("}")) {
        throw new SyntaxError("Ответ не является JSON объектом");
      }

      const parsed = safeJsonParse(cleanContent);
      const validated = schema.parse(parsed);

      console.log(`✅ Успех на попытке ${attempt}`);
      return validated;
    } catch (error: any) {
      console.error(`❌ Ошибка на попытке ${attempt}:`, error.message);

      if (attempt === maxRetries) {
        throw new Error(
          `Не удалось получить валидный ответ после ${maxRetries} попыток: ${error.message}`
        );
      }

      await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
    }
  }

  throw new Error("Не удалось выполнить запрос к LLM");
}

export async function callLLM<T>(
  system: string,
  user: string,
  schema: z.ZodSchema<T>,
  maxTokens = 800
): Promise<T> {
  return callLLMWithRetry(system, user, schema, maxTokens, 1);
}

export function logLLMRequest(system: string, user: string) {
  console.log("🤖 LLM Запрос:");
  console.log("Система:", system.substring(0, 150) + "...");
  console.log("Пользователь:", user.substring(0, 150) + "...");
}
