import { z } from "zod";

export const ReasoningStepSchema = z.object({
  stepId: z.string(),
  description: z.string(),
  inputSummary: z.string(),
  outputSummary: z.string(),
  confidence: z.number().min(0).max(1),
});

export const ReasoningSchema = z.array(ReasoningStepSchema);
export type Reasoning = z.infer<typeof ReasoningSchema>;
