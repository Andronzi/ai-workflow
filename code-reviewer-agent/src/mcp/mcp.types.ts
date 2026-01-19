import { z } from "zod";

export const MCPMessageSchema = z.object({
  sender: z.string(),
  target: z.string(),
  payload: z.any(),
  traceId: z.string().optional(),
  timestamp: z.string().optional(),
});

export type MCPMessage = z.infer<typeof MCPMessageSchema>;
