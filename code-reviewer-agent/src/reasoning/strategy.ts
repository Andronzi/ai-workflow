// strategy.ts
import { z } from "zod";
import {
  callLLMWithRetry,
  logLLMRequest,
} from "../../../packages/common/src/llm/llm-client.js";
import type { CodeReviewContext } from "../../../packages/common/src/mcp/mcp.types.js";
import { AgentReasoningStrategy } from "../../../packages/common/src/reasoning/types.js";

const MAX_HYPOTHESES_PER_AREA = 4;
const MAX_TOTAL_CHECKS = 12;

export const CodeReviewStrategy: AgentReasoningStrategy = {
  /**
   * STEP 1: Decompose + Intent inference
   */
  async decompose(state) {
    const diff = state.context.diff;
    const context: CodeReviewContext = state.context.context || {};

    const Schema = z.object({
      files: z.array(z.string()),
      domain: z.string(),
      riskLevel: z.enum(["low", "medium", "high"]),
      areas: z.array(z.string()),
    });

    const system = `
Ты senior code reviewer.

Ты ОБЯЗАН вернуть JSON строго следующего вида:

{
  "files": string[],
  "domain": string,
  "riskLevel": "low" | "medium" | "high",
  "areas": string[]
}

НЕ добавляй других полей. НЕ добавляй комментарии.
`.trim();

    const user = `
Проанализируй diff и заполни ВСЕ поля JSON.

Рассмотри следующие универсальные аспекты code review и выбери 4–6 наиболее релевантных для данного кода:
- security (уязвимости, инъекции, утечки)
- error handling & robustness (обработка ошибок, fallback'и)
- performance (оптимизация, лишние вычисления)
- code style & readability (нейминг, форматирование, магические строки, инлайн-стили)
- architecture & separation of concerns (разделение ответственности, слишком большие функции/модули)
- maintainability (DRY, повторяющийся код, сложность поддержки)
- type safety (отсутствие типов, слабая типизация)
- best practices (современные паттерны vs устаревшие)
- input validation (валидация ввода)
- logging & debugging

Diff:
${diff}

Pull Request title:
${context.pullRequest?.title ?? "N/A"}

Примеры ответа:
{
  "files": ["UserDashboard.tsx"],
  "domain": "frontend",
  "riskLevel": "medium",
  "areas": ["code style & readability", "architecture & separation of concerns", "maintainability", "error handling & robustness", "type safety"]
}
{
  "files": ["auth.service.ts"],
  "domain": "backend",
  "riskLevel": "high",
  "areas": ["security", "error handling & robustness", "architecture & separation of concerns", "input validation"]
}
`.trim();

    logLLMRequest(system, user, Schema);

    const result = await callLLMWithRetry(system, user, Schema, 400);

    state.knowledge.files = result.files;
    state.knowledge.domain = result.domain;
    state.knowledge.riskLevel = result.riskLevel;
    state.knowledge.areas = result.areas;

    console.log(
      `✅ Decompose: domain=${result.domain}, risk=${result.riskLevel}, areas=${result.areas.join(", ")}`
    );
  },

  /**
   * STEP 2: Generate hypotheses
   */
  async generateHypotheses(state) {
    const diff = state.context.diff;

    const ExpectationsSchema = z.object({
      expectations: z.array(z.string().min(1)),
    });

    const systemExpect = `
Ты опытный software architect.
На основе домена и изменений выведи 6–8 НЕЯВНЫХ требований и лучших практик, которые должны соблюдаться в таком коде.
Будь конкретен и учитывай стек технологий.
Отвечай строго JSON: { "expectations": string[] }
`.trim();

    const userExpect = `
Домен: ${state.knowledge.domain}
Уровень риска: ${state.knowledge.riskLevel}

Изменения:
${diff}
`.trim();

    logLLMRequest(systemExpect, userExpect, ExpectationsSchema);
    const expectationsResult = await callLLMWithRetry(systemExpect, userExpect, ExpectationsSchema, 350);

    state.knowledge.expectations = expectationsResult.expectations;

    console.log(`🧠 Inferred ${expectationsResult.expectations.length} implicit expectations`);

    const HypothesesSchema = z.object({
      hypotheses: z.array(z.string().min(1)),
    });

    const hypothesesByArea: Record<string, string[]> = {};

    // Приоритет: suggestedFocus из reflect, затем areas
    const areasToAnalyze = state.knowledge.suggestedFocus?.length > 0
      ? state.knowledge.suggestedFocus
      : state.knowledge.areas ?? [];

    for (const area of areasToAnalyze) {
      const systemHyp = `
ТЫ — ЭКСПЕРТ ПО "${area.toUpperCase()}".
ТВОЯ ЗАДАЧА — ПРИДУМАТЬ ВОЗМОЖНЫЕ ПРОБЛЕМЫ В КОДЕ.

ОТВЕЧАЙ ИСКЛЮЧИТЕЛЬНО МАССИВОМ СТРОК.
ФОРМАТ ДОЛЖЕН БЫТЬ ТОЧНО ТАКИМ:
{
  "hypotheses": [
    "Короткое конкретное описание потенциальной проблемы 1",
    "Короткое конкретное описание потенциальной проблемы 2",
    "Короткое конкретное описание потенциальной проблемы 3"
  ]
}

ПРАВИЛА:
- hypotheses — ТОЛЬКО массив СТРОК
- Каждая строка — короткая, конкретная гипотеза о возможной проблеме
- НИКАКИХ объектов, confirmed, severity, file, line
- НЕ пиши текст до или после JSON
- Верни 3–5 гипотез

ПРИМЕР ПОЛНОГО ПРАВИЛЬНОГО ОТВЕТА:
{
  "hypotheses": [
    "Отсутствует проверка на наличие обязательной переменной окружения",
    "Ошибка возвращает стек трейс клиенту",
    "Повторяющийся код загрузки данных можно вынести в отдельную функцию",
    "Используются магические строки вместо констант",
    "Функция слишком большая и выполняет несколько задач"
  ]
}
`.trim();

      const userHyp = `
Домен: ${state.knowledge.domain}
Уровень риска: ${state.knowledge.riskLevel}
Область анализа: ${area}

Неявные требования и лучшие практики:
${state.knowledge.expectations.join("\n")}

Изменённый код (diff):
${diff}

Сформулируй 3–5 наиболее вероятных проблем именно в области "${area}".
Будь конкретен.
Верни ТОЛЬКО JSON с массивом строк.
`.trim();

      logLLMRequest(systemHyp, userHyp, HypothesesSchema);

      try {
        const result = await callLLMWithRetry(systemHyp, userHyp, HypothesesSchema, 500);

        const cleaned = (result.hypotheses || [])
          .filter((h: any) => typeof h === "string" && h.trim().length > 12)
          .slice(0, MAX_HYPOTHESES_PER_AREA);

        hypothesesByArea[area] = cleaned;

        console.log(`✅ Hypotheses for "${area}": ${cleaned.length}`);
      } catch (err) {
        console.error(`Ошибка генерации гипотез для ${area}:`, err);
        hypothesesByArea[area] = [];
      }
    }

    state.knowledge.hypotheses = hypothesesByArea;

    console.log(`🧠 Total hypotheses: ${Object.values(hypothesesByArea).flat().length}`);
  },

  /**
   * STEP 3: Analyze
   */
  async analyze(state) {
    const diff = state.context.diff;

    const AnalysisSchema = z.object({
      confirmed: z.boolean(),
      file: z.string().optional(),
      line: z.number().optional(),
      severity: z.enum(["low", "medium", "high"]),
      description: z.string().min(20),
      suggestion: z.string().min(10),
    });

    let totalChecks = 0;
    const allHypotheses = Object.values(state.knowledge.hypotheses ?? {}).flat();

    // Shuffle
    for (let i = allHypotheses.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [allHypotheses[i], allHypotheses[j]] = [allHypotheses[j], allHypotheses[i]];
    }

    for (const hypothesis of allHypotheses) {
      if (totalChecks >= MAX_TOTAL_CHECKS || state.findings.length >= 10) break;
      totalChecks++;

      const system = `
ТЫ — СТРОГИЙ И ОПЫТНЫЙ CODE REVIEWER.
ТЕБЕ ДАНА РОВНО ОДНА ГИПОТЕЗА О ВОЗМОЖНОЙ ПРОБЛЕМЕ.
ТЫ ДОЛЖЕН ПРОВЕРИТЬ, ПОДТВЕРЖДАЕТСЯ ЛИ ОНА В КОДЕ.

ОТВЕЧАЙ ИСКЛЮЧИТЕЛЬНО ОДНИМ JSON-ОБЪЕКТОМ СТРОГО ПО ФОРМАТУ:

{
  "confirmed": true или false,
  "file": "filename" (опционально, только если точно знаешь),
  "line": number (опционально),
  "severity": "low" | "medium" | "high",
  "description": "подробное объяснение — проблема есть или её нет",
  "suggestion": "конкретное предложение по улучшению или 'всё в порядке'"
}

ПРАВИЛА:
- Если проблема НЕ подтверждена → confirmed: false, severity: "low"
- Если подтверждена → confirmed: true и реальная severity
- НИКОГДА не возвращай массив
- НИКОГДА не оборачивай в "hypotheses"
- НИКОГДА не пиши текст вне JSON

ПРИМЕРЫ:
{
  "confirmed": true,
  "file": "auth.ts",
  "line": 12,
  "severity": "high",
  "description": "Переменная окружения используется без проверки на наличие",
  "suggestion": "Добавить проверку и выброс ошибки при отсутствии"
}
{
  "confirmed": false,
  "severity": "low",
  "description": "Пароли хэшируются перед сохранением",
  "suggestion": "Нет действий требуется"
}
`.trim();

      const user = `
Гипотеза:
"${hypothesis}"

Код (diff):
${diff}

Проверь, подтверждается ли гипотеза.
Верни ТОЛЬКО один JSON-объект.
`.trim();

      logLLMRequest(system, user, AnalysisSchema);

      try {
        const result = await callLLMWithRetry(system, user, AnalysisSchema, 700);

        if (result.confirmed) {
          const duplicate = state.findings.some((f: any) =>
            f.hypothesis === hypothesis ||
            f.description.toLowerCase().includes(result.description.toLowerCase().substring(0, 60))
          );

          if (!duplicate) {
            state.findings.push({
              hypothesis,
              file: result.file,
              line: result.line,
              severity: result.severity,
              description: result.description,
              suggestion: result.suggestion,
              timestamp: new Date().toISOString(),
            });
            console.log(`🚨 [${result.severity}] ${result.description.slice(0, 100)}...`);
          }
        }
      } catch (err: any) {
        console.error(`Ошибка анализа: ${hypothesis.slice(0, 60)}...`, err.message);
      }
    }

    console.log(`📊 Анализ завершён: ${state.findings.length} уникальных проблем из ${totalChecks} проверок`);
  },

  /**
   * STEP 4: Reflect — с эволюцией
   */
  async reflect(state) {
    const findingsCount = state.findings.length;
    const hasCritical = state.findings.some((f: any) => f.severity === "high");
    const weakAreas = state.weakAreas || [];

    const issuesMissed = findingsCount < 4 && state.knowledge.riskLevel !== "low";

    let suggestedFocus: string[] = [];

    if (weakAreas.length > 0) {
      suggestedFocus = weakAreas;
    } else if (issuesMissed) {
      suggestedFocus = [
        "code style & readability",
        "architecture & separation of concerns",
        "maintainability",
        "type safety",
        "best practices"
      ];
    }

    state.knowledge.suggestedFocus = suggestedFocus;

    return {
      issuesMissed,
      reason: findingsCount > 0
        ? hasCritical
          ? "Найдены критические проблемы. Углубимся в слабые области."
          : "Найдены проблемы. Расширим анализ на стиль, архитектуру и поддерживаемость."
        : "Мало находок при ненулевом риске — фокус на стиль и архитектуру.",
      suggestedFocus,
    };
  },

  /**
   * STEP 5: Critique
   */
  async critique(state) {
    const Schema = z.object({
      confidence: z.number().min(0).max(1),
      weakAreas: z.array(z.string()).default([]),
    });

    const system = `
Ты — строгий и объективный эксперт по code review.
Оцени качество анализа по шкале 0.0–1.0.

ОТВЕТЬ ТОЛЬКО JSON:
{
  "confidence": number,
  "weakAreas": string[]
}
`.trim();

    const uniqueAreas = new Set(
      state.findings.map((f: any) => {
        return Object.keys(state.knowledge.hypotheses || {}).find(a =>
          f.hypothesis.toLowerCase().includes(a.toLowerCase())
        ) || "general";
      })
    );

    const user = `
Оцени анализ:

- Найдено проблем: ${state.findings.length}
- Критических: ${state.findings.filter((f: any) => f.severity === "high").length}
- Покрыто уникальных областей: ${uniqueAreas.size}
- Итерация: ${state.iteration}

Если анализ охватывает:
- code style & readability
- architecture & separation of concerns
- maintainability
- type safety
- best practices
→ confidence > 0.85

Если только error handling и security → confidence < 0.7

Если есть прогресс по итерациям и разнообразие — повышай confidence.
`.trim();

    logLLMRequest(system, user, Schema);

    try {
      const result = await callLLMWithRetry(system, user, Schema, 300);
      state.confidence = result.confidence;
      state.weakAreas = result.weakAreas;

      console.log(`📊 Critique: confidence=${result.confidence.toFixed(2)}, weak: ${result.weakAreas.join(", ") || "none"}`);
      return result;
    } catch (err) {
      console.error("Critique failed → defaults");
      state.confidence = 0.6;
      state.weakAreas = ["code style & readability", "architecture & separation of concerns"];
      return { confidence: 0.6, weakAreas: state.weakAreas };
    }
  },

  /**
   * STEP 6: Stop condition с previousConfidence
   */
  shouldStop(state) {
    if (state.confidence === null) return false;

    const hasCritical = state.findings.some((f: any) => f.severity === "high");
    const riskHigh = state.knowledge.riskLevel === "high";

    if (state.previousConfidence &&
      state.confidence <= state.previousConfidence + 0.04
    ) {
      if (state.iteration >= 3) return true;
    }

    if ((hasCritical || riskHigh) && state.confidence < 0.88) return false;

    if (state.confidence >= 0.82) return true;

    return state.iteration >= (state.maxIterations ?? 5);
  },
};