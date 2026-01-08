import { z } from "zod";

export const CodeReviewContextSchema = z.object({
  repository: z.string().optional(),
  pullRequest: z.object({
    id: z.number(),
    title: z.string(),
    author: z.string(),
    url: z.string().url().optional()
  }).optional(),
  files: z.object(z.object({
    language: z.string(),
    purpose: z.string().optional(),
    securityLevel: z.enum(["low", "medium", "high"]).optional(),
    previousReviewComments: z.array(z.object({
      id: z.number(),
      comment: z.string(),
      status: z.enum(["open", "fixed", "wontfix", "pending"])
    })).optional()
  })).optional(),
  requirements: z.object({
    must: z.array(z.string()).optional(),
    should: z.array(z.string()).optional(),
    mustNot: z.array(z.string()).optional()
  }).optional(),
  relatedFiles: z.array(z.string()).optional()
});

export const MCPMessageSchema = z.object({
  sender: z.string(),
  target: z.string(),
  type: z.enum(["plan", "code-review", "documentation", "design"]),
  payload: z.object({
    diff: z.string(),
    context: CodeReviewContextSchema.optional()
  }),
  traceId: z.string().optional(),
  timestamp: z.string().optional()
});

export type MCPMessage = z.infer<typeof MCPMessageSchema>;
export type CodeReviewContext = z.infer<typeof CodeReviewContextSchema>;