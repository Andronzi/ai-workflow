import { z } from "zod";

export const CodeIssueSchema = z.object({
  file: z.string(),
  line: z.number().optional(),
  severity: z.enum(["low", "medium", "high"]),
  message: z.string(),
  suggestion: z.string().optional(),
});

export const CodeReviewSchema = z.object({
  reasoning: z.array(z.string()),
  summary: z.string(),
  issues: z.array(CodeIssueSchema),
});

export type CodeReviewResult = z.infer<typeof CodeReviewSchema>;
