// run.ts
import pino from "pino";
import { runReasoningLoop } from "../common/reasoning/abstract-engine.js";
import { ReasoningEvent } from "../common/reasoning/event-types.js";
import { CodeReviewStrategy } from "./strategy.js";

const logger = pino({ level: "info" });

export async function runCodeReview({
  diff,
  context,
}: {
  diff: string;
  context: any;
}) {
  const ac = new AbortController();
  const globalTimeout = setTimeout(() => ac.abort("global-timeout"), 30_000);

  const result = await runReasoningLoop(
    CodeReviewStrategy,
    { diff, context },
    {
      maxIterations: 5,
      logger: {
        debug: (...a: any[]) => logger.debug(a),
        info: (...a: any[]) => logger.info(a),
        warn: (...a: any[]) => logger.warn(a),
        error: (...a: any[]) => logger.error(a),
      },
      stepTimeoutMs: 90_000,
      snapshotStateForEvents: true,
      awaitEvents: true,
      onEvent: (params: ReasoningEvent) => {
        logger.info(
          `[Reasoning][Iter ${params.state?.iteration || 0}][${
            params.step || "unknown"
          }]`
        );
      },
    }
  ).finally(() => clearTimeout(globalTimeout));

  console.log("Final state:", {
    iteration: result.iteration,
    confidence: result.confidence,
    done: result.done,
  });

  return result;
}
