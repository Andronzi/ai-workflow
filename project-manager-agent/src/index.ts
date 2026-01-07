import express, { Request, Response } from "express";
import bodyParser from "body-parser";
import dotenv from "dotenv";
import { buildPlan } from "./llm/planner.js";
import { PlanSchema } from "./schemas/plan.schema.js";
import { z } from "zod";

dotenv.config();

// Тип MCP-сообщения
interface MCPMessage {
  sender: string;
  target: string;
  type: string;
  payload: {
    task: string;
    context: Record<string, any>;
  };
}

const app = express();
app.use(bodyParser.json());

let tasksProcessed = 0;

app.post("/mcp", async (req: Request, res: Response) => {
  // Валидация входящего MCP сообщения через zod
  const MCPMessageSchema = z.object({
    sender: z.string(),
    target: z.string(),
    type: z.string(),
    payload: z.any()
  });

  let message: any = req.body;
  // try {
  //   message = MCPMessageSchema.parse(req.body);
  // } catch (err) {
  //   return res.status(400).json({ status: "error", error: "Invalid MCP message", details: err });
  // }

  console.log("[MCP] Incoming message:", message);

  try {
    // вызываем LLM-планировщик
    const planResult = await buildPlan({
      task: message.payload.task,
      context: message.payload.context
    });

    tasksProcessed++;

    const response = {
      agent: "project-manager",
      status: "ok",
      reasoning: planResult.reasoning,
      plan: planResult.plan,
      metrics: { tasksProcessed }
    };

    console.log("[MCP] Response:", response);
    res.json(response);
  } catch (err: any) {
    console.error("[ERROR]", err);
    res.status(500).json({ agent: "project-manager", status: "error", error: err.message });
  }
});

app.listen(3001, () => {
  console.log("Project Manager Agent (TS) running on port 3001");
});
