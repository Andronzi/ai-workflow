// packages/common/src/reasoning/runReasoningLoop.ts
import { ReasoningStep } from "./event-types.js";
import {
  AgentReasoningStrategy,
  ReasoningState,
  RunReasoningOptions,
} from "./types.js";

export async function runReasoningLoop(
  strategy: AgentReasoningStrategy,
  initialContext: any,
  options: RunReasoningOptions = {}
): Promise<ReasoningState> {
  const emit = options.onEvent;

  const state: ReasoningState = {
    iteration: 0,
    maxIterations: options.maxIterations ?? 3, // Уменьшите до 3

    context: initialContext,
    knowledge: {},
    findings: [],

    confidence: null,
    done: false,
  };

  console.log(`🚀 Начинаем reasoning loop с максимум ${state.maxIterations} итераций`);

  while (!state.done && state.iteration < state.maxIterations) {
    state.iteration++;
    
    console.log(`\n📊 Итерация ${state.iteration}/${state.maxIterations}`);
    console.log(`Найдено проблем: ${state.findings.length}`);
    console.log(`Confidence: ${state.confidence}`);

    // 1. Декомпозиция
    console.log("1. Decompose...");
    await runStep(ReasoningStep.DECOMPOSE, strategy.decompose);
    
    // 2. Генерация гипотез
    console.log("2. Generate Hypotheses...");
    await runStep(ReasoningStep.GENERATE_HYPOTHESES, strategy.generateHypotheses);
    
    // 3. Анализ
    console.log("3. Analyze...");
    await runStep(ReasoningStep.ANALYZE, strategy.analyze);

    // 4. Рефлексия
    console.log("4. Reflect...");
    emit?.({
      type: "step:start",
      step: ReasoningStep.REFLECT,
      state,
    });

    const reflection = await strategy.reflect(state);

    // КРИТИЧЕСКОЕ ИЗМЕНЕНИЕ: НЕ МЕНЯЕМ ОБЛАСТИ ПОСЛЕ РЕФЛЕКСИИ!
    // Просто сохраняем результат, но не меняем state.knowledge.areas
    // Это предотвращает бесконечные циклы

    emit?.({
      type: "reflection",
      step: ReasoningStep.REFLECT,
      state,
      result: reflection,
    });

    emit?.({
      type: "step:end",
      step: ReasoningStep.REFLECT,
      state,
    });

    state.lastReflection = reflection.reason;

    // 5. Критика (ВСЕГДА выполняем после рефлексии)
    console.log("5. Critique...");
    emit?.({
      type: "step:start",
      step: ReasoningStep.CRITIQUE,
      state,
    });

    const critique = await strategy.critique(state);

    emit?.({
      type: "critique",
      step: ReasoningStep.CRITIQUE,
      state,
      result: critique,
    });

    emit?.({
      type: "step:end",
      step: ReasoningStep.CRITIQUE,
      state,
    });

    state.confidence = critique.confidence;

    // 6. Проверка остановки
    if (strategy.shouldStop(state)) {
      console.log(`✅ Остановка по условию: confidence=${state.confidence} >= 0.75`);
      state.done = true;
      emit?.({ type: "stop", state });
      break;
    }

    // 7. Проверка максимального числа итераций
    if (state.iteration >= state.maxIterations) {
      console.log(`🛑 Достигнут максимум итераций: ${state.maxIterations}`);
      state.done = true;
      emit?.({ type: "max_iterations_reached", state });
      break;
    }
  }

  console.log(`\n🏁 Reasoning loop завершен. Итераций: ${state.iteration}, Проблем: ${state.findings.length}`);
  
  return state;

  async function runStep(
    step: ReasoningStep,
    fn: (state: ReasoningState) => Promise<void>
  ) {
    emit?.({ type: "step:start", step, state });
    await fn.call(strategy, state);
    emit?.({ type: "step:end", step, state });
  }
}