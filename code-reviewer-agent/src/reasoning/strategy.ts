// strategy.ts
import { z } from "zod";
import { callLLMWithRetry, logLLMRequest } from "../../../packages/common/src/llm/llm-client.js";
import { AgentReasoningStrategy } from "../../../packages/common/src/reasoning/types.js";
import type { CodeReviewContext } from "../../../packages/common/src/mcp/mcp.types.js";

const MAX_HYPOTHESES_PER_AREA = 5; // Максимальное количество гипотез на область
const MAX_TOTAL_CHECKS = 10; // Максимальное общее количество проверок гипотез

export const CodeReviewStrategy: AgentReasoningStrategy = {
  /* ============================
     1. DECOMPOSITION
     ============================ */
  async decompose(state) {
    const diff = state.context.diff;
    const context: CodeReviewContext = state.context.context || {};
    
    const DecomposeSchema = z.object({
      files: z.array(z.string()),
      areas: z.array(z.string()),
    });

    const system = `Ты senior code reviewer. Определи, какие файлы и аспекты кода требуют анализа.
Отвечай строго в JSON формате.`;

    const user = `Код для анализа:
${diff}

${context.repository ? `Репозиторий: ${context.repository}` : ''}
${context.pullRequest?.title ? `Pull Request: ${context.pullRequest.title}` : ''}
${context.requirements ? `Требования: ${JSON.stringify(context.requirements, null, 2)}` : ''}

Верни JSON с полями:
- files: массив строк с именами файлов
- areas: массив строк с областями анализа (например: ["security", "error handling", "performance"])

Пример ответа:
{
  "files": ["auth.ts"],
  "areas": ["security", "authentication", "input validation", "error handling"]
}`;

    logLLMRequest(system, user, DecomposeSchema);
    
    const result = await callLLMWithRetry(
      system,
      user,
      DecomposeSchema,
      400
    );

    state.knowledge.files = result.files;
    state.knowledge.areas = result.areas;
    console.log(`✅ Decompose: области ${result.areas?.join(", ") || "не определены"}`);
  },

  /* ============================
     2. HYPOTHESES GENERATION
     ============================ */
  async generateHypotheses(state) {
    const diff = state.context.diff;
    const context: CodeReviewContext = state.context.context || {};

    const HypothesesSchema = z.object({
      hypotheses: z.array(z.string()),
    });

    const hypothesesByArea: Record<string, string[]> = {};

    for (const area of state.knowledge.areas ?? []) {
      // Ограничиваем количество гипотез
      const system = `Ты эксперт по ${area}. Предположи ${MAX_HYPOTHESES_PER_AREA} наиболее важных потенциальных проблем в коде.
Отвечай строго в JSON формате.`;

      const user = `Анализируй код в контексте области "${area}":
${diff}

${context.requirements?.mustNot?.length ? 
  `Важно избегать: ${context.requirements.mustNot.join(", ")}` : ''}
${context.files?.['auth.ts']?.securityLevel === 'high' ? 
  `Уровень безопасности файла auth.ts: высокий. Обрати особое внимание на проблемы безопасности.` : ''}

Верни JSON с массивом СТРОК в поле "hypotheses". 
Верни ТОЛЬКО ${MAX_HYPOTHESES_PER_AREA} самых важных гипотез.

Пример правильного ответа:
{
  "hypotheses": [
    "Хардкодированный JWT секрет вместо использования переменных окружения",
    "Отсутствие валидации email и password перед использованием"
  ]
}`;
      
      logLLMRequest(system, user, HypothesesSchema);

      const result = await callLLMWithRetry(
        system,
        user,
        HypothesesSchema,
        400
      );

      // Ограничиваем количество гипотез
      hypothesesByArea[area] = result.hypotheses.slice(0, MAX_HYPOTHESES_PER_AREA);
      console.log(`✅ Гипотезы для области "${area}": ${hypothesesByArea[area].length} штук`);
    }

    state.knowledge.hypotheses = hypothesesByArea;
  },

  /* ============================
     3. ANALYSIS
     ============================ */
  async analyze(state) {
    const diff = state.context.diff;
    const context: CodeReviewContext = state.context.context || {};

    const AnalysisSchema = z.object({
      confirmed: z.boolean(),
      file: z.string().optional(),
      line: z.number().optional(),
      severity: z.enum(["low", "medium", "high"]),
      description: z.string(),
      suggestion: z.string(),
      violatesRequirement: z.string().optional(),
    });

    let totalChecks = 0;
    
    console.log(`🔍 Начинаем анализ. Всего гипотез: ${
      Object.values(state.knowledge.hypotheses || {}).flat().length
    }`);
    
    for (const [area, hypotheses] of Object.entries(
      state.knowledge.hypotheses ?? {}
    )) {
      console.log(`🔍 Анализируем область "${area}": ${hypotheses.length} гипотез`);
      
      for (const hypothesis of hypotheses) {
        // Ограничиваем общее количество проверок
        if (totalChecks >= MAX_TOTAL_CHECKS) {
          console.log(`⚠️ Достигнут лимит проверок гипотез (${MAX_TOTAL_CHECKS})`);
          return;
        }
        
        totalChecks++;

        // Принудительно останавливаемся, если нашли 5+ проблем
        if (state.findings.length >= 5) {
          console.log(`✅ Найдено ${state.findings.length} проблем, останавливаем анализ`);
          return;
        }

        console.log(`🔍 Проверка гипотезы ${totalChecks}/${MAX_TOTAL_CHECKS}: "${hypothesis.substring(0, 50)}..."`);

        const system = `Ты code reviewer. Проверь гипотезу и верни результат в JSON формате.`;

        const user = `Проверь гипотезу: "${hypothesis}"

Код для проверки:
${diff}

${context.files ? `Файлы в контексте: ${Object.keys(context.files).join(", ")}` : ''}
${context.requirements?.must ? `Требования: ${context.requirements.must.join(", ")}` : ''}

Верни JSON с полями:
- confirmed (boolean: true если проблема существует)
- file (string, опционально: имя файла, например "auth.ts")
- line (number, опционально: примерный номер строки)
- severity ("low", "medium" или "high")
- description (string: подробное описание проблемы)
- suggestion (string: конкретное предложение по исправлению)
- violatesRequirement (string, опционально: какое требование нарушено)`;
        
        logLLMRequest(system, user, AnalysisSchema);

        try {
          const result = await callLLMWithRetry(
            system,
            user,
            AnalysisSchema,
            500
          );

          if (result.confirmed) {
            const finding: any = {
              area,
              hypothesis,
              file: result.file || "auth.ts",
              line: result.line,
              severity: result.severity,
              description: result.description,
              suggestion: result.suggestion,
              timestamp: new Date().toISOString(),
            };

            if (result.violatesRequirement) {
              finding.violatesRequirement = result.violatesRequirement;
            }

            // Добавляем метаданные из контекста если есть
            if (result.file && context.files?.[result.file]) {
              finding.metadata = {
                language: context.files[result.file].language,
                securityLevel: context.files[result.file].securityLevel,
              };
            }

            state.findings.push(finding);
            console.log(`✅ Найдена проблема: ${result.severity} - ${result.description.substring(0, 100)}...`);
          } else {
            console.log(`❌ Гипотеза не подтверждена: "${hypothesis.substring(0, 50)}..."`);
          }
        } catch (error) {
          console.error(`❌ Ошибка при проверке гипотезы: ${error.message}`);
        }
      }
    }
    
    console.log(`📊 Анализ завершен. Проверено гипотез: ${totalChecks}, найдено проблем: ${state.findings.length}`);
  },

  /* ============================
     4. REFLECTION
     ============================ */
  async reflect(state) {
    const context: CodeReviewContext = state.context.context || {};

    // КРИТИЧЕСКОЕ ИСПРАВЛЕНИЕ: Останавливаемся после 2-й итерации
    if (state.iteration >= 2) {
      console.log(`🛑 Остановка рефлексии: достигнуто ${state.iteration} итераций (максимум 2)`);
      return {
        issuesMissed: false,
        reason: "Достигнуто максимальное число итераций для анализа",
        suggestedFocus: [],
      };
    }

    // Если уже найдено много проблем, останавливаемся
    if (state.findings.length >= 5) {
      console.log(`✅ Остановка рефлексии: найдено ${state.findings.length} проблем (достаточно для анализа)`);
      return {
        issuesMissed: false,
        reason: "Найдено достаточно проблем для качественного анализа",
        suggestedFocus: [],
      };
    }

    const ReflectionSchema = z.object({
      issuesMissed: z.boolean(),
      reason: z.string(),
      missedAreas: z.array(z.string()),
    });

    const system = `Ты проверяешь качество code review. Отвечай строго в JSON формате.`;

    const user = `Проанализируй результаты code review:
Найдено проблем: ${state.findings.length}
Итерация анализа: ${state.iteration} из максимум 2
Области анализа: ${state.knowledge.areas?.join(", ") || "не определены"}

${context.relatedFiles?.length ? 
  `Связанные файлы: ${context.relatedFiles.join(", ")}` : ''}

Внимание: Если уже найдены основные проблемы безопасности или достигнуто достаточно итераций, верни issuesMissed: false.

Верни JSON с полями:
- issuesMissed (boolean: true если что-то важное упущено)
- reason (string: объяснение почему что-то упущено или нет)
- missedAreas (массив строк: какие КОНКРЕТНЫЕ области нужно проверить)

Пример ответа если все хорошо:
{
  "issuesMissed": false,
  "reason": "Найдены основные проблемы безопасности в коде аутентификации",
  "missedAreas": []
}`;
    
    logLLMRequest(system, user, ReflectionSchema);

    const result = await callLLMWithRetry(
      system,
      user,
      ReflectionSchema,
      350
    );

    console.log(`🔍 Рефлексия: issuesMissed=${result.issuesMissed}, reason="${result.reason}"`);

    // ВАЖНО: НЕ меняем state.knowledge.areas здесь!
    // Это предотвращает бесконечные циклы
    // Просто возвращаем результат
    return {
      issuesMissed: result.issuesMissed,
      reason: result.reason,
      suggestedFocus: result.missedAreas,
    };
  },

  /* ============================
     5. CRITIQUE
     ============================ */
  async critique(state) {
    const context: CodeReviewContext = state.context.context || {};

    const CritiqueSchema = z.object({
      confidence: z.number().min(0).max(1),
      weakAreas: z.array(z.string()),
    });

    const system = `Оцени качество проведенного code review. Отвечай строго в JSON формате.`;

    const user = `Оцени качество проведенного code review:
Найдено проблем: ${state.findings.length}
Итераций анализа: ${state.iteration}
Области анализа: ${state.knowledge.areas?.join(", ") || "не определены"}

${context.repository ? `Репозиторий: ${context.repository}` : ''}
${context.requirements ? `Требования к review были учтены: Да` : 'Требования к review: не предоставлены'}

Верни JSON с полями:
- confidence (число от 0 до 1: уверенность в качестве review, где 1 - идеально)
- weakAreas (массив строк: конкретные области где review мог быть лучше)

Пример ответа:
{
  "confidence": 0.8,
  "weakAreas": ["производительность", "тестирование edge cases"]
}

Будь реалистичен в оценке. Если найдены критические проблемы безопасности, confidence может быть высоким.`;
    
    logLLMRequest(system, user, CritiqueSchema);

    const result = await callLLMWithRetry(
      system,
      user,
      CritiqueSchema,
      250
    );

    // Сохраняем confidence в state как требует интерфейс
    state.confidence = result.confidence;
    console.log(`📊 Критика: confidence=${result.confidence}, weakAreas=${result.weakAreas.join(", ")}`);

    return result;
  },

  /* ============================
     6. STOP CONDITION
     ============================ */
  shouldStop(state) {
    // Останавливаемся если confidence >= 0.75 или достигли максимума итераций
    const shouldStop = state.confidence !== null && state.confidence >= 0.75;
    
    if (shouldStop) {
      console.log(`✅ Условие остановки выполнено: confidence=${state.confidence} >= 0.75`);
    } else if (state.confidence !== null) {
      console.log(`🔍 Условие остановки не выполнено: confidence=${state.confidence} < 0.75`);
    }
    
    return shouldStop;
  },
};