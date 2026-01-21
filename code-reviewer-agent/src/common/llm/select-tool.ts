import { callLLMWithRetry } from "./llm-client.js";

export async function selectTool({
  tools,
  intent,
}: {
  tools: any[];
  intent: {
    goal: string;
    input: any;
  };
}) {
  const system = `
You select the best tool.
Return ONLY JSON: { "tool": "<tool.name>", "reason": "<short>" }
`;

  const user = `
GOAL:
${intent.goal}

INPUT:
${JSON.stringify(intent.input, null, 2)}

TOOLS:
${tools
  .map(
    (t) =>
      `- name: ${t.name}\n  description: ${t.description}\n  tags: ${(
        t.tags || []
      ).join(", ")}`
  )
  .join("\n\n")}
`;

  const raw = await callLLMWithRetry(system, user);

  return typeof raw === "string" ? JSON.parse(raw) : raw;
}
