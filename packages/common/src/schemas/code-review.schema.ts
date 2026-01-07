import { z } from "zod";

export const CodeIssueSchema = z.object({
  file: z.string(),
  severity: z.enum(["low", "medium", "high"]),
  description: z.string(),
  suggestion: z.string(),
});

export const CodeReviewResultSchema = z.object({
  reasoning: z.array(z.string()),
  issues: z.array(CodeIssueSchema),
  overallConfidence: z.number(),
});
