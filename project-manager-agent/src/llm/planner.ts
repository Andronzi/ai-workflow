import * as dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: resolve(__dirname, '../.env') });

console.log('Groq API Key:', process.env.GROQ_API_KEY ? 'Loaded' : 'Missing');

// Меняем импорт с OpenAI на Groq
import Groq from "groq-sdk";  // <-- НОВЫЙ ИМПОРТ
import { PlanSchema, PlanResult } from "../schemas/plan.schema.js";

// Меняем клиент
const client = new Groq({
  apiKey: process.env.GROQ_API_KEY,
  // Дополнительные опции при необходимости:
  // timeout: 30000, // 30 секунд
  // maxRetries: 3,
});

export async function buildPlan(input: {
  task: string;
  context: any;
}): Promise<PlanResult> {
  const systemPrompt = `
Ты Project Manager Agent в многоагентной системе.
Твоя задача — разбить входящую задачу на подзадачи для других агентов.

Доступные агенты:
- code-reviewer
- documentation-agent
- design-assistant

Требования:
- reasoning должен быть массивом строк
- результат СТРОГО в JSON
- никаких комментариев вне JSON

ВАЖНО: Верни ТОЛЬКО валидный JSON объект, без каких-либо дополнительных текстов, приветствий или объяснений.
`;

  const userPrompt = `
Задача: ${input.task}
Контекст: ${JSON.stringify(input.context)}
`;

  const completion = await client.chat.completions.create({
    // Выберите одну из моделей Groq:
    model: "llama-3.3-70b-versatile",
    
    messages: [
      { 
        role: "system", 
        content: systemPrompt 
      },
      { 
        role: "user", 
        content: userPrompt 
      }
    ],
    response_format: { type: "json_object" },
    temperature: 0.1,  // Низкая для структурированных ответов
    max_tokens: 1024,
  });

  const raw = JSON.parse(completion.choices[0].message.content!);
  
  console.log('AI Agent answer:', '\n', JSON.stringify(raw, null, 2));

  // 🔒 валидация
  return PlanSchema.parse(raw);
}