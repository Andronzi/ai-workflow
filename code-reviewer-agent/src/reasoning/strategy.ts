import { z } from "zod";
import { callLLM } from "../../../packages/common/src/llm/llm-client.ts";
import { AgentReasoningStrategy } from "../../../packages/common/src/reasoning/types.ts";

export const CodeReviewStrategy: AgentReasoningStrategy = {
  /* ============================
     1. DECOMPOSITION
     ============================ */
  async decompose(state) {
    const DecomposeSchema = z.object({
      files: z.array(z.string()),
      areas: z.array(z.string()),
    });

    const result = await callLLM(
      `Ты senior code reviewer.
Определи, какие файлы и аспекты кода требуют анализа.`,
      state.context.diff,
      DecomposeSchema,
      400
    );

    state.knowledge.files = result.files;
    state.knowledge.areas = result.areas;
  },

  /* ============================
     2. HYPOTHESES GENERATION
     ============================ */
  async generateHypotheses(state) {
    const HypothesesSchema = z.object({
      hypotheses: z.array(z.string()),
    });

    const hypothesesByArea: Record<string, string[]> = {};

    for (const area of state.knowledge.areas ?? []) {
      const result = await callLLM(
        `Ты эксперт по ${area}.
Предположи потенциальные проблемы в коде.`,
        state.context.diff,
        HypothesesSchema,
        400
      );

      hypothesesByArea[area] = result.hypotheses;
    }

    state.knowledge.hypotheses = hypothesesByArea;
  },

  /* ============================
     3. ANALYSIS
     ============================ */
  async analyze(state) {
    const AnalysisSchema = z.object({
      confirmed: z.boolean(),
      file: z.string().optional(),
      severity: z.enum(["low", "medium", "high"]).optional(),
      description: z.string().optional(),
      suggestion: z.string().optional(),
    });

    for (const [area, hypotheses] of Object.entries(
      state.knowledge.hypotheses ?? {}
    )) {
      for (const hypothesis of hypotheses) {
        const result = await callLLM(
          `Проверь гипотезу и подтверди или опровергни её.
Если подтверждена — опиши проблему.`,
          `Гипотеза: ${hypothesis}\n\nКод:\n${state.context.diff}`,
          AnalysisSchema,
          500
        );

        if (result.confirmed) {
          state.findings.push({
            area,
            hypothesis,
            file: result.file,
            severity: result.severity,
            description: result.description,
            suggestion: result.suggestion,
          });
        }
      }
    }
  },

  /* ============================
     4. REFLECTION (ВОЗВРАТ)
     ============================ */
  async reflect(state) {
    const ReflectionSchema = z.object({
      issuesMissed: z.boolean(),
      reason: z.string(),
      missedAreas: z.array(z.string()),
    });

    const result = await callLLM(
      `Ты должен критически проверить свой code review.
Ответь честно: мог ли ты что-то упустить?`,
      JSON.stringify({
        findings: state.findings,
        analyzedAreas: state.knowledge.areas,
      }),
      ReflectionSchema,
      350
    );

    if (result.issuesMissed) {
      state.knowledge.refocus = result.missedAreas;
      state.knowledge.areas = result.missedAreas;
    }

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
    const CritiqueSchema = z.object({
      confidence: z.number().min(0).max(1),
      weakAreas: z.array(z.string()),
    });

    const result = await callLLM(
      `Оцени качество проведённого code review.`,
      JSON.stringify({
        findings: state.findings,
        iterations: state.iteration,
      }),
      CritiqueSchema,
      250
    );

    return result;
  },

  /* ============================
     6. STOP CONDITION
     ============================ */
  shouldStop(state) {
    return state.confidence !== null && state.confidence >= 0.75;
  },
};
