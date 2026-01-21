// index.ts
import bodyParser from "body-parser";
import dotenv from "dotenv";
import express, { Request, Response } from "express";
import { handleAgentTask } from "./agent-core.ts";
import { AgentLogger } from "./logger/logger.js";
import { MCPMessageSchema } from "./mcp/mcp.types.js";
import { agentRunsTotal, register } from "./metrics/metrics.js";
import { runCodeReview } from "./reasoning/run.js";

dotenv.config();

const app = express();
app.use(bodyParser.json({ limit: "10mb" }));

let tasksProcessed = 0;

app.post("/mcp", async (req, res) => {
  try {
    const result = await handleAgentTask(req.body);
    res.json({ jsonrpc: "2.0", result });
  } catch (err: any) {
    res.json({
      jsonrpc: "2.0",
      error: { message: err.message },
    });
  }
});

app.post("/mcp-http-legacy", async (req: Request, res: Response) => {
  let message;
  try {
    message = MCPMessageSchema.parse(req.body);
  } catch (err: any) {
    console.error("❌ Ошибка валидации:", err.errors);
    return res.status(400).json({
      error: "Invalid MCP message",
      details: err.errors,
    });
  }

  const logger = new AgentLogger("code-reviewer", message.traceId);

  logger.info("MCP message received", {
    sender: message.sender,
    target: message.target,
    traceId: message.traceId,
    hasDiff: !!message.payload.diff,
    hasContext: !!message.payload.context,
    contextKeys: message.payload.context
      ? Object.keys(message.payload.context)
      : [],
  });

  try {
    const startTime = Date.now();
    agentRunsTotal.inc({ agent: "code-reviewer", status: "started" });

    const result = await runCodeReview({
      diff: message.payload.diff,
      context: message.payload.context || {},
    });

    const endTime = Date.now();
    const duration = endTime - startTime;

    logger.info("Code review completed", {
      durationMs: duration,
      iterations: result.iteration || 0,
      findingsCount: result.findings?.length || 0,
      confidence: result.confidence || 0,
    });

    agentRunsTotal.inc({ agent: "code-reviewer", status: "success" });

    const response = {
      agent: "code-reviewer",
      status: "success",
      review: {
        findings: result.findings || [],
        summary: result.findings?.length
          ? `Найдено ${result.findings.length} проблем`
          : "Проблем не найдено",
        confidence: result.confidence || 0,
        iterations: result.iteration || 0,
        durationMs: duration,
      },
      traceId: message.traceId,
      timestamp: new Date().toISOString(),
    };

    console.log("✅ Отправляем ответ:", JSON.stringify(response, null, 2));
    res.json(response);
  } catch (err: any) {
    console.error("❌ Критическая ошибка:", err);
    logger.info("Error during code review", {
      error: err.message,
      stack: err.stack,
      name: err.name,
    });

    agentRunsTotal.inc({ agent: "code-reviewer", status: "error" });

    res.status(500).json({
      agent: "code-reviewer",
      status: "error",
      error: "Internal server error",
      details: err.message,
      traceId: message.traceId,
      timestamp: new Date().toISOString(),
    });
  }
});

app.get("/health", (req: Request, res: Response) => {
  res.json({
    status: "healthy",
    agent: "code-reviewer",
    uptime: process.uptime(),
    tasksProcessed,
    timestamp: new Date().toISOString(),
  });
});

app.get("/", (req: Request, res: Response) => {
  res.json({
    agent: "code-reviewer",
    version: "1.0.0",
    endpoints: {
      mcp: "POST /mcp",
      health: "GET /health",
    },
    supportedTypes: ["code-review"],
  });
});

app.get("/metrics", async (_, res) => {
  res.set("Content-Type", register.contentType);
  res.end(await register.metrics());
});

const PORT = process.env.PORT ?? 3002;
app.listen(PORT, () => {
  console.log(`
🎯 Code Reviewer Agent запущен!
📍 Порт: ${PORT}
📡 Endpoints:
   • POST /mcp    - Основной endpoint для code review
   • GET  /health - Проверка состояния
   • GET  /       - Информация об агенте
  `);
});
