// run.ts
import pino from "pino";
import { runReasoningLoop } from "../../../packages/common/src/reasoning/abstract-engine.js";
import { ReasoningEvent } from "../../../packages/common/src/reasoning/event-types.ts";
import { CodeReviewStrategy } from "./strategy.ts";

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
        debug: (...a) => logger.debug(a),
        info: (...a) => logger.info(a),
        warn: (...a) => logger.warn(a),
        error: (...a) => logger.error(a),
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
