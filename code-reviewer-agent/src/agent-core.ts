import { selectTool } from "./common/llm/select-tool.js";
import { MCPClient } from "./common/mcp/mcp-client.js";
import { runCodeReview } from "./reasoning/run.js";

export async function handleAgentTask(input: any) {
  const mcp = new MCPClient(process.env.MCP_SERVER_URL!);

  const tools = await mcp.listTools();

  const { tool: diffTool } = await selectTool({
    tools,
    intent: {
      goal: "Get code diff for review",
      input,
    },
  });

  const diffResult = await mcp.callTool(diffTool, input);

  const review = await runCodeReview({
    diff: diffResult.diff ?? diffResult,
    context: input,
  });

  return {
    agent: "code-reviewer",
    review,
  };
}
