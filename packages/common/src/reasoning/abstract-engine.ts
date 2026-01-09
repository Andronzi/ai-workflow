// packages/common/src/reasoning/runReasoningLoop.ts

import { ReasoningStep } from "./event-types.js";
import {
  AgentReasoningStrategy,
  ReasoningState,
  RunReasoningOptions,
} from "./types.js";

type Logger = {
  debug?: (...args: any[]) => void;
  info?: (...args: any[]) => void;
  warn?: (...args: any[]) => void;
  error?: (...args: any[]) => void;
};

// Убрали stopIfConfidenceAtLeast из опций
export async function runReasoningLoop(
  strategy: AgentReasoningStrategy,
  initialContext: any,
  options: RunReasoningOptions
): Promise<ReasoningState> {
  const logger: Logger = options.logger ?? {};
  const awaitEvents = options.awaitEvents ?? false;
  const snapshotStateForEvents = options.snapshotStateForEvents ?? false;
  const stepTimeoutMs = options.stepTimeoutMs;
  const signal: AbortSignal | undefined = (options as any).signal;

  const emitRaw = options.onEvent;
  const emit = createSafeEmitter(emitRaw, {
    awaitEvents,
    snapshotStateForEvents,
    logger,
  });

  const state: ReasoningState = {
    iteration: 0,
    maxIterations: options.maxIterations ?? 3,

    context: initialContext,
    knowledge: {},
    findings: [],

    confidence: null,
    previousConfidence: null,
    weakAreas: [],
    done: false,
  };

  logInfo(logger, `Начинаем reasoning loop с максимум ${state.maxIterations} итераций`);

  try {
    while (!state.done && state.iteration < state.maxIterations) {
      throwIfAborted(signal);

      state.iteration++;

      logInfo(logger, `\nИтерация ${state.iteration}/${state.maxIterations}`);
      logDebug(logger, `Найдено проблем: ${state.findings.length}`);
      logDebug(logger, `Confidence: ${state.confidence ?? "N/A"}`);

      await runStep<void>(ReasoningStep.DECOMPOSE, strategy.decompose);
      await runStep<void>(ReasoningStep.GENERATE_HYPOTHESES, strategy.generateHypotheses);
      await runStep<void>(ReasoningStep.ANALYZE, strategy.analyze);

      const reflection = await runStep<any>(ReasoningStep.REFLECT, strategy.reflect);
      await emit?.({
        type: "reflection",
        step: ReasoningStep.REFLECT,
        state,
        result: reflection,
      });
      if (reflection && typeof reflection.reason === "string") {
        (state as any).lastReflection = reflection.reason;
      }

      const critique = await runStep<any>(ReasoningStep.CRITIQUE, strategy.critique);
      await emit?.({
        type: "critique",
        step: ReasoningStep.CRITIQUE,
        state,
        result: critique,
      });
      if (critique && typeof critique.confidence === "number") {
        if (state.confidence != null) {
          state.previousConfidence = state.confidence;
        }
        
        state.confidence = critique.confidence;
      }

      // Остановка ТОЛЬКО по стратегии
      let shouldStop = false;
      try {
        if (typeof strategy.shouldStop === "function") {
          shouldStop = !!strategy.shouldStop(state);
        }
      } catch (e) {
        logWarn(logger, "strategy.shouldStop выбросил ошибку — продолжаем", e);
        shouldStop = false;
      }

      if (shouldStop) {
        logInfo(logger, "Остановка по условию стратегии (shouldStop === true)");
        state.done = true;
        await emit?.({ type: "stop", state });
        break;
      }

      if (state.iteration >= state.maxIterations) {
        logInfo(logger, `Достигнут максимум итераций: ${state.maxIterations}`);
        state.done = true;
        await emit?.({ type: "max_iterations_reached", state });
        break;
      }
    }
  } catch (err) {
    logError(logger, "Ошибка в reasoning loop:", err);
    state.done = true;
    await emit?.({
      type: "error",
      state,
      error: serializeError(err),
    });
  }

  logInfo(
    logger,
    `\nReasoning loop завершён. Итераций: ${state.iteration}, Проблем найдено: ${state.findings.length}`
  );
  await emit?.({ type: "completed", state });

  return state;

  // ── Вспомогательные функции ─────────────────────────────────────────────

  async function runStep<T>(
    step: ReasoningStep,
    fn: ((state: ReasoningState) => Promise<T>) | undefined
  ): Promise<T> {
    if (!fn) {
      throw new Error(`Стратегия не реализует обязательный шаг: ${step}`);
    }

    const stepName = String(step);
    const startedAt = Date.now();

    await emit?.({ type: "step:start", step, state });

    try {
      throwIfAborted(signal);
      const result = await withTimeout(fn.call(strategy, state), stepTimeoutMs, stepName);

      const durationMs = Date.now() - startedAt;
      await emit?.({ type: "step:result", step, state, result, durationMs });
      await emit?.({ type: "step:end", step, state, durationMs });
      logDebug(logger, `${stepName} ok (${durationMs}ms)`);

      return result;
    } catch (err) {
      const durationMs = Date.now() - startedAt;
      const errorPayload = serializeError(err);
      await emit?.({
        type: "step:error",
        step,
        state,
        error: errorPayload,
        durationMs,
      });
      logError(logger, `Ошибка на шаге ${stepName} (${durationMs}ms):`, err);
      throw err;
    }
  }
}

// Остальные функции без изменений
function withTimeout<T>(p: Promise<T>, ms?: number, name?: string): Promise<T> {
  if (!ms || ms <= 0) return p;
  let t: any;
  const timeout = new Promise<never>((_, rej) => {
    t = setTimeout(
      () => rej(new Error(`Step "${name ?? "unknown"}" timeout after ${ms}ms`)),
      ms
    );
  });
  return Promise.race([p.finally(() => clearTimeout(t)), timeout]);
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) {
    const reason = (signal as any).reason ?? "aborted";
    throw new Error(`Aborted: ${String(reason)}`);
  }
}

function createSafeEmitter(
  raw: RunReasoningOptions["onEvent"],
  opts: { awaitEvents: boolean; snapshotStateForEvents: boolean; logger: Logger }
) {
  if (!raw) return undefined;
  return async (event: any) => {
    try {
      const e = { ...event };
      if (opts.snapshotStateForEvents && e.state) {
        e.state = safeClone(e.state);
      }
      const res = raw(e);
      if (opts.awaitEvents && res && typeof (res as Promise<any>).then === "function") {
        await res;
      }
    } catch (e) {
      logWarn(opts.logger, "onEvent обработчик выбросил ошибку, продолжаем:", e);
    }
  };
}

function safeClone<T>(obj: T): T {
  try {
    if (typeof structuredClone === "function") return structuredClone(obj);
  } catch {}
  try {
    return JSON.parse(JSON.stringify(obj));
  } catch {
    return obj;
  }
}

function serializeError(err: unknown) {
  if (err instanceof Error) {
    return { name: err.name, message: err.message, stack: err.stack };
  }
  return { message: String(err) };
}

function logDebug(logger: Logger, ...args: any[]) {
  logger.debug?.(...args);
}
function logInfo(logger: Logger, ...args: any[]) {
  (logger.info ?? console.log)(...args);
}
function logWarn(logger: Logger, ...args: any[]) {
  (logger.warn ?? console.warn)(...args);
}
function logError(logger: Logger, ...args: any[]) {
  (logger.error ?? console.error)(...args);
}