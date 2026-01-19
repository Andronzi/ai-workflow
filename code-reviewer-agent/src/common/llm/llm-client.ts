// llm-client.ts - полностью переписанный с учетом особенностей локальных моделей
import * as dotenv from "dotenv";
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

type LLMProvider = "openai" | "groq" | "ollama" | "lmstudio" | "local";

const LLM_PROVIDER = (process.env.LLM_PROVIDER || "ollama") as LLMProvider;
const LLM_API_KEY = process.env.LLM_API_KEY || "";

console.log(`🤖 LLM Provider: ${LLM_PROVIDER}`);

/* ------------------------------------------------------------------ */
/* CLIENTS                                                            */
/* ------------------------------------------------------------------ */

let openaiClient: OpenAI | null = null;

function getOpenAIClient(): OpenAI {
  if (openaiClient) return openaiClient;

  const baseURLs: Record<LLMProvider, string> = {
    ollama: process.env.OLLAMA_API_URL || "http://localhost:11434/v1",
    lmstudio: process.env.LMSTUDIO_API_URL || "http://localhost:1234/v1",
    local: process.env.LOCAL_API_URL || "http://localhost:8080/v1",
    openai: "https://api.openai.com/v1",
    groq: "https://api.groq.com/openai/v1",
  };

  const apiKeys: Record<LLMProvider, string> = {
    ollama: process.env.OLLAMA_API_KEY || "ollama",
    lmstudio: process.env.LMSTUDIO_API_KEY || "not-needed",
    local: process.env.LOCAL_API_KEY || "not-needed",
    openai: LLM_API_KEY,
    groq: LLM_API_KEY,
  };

  const baseURL = baseURLs[LLM_PROVIDER];
  const apiKey = apiKeys[LLM_PROVIDER];

  if (LLM_PROVIDER === "openai" || LLM_PROVIDER === "groq") {
    if (!apiKey || apiKey === "not-needed") {
      throw new Error(`API key required for ${LLM_PROVIDER}`);
    }
  }

  openaiClient = new OpenAI({
    baseURL,
    apiKey,
    defaultHeaders:
      LLM_PROVIDER === "ollama"
        ? {
            "Content-Type": "application/json",
          }
        : undefined,
  });

  return openaiClient;
}

/* ------------------------------------------------------------------ */
/* MODEL CONFIG                                                       */
/* ------------------------------------------------------------------ */

function getModelConfig() {
  const models: Record<LLMProvider, string> = {
    ollama: process.env.OLLAMA_MODEL || "llama3.2:3b",
    lmstudio: process.env.LMSTUDIO_MODEL || "local-model",
    local: process.env.LOCAL_MODEL || "llama3.2:3b",
    openai: "gpt-4o-mini",
    groq: "llama-3.3-70b-versatile",
  };

  return {
    model: models[LLM_PROVIDER],
    // Для локальных моделей уменьшаем max_tokens
    maxTokens: ["ollama", "lmstudio", "local"].includes(LLM_PROVIDER)
      ? 600
      : 800,
    // Более низкая температура для лучшего JSON
    temperature: ["ollama", "lmstudio", "local"].includes(LLM_PROVIDER)
      ? 0.1
      : 0.2,
  };
}

/* ------------------------------------------------------------------ */
/* JSON PARSING IMPROVED                                              */
/* ------------------------------------------------------------------ */

function extractJsonFromText(text: string): string | null {
  if (!text) return null;

  // Убираем все лишнее до первого {
  const startIdx = text.indexOf("{");
  if (startIdx === -1) return null;

  let braceCount = 0;
  let inString = false;
  let escapeNext = false;

  for (let i = startIdx; i < text.length; i++) {
    const char = text[i];

    if (escapeNext) {
      escapeNext = false;
      continue;
    }

    if (char === "\\") {
      escapeNext = true;
      continue;
    }

    if (char === '"' && !escapeNext) {
      inString = !inString;
      continue;
    }

    if (!inString) {
      if (char === "{") braceCount++;
      if (char === "}") {
        braceCount--;
        if (braceCount === 0) {
          return text.substring(startIdx, i + 1);
        }
      }
    }
  }

  return null;
}

function safeJsonParse(jsonString: string): any {
  try {
    return JSON.parse(jsonString);
  } catch (error) {
    console.warn("⚠️ Initial JSON parse failed, trying to extract...");

    // Пробуем извлечь JSON из текста
    const extracted = extractJsonFromText(jsonString);
    if (extracted) {
      try {
        return JSON.parse(extracted);
      } catch (e) {
        console.warn("⚠️ Extracted JSON also invalid, trying to fix...");
        // Пытаемся починить
        return fixJson(extracted);
      }
    }

    // Если не нашли JSON, пытаемся починить исходную строку
    return fixJson(jsonString);
  }
}

