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
    maxIterations: options.maxIterations ?? 5,

    context: initialContext,
    knowledge: {},
    findings: [],

    confidence: null,
    done: false,
  };

  while (!state.done && state.iteration < state.maxIterations) {
    state.iteration++;

    await runStep(ReasoningStep.DECOMPOSE, strategy.decompose);
    await runStep(
      ReasoningStep.GENERATE_HYPOTHESES,
      strategy.generateHypotheses
    );
    await runStep(ReasoningStep.ANALYZE, strategy.analyze);

    /* ---------- REFLECT (особый шаг) ---------- */

    emit?.({
      type: "step:start",
      step: ReasoningStep.REFLECT,
      state,
    });

    const reflection = await strategy.reflect(state);

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

    if (reflection.issuesMissed) {
      state.knowledge.refocus = reflection.suggestedFocus;
      continue; // 🔁 возврат в начало цикла
    }

    /* ---------- CRITIQUE (особый шаг) ---------- */

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

    if (strategy.shouldStop(state)) {
      state.done = true;
      emit?.({ type: "stop", state });
    }
  }

  return state;

  /* ---------- HELPER ---------- */

  async function runStep(
    step: ReasoningStep,
    fn: (state: ReasoningState) => Promise<void>
  ) {
    emit?.({ type: "step:start", step, state });
    await fn.call(strategy, state);
    emit?.({ type: "step:end", step, state });
  }
}
