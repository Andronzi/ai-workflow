// run.ts
import { runReasoningLoop } from "../../../packages/common/src/reasoning/abstract-engine.js";
import { ReasoningEvent } from "../../../packages/common/src/reasoning/event-types.ts";
import { CodeReviewStrategy } from "./strategy.ts";

export async function runCodeReview({
  diff,
  context,
  logger,
}: {
  diff: string;
  context: any;
  logger: Function;
}) {
  return runReasoningLoop(
    CodeReviewStrategy,
    { diff, context },
    {
      maxIterations: 5,
      onEvent: (params: ReasoningEvent) => {
        logger(
          `[Reasoning][Iter ${params.state?.iteration || 0}][${params.step || "unknown"}] ${params.type || ""}`
        );
      },
    }
  );
}