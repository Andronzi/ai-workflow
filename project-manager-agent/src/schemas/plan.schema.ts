import { z } from "zod";

export const PlanSchema = z.object({
  reasoning: z.array(z.string()),
  plan: z.array(
    z.object({
      id: z.string(),
      task: z.string(),
      targetAgent: z.string()
    })
  )
});

export type PlanResult = z.infer<typeof PlanSchema>;