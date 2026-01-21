import { handleAgentTask } from "./agent-core.js";

async function readStdin() {
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  return Buffer.concat(chunks).toString("utf8");
}

(async () => {
  const raw = await readStdin();
  const input = raw ? JSON.parse(raw) : {};
  const result = await handleAgentTask(input);
  process.stdout.write(JSON.stringify(result));
})();
