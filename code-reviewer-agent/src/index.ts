import bodyParser from "body-parser";
import dotenv from "dotenv";
import express, { Request, Response } from "express";
import { AgentLogger } from "./logger/logger.js";
import { MCPMessageSchema } from "./mcp/mcp.types.js";
import { runCodeReview } from "./reasoning/run.js";

dotenv.config();

const app = express();
app.use(bodyParser.json());

let tasksProcessed = 0;

app.post("/mcp", async (req: Request, res: Response) => {
  let message;
  try {
    message = MCPMessageSchema.parse(req.body);
  } catch (err: any) {
    return res
      .status(400)
      .json({ error: "Invalid MCP message", details: err.message });
  }

  if (message.type !== "code-review") {
    return res.status(400).json({ error: "Unsupported MCP type" });
  }

  const logger = new AgentLogger("code-reviewer", message.traceId);

  try {
    logger.info("MCP message received", message);

    const result = await runCodeReview({
      diff: message.payload.diff,
      context: message.payload.context,
      logger: console.log,
    });

    tasksProcessed++;

    res.json({
      agent: "code-reviewer",
      status: "ok",
      result,
      metrics: { tasksProcessed },
    });

    logger.info("Code review completed", {
      tasksProcessed,
      confidence: result.confidence,
    });
  } catch (err: any) {
    // logger.error("Error during code review", err);
    console.log("error", err);

    res.status(500).json({
      agent: "code-reviewer",
      status: "error",
      error: err.message,
    });
  }
});

const PORT = process.env.PORT ?? 3002;
app.listen(PORT, () => {
  console.log(`Code Reviewer Agent running on port ${PORT}`);
});
