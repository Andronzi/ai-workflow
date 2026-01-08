import * as dotenv from "dotenv";
import Groq from "groq-sdk";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";
import { z } from "zod";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: resolve(__dirname, "../../.env") });

if (!process.env.GROQ_API_KEY) {
  console.error("❌ GROQ_API_KEY не найден в .env файле");
  process.exit(1);
}

console.log("✅ Groq API Key загружен");

const client = new Groq({
  apiKey: process.env.GROQ_API_KEY!,
});

// Функция для валидации и исправления JSON
function safeJsonParse(jsonString: string): any {
  try {
    return JSON.parse(jsonString);
  } catch (error) {
    // Попробуем исправить неполный JSON
    console.warn("⚠️ Пытаемся исправить неполный JSON...");
    
    // Удаляем лишние пробелы и переносы
    let cleaned = jsonString.trim();
    
    // Если JSON обрывается, попробуем завершить его
    if (!cleaned.endsWith('}')) {
      // Найдем последнюю закрывающую скобку
      const lastBrace = cleaned.lastIndexOf('}');
      if (lastBrace > 0) {
        cleaned = cleaned.substring(0, lastBrace + 1);
      } else {
        // Если нет закрывающей скобки, добавим
        cleaned += '}';
      }
    }
    
    // Проверим, есть ли незакрытые строки
    const quoteCount = (cleaned.match(/"/g) || []).length;
    if (quoteCount % 2 !== 0) {
      // Удаляем незакрытую строку
      const lastQuote = cleaned.lastIndexOf('"');
      if (lastQuote > cleaned.lastIndexOf('}')) {
        cleaned = cleaned.substring(0, lastQuote);
      }
    }
    
    try {
      return JSON.parse(cleaned);
    } catch (e) {
      console.error("❌ Не удалось исправить JSON:", cleaned.substring(0, 200));
      throw error;
    }
  }
}

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
      
      // Уменьшаем температуру с каждой попыткой
      const temperature = Math.max(0.05, 0.2 - (attempt * 0.05));
      
      // Улучшенный промпт с явным требованием полного JSON
      const enhancedSystem = `${system}\n\nВАЖНО: 
1. Отвечай ТОЛЬКО в формате JSON
2. JSON должен быть ПОЛНЫМ и ЗАКОНЧЕННЫМ
3. Все строки должны быть в кавычках
4. Не обрывай JSON на середине
5. Не добавляй комментарии`;

      const enhancedUser = `${user}\n\nПожалуйста, убедись что твой JSON ответ ПОЛНЫЙ и ВАЛИДНЫЙ. 
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

      const res = await client.chat.completions.create({
        model: "llama-3.3-70b-versatile",
        messages: [
          { role: "system", content: enhancedSystem },
          { role: "user", content: enhancedUser },
        ],
        temperature,
        response_format: { type: "json_object" },
        max_tokens: maxTokens,
        stream: false,
      });

      const content = res.choices[0].message.content?.trim() || '';
      
      console.log(`📝 Ответ от LLM (попытка ${attempt}):`, content.substring(0, 300));

      // Чистим markdown
      let cleanContent = content;
      const jsonMatch = cleanContent.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
      if (jsonMatch) {
        cleanContent = jsonMatch[1].trim();
      }
      
      // Валидируем, что это JSON объект
      if (!cleanContent.startsWith('{') || !cleanContent.endsWith('}')) {
        throw new SyntaxError("Ответ не является JSON объектом");
      }

      // Используем безопасный парсинг
      const parsed = safeJsonParse(cleanContent);
      
      // Валидируем по схеме
      const validated = schema.parse(parsed);
      
      console.log(`✅ Успех на попытке ${attempt}`);
      return validated;
      
    } catch (error: any) {
      console.error(`❌ Ошибка на попытке ${attempt}:`, error.message);
      
      if (attempt === maxRetries) {
        throw new Error(`Не удалось получить валидный ответ после ${maxRetries} попыток: ${error.message}`);
      }
      
      // Ждем перед следующей попыткой
      await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
    }
  }
  
  throw new Error("Не удалось выполнить запрос к LLM");
}

// Простая версия без ретраев
export async function callLLM<T>(
  system: string,
  user: string,
  schema: z.ZodSchema<T>,
  maxTokens = 800
): Promise<T> {
  return callLLMWithRetry(system, user, schema, maxTokens, 1);
}

// Утилита для логирования
export function logLLMRequest(system: string, user: string, schema: any) {
  console.log("🤖 LLM Запрос:");
  console.log("Система:", system.substring(0, 150) + "...");
  console.log("Пользователь:", user.substring(0, 150) + "...");
}