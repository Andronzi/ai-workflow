// servet.ts
import bodyParser from "body-parser";
import { spawn } from "child_process";
import express from "express";
import fs from "fs";
import fetch from "node-fetch";
import path from "path";

type Tool = any;

const CONFIG =
  process.env.MCP_TOOLS_CONFIG ?? path.resolve("../config/tools.config.json");

const PORT = Number(process.env.PORT ?? 3001);

const app = express();
app.use(bodyParser.json({ limit: "10mb" }));

const tools = new Map<string, Tool>();

function loadConfig(cfgPath: string) {
  const raw = fs.readFileSync(cfgPath, "utf8");
  return JSON.parse(raw);
}

async function init() {
  const cfg = loadConfig(CONFIG);
  for (const t of cfg.tools || []) {
    tools.set(t.name, t);
  }
  console.log("Loaded tools:", Array.from(tools.keys()));
}

async function runProcessTool(tool: Tool, args: any) {
  return new Promise((resolve, reject) => {
    const cmd = tool.process?.command;
    if (!cmd) return reject(new Error("no command"));
    const proc = spawn(cmd, {
      shell: true,
      env: { ...process.env, MCP_SERVER_URL: `http://localhost:${PORT}` },
    });

    let out = "";
    let err = "";
    proc.stdin.write(JSON.stringify(args));
    proc.stdin.end();

    proc.stdout.on("data", (d) => (out += d.toString()));
    proc.stderr.on("data", (d) => (err += d.toString()));

    proc.on("close", (code) => {
      if (code !== 0) return reject(new Error(`proc exit ${code}: ${err}`));
      try {
        const parsed = JSON.parse(out);
        resolve(parsed);
      } catch (e) {
        reject(new Error("invalid json from tool: " + e));
      }
    });
  });
}

app.post("/mcp", async (req, res) => {
  const { jsonrpc, id, method, params } = req.body ?? {};
  if (jsonrpc !== "2.0") {
    return res.status(400).json({
      jsonrpc: "2.0",
      id,
      error: { code: -32600, message: "invalid jsonrpc" },
    });
  }

  try {
    if (method === "initialize") {
      return res.json({
        jsonrpc: "2.0",
        id,
        result: { server: "mcp-server", version: "0.1" },
      });
    }
    if (method === "tools/list") {
      const list = Array.from(tools.values()).map((t) => {
        const copy = { ...t };
        delete copy.process;
        return copy;
      });
      return res.json({ jsonrpc: "2.0", id, result: { tools: list } });
    }
    if (method === "tools/call") {
      const { name, arguments: args } = params ?? {};
      const tool = tools.get(name);
      if (!tool)
        return res.json({
          jsonrpc: "2.0",
          id,
          error: { code: -32602, message: "tool not found" },
        });

      if (tool.type === "http") {
        // proxy to target http tool
        const target = tool.http?.url;
        const r = await fetch(target, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: `${id}-proxy`,
            method: "call",
            params: args,
          }),
        });
        const body: any = await r.json();
        return res.json({
          jsonrpc: "2.0",
          id,
          result: body?.result ?? body,
        });
      }

      if (tool.type === "process") {
        const out = await runProcessTool(tool, args);
        return res.json({ jsonrpc: "2.0", id, result: out });
      }

      if (tool.type === "noop") {
        return res.json({ jsonrpc: "2.0", id, result: { message: "noop" } });
      }

      return res.json({
        jsonrpc: "2.0",
        id,
        error: { code: -32601, message: "unsupported tool type" },
      });
    }

    return res.json({
      jsonrpc: "2.0",
      id,
      error: { code: -32601, message: "method not found" },
    });
  } catch (err: any) {
    return res.json({
      jsonrpc: "2.0",
      id,
      error: { code: -32603, message: String(err?.message ?? err) },
    });
  }
});

init().then(() => app.listen(PORT, () => console.log("MCP server", PORT)));