function fixJson(brokenJson: string): any {
  let cleaned = brokenJson.trim();

  // Убираем markdown code blocks
  cleaned = cleaned.replace(/```(?:json)?\s*/g, "").replace(/\s*```/g, "");

  // Находим первую { и последнюю }
  const firstBrace = cleaned.indexOf("{");
  const lastBrace = cleaned.lastIndexOf("}");

  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    cleaned = cleaned.substring(firstBrace, lastBrace + 1);
  }

  // Заменяем нестандартные кавычки
  cleaned = cleaned.replace(/[”“]/g, '"').replace(/[‘’]/g, "'");

  // Исправляем незакрытые строки
  const lines = cleaned.split("\n");
  const fixedLines = lines.map((line) => {
    // Считаем кавычки в строке
    const quoteCount = (line.match(/"/g) || []).length;
    if (quoteCount % 2 !== 0) {
      // Если нечетное количество кавычек, добавляем в конец
      return line + '"';
    }
    return line;
  });

  cleaned = fixedLines.join("\n");

  try {
    return JSON.parse(cleaned);
  } catch (e: any) {
    console.error("❌ Failed to fix JSON:", e.message);
    console.log("📄 Broken content:", cleaned.substring(0, 200));
    throw new Error(`JSON parsing failed: ${e.message}`);
  }
}

/* ------------------------------------------------------------------ */
/* ENHANCED PROMPT ENGINEERING                                        */
/* ------------------------------------------------------------------ */

function createStructuredPrompt(
  system: string,
  user: string,
  schema: z.ZodSchema<any>
): {
  system: string;
  user: string;
} {
  // Определяем структуру из схемы
  const schemaDescription = getSchemaDescription(schema);

  const enhancedSystem = `You are a precise AI assistant. You MUST respond with ONLY a valid JSON object.

IMPORTANT RULES:
1. Output MUST be a SINGLE JSON object
2. Do NOT include any text before or after the JSON
3. Do NOT wrap the JSON in markdown code blocks (\`\`\`json)
4. The JSON must match this structure exactly: ${schemaDescription}
5. Use only double quotes for strings
6. Ensure all brackets and braces are properly closed
7. If a field is optional and not applicable, omit it entirely
8. Do not add any comments or explanations

Example of correct response:
{"key": "value", "number": 42}

${system}`;

  const enhancedUser = `${user}

Remember: Return ONLY the JSON object. No additional text.`;

  return { system: enhancedSystem, user: enhancedUser };
}

function getSchemaDescription(schema: z.ZodSchema<any>): string {
  try {
    // Простая эвристика для получения описания схемы
    if ((schema as any)._def?.typeName === "ZodObject") {
      const shape = (schema as any)._def.shape();
      const keys = Object.keys(shape).join(", ");
      return `object with keys: ${keys}`;
    }
    if ((schema as any)._def?.typeName === "ZodArray") {
      return "array";
    }
    return "JSON object";
  } catch {
    return "JSON object";
  }
}

/* ------------------------------------------------------------------ */
/* MAIN LLM CALL FUNCTION                                             */
/* ------------------------------------------------------------------ */

export async function callLLMWithRetry<T>(
  system: string,
  user: string,
  schema: z.ZodSchema<T>,
  maxTokens?: number,
  maxRetries = 3
): Promise<T> {
  const config = getModelConfig();
  const effectiveMaxTokens = maxTokens || config.maxTokens;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`🔄 [${LLM_PROVIDER}] Attempt ${attempt}/${maxRetries}...`);

      // Динамическая температура
      const temperature = Math.max(
        0.05,
        config.temperature - (attempt - 1) * 0.05
      );

      const { system: enhancedSystem, user: enhancedUser } =
        createStructuredPrompt(system, user, schema);

      const client = getOpenAIClient();

      const response = await client.chat.completions.create({
        model: config.model,
        messages: [
          { role: "system", content: enhancedSystem },
          { role: "user", content: enhancedUser },
        ],
        temperature,
        max_tokens: effectiveMaxTokens,
        response_format: { type: "json_object" },
        stream: false,
      });

      const content = response.choices[0].message.content?.trim() || "";

      if (!content) {
        throw new Error("Empty response from model");
      }

      console.log(
        `📝 Response from ${LLM_PROVIDER}:`,
        content.substring(0, 150) + "..."
      );

      const parsed = safeJsonParse(content);
      const validated = schema.parse(parsed);

      console.log(`✅ Success on attempt ${attempt}`);
      return validated;
    } catch (error: any) {
      console.error(`❌ Error on attempt ${attempt}:`, error.message);

      if (attempt === maxRetries) {
        // На последней попытке пытаемся зафолбечить на GPT-4o-mini если есть ключ
        if (LLM_PROVIDER !== "openai" && LLM_API_KEY) {
          console.log("🔄 Falling back to OpenAI as last resort...");
          try {
            const fallbackClient = new OpenAI({
              apiKey: LLM_API_KEY,
            });

            const { system: enhancedSystem, user: enhancedUser } =
              createStructuredPrompt(system, user, schema);

            const response = await fallbackClient.chat.completions.create({
              model: "gpt-4o-mini",
              messages: [
                { role: "system", content: enhancedSystem },
                { role: "user", content: enhancedUser },
              ],
              temperature: 0.1,
              max_tokens: effectiveMaxTokens,
              response_format: { type: "json_object" },
            });

            const content = response.choices[0].message.content?.trim() || "";
            const parsed = safeJsonParse(content);
            const validated = schema.parse(parsed);

            console.log("✅ Fallback to OpenAI succeeded");
            return validated;
          } catch (fallbackError) {
            console.error("❌ Fallback also failed:", fallbackError);
          }
        }

        throw new Error(
          `Failed to get valid response after ${maxRetries} attempts: ${error.message}`
        );
      }

      // Экспоненциальная задержка
      const delay = 1000 * Math.pow(1.5, attempt - 1);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw new Error("Failed to call LLM");
}

export async function callLLM<T>(
  system: string,
  user: string,
  schema: z.ZodSchema<T>,
  maxTokens?: number
): Promise<T> {
  return callLLMWithRetry(system, user, schema, maxTokens, 1);
}

export function logLLMRequest(system: string, user: string) {
  console.log(`🤖 [${LLM_PROVIDER}] LLM Request:`);
  console.log("📋 System:", system.substring(0, 100) + "...");
  console.log("👤 User:", user.substring(0, 100) + "...");
}

export function getProviderInfo() {
  return {
    provider: LLM_PROVIDER,
    isLocal: ["ollama", "lmstudio", "local"].includes(LLM_PROVIDER),
    isCloud: ["openai", "groq"].includes(LLM_PROVIDER),
  };
}
