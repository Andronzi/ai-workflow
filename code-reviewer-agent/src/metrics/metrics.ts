import client from "prom-client";

export const register = new client.Registry();
client.collectDefaultMetrics({ register });

// === Counters ===
export const agentRunsTotal = new client.Counter({
  name: "agent_runs_total",
  help: "Total number of agent runs",
  labelNames: ["agent", "status"],
});

export const findingsTotal = new client.Counter({
  name: "code_review_findings_total",
  help: "Total findings by severity",
  labelNames: ["severity"],
});

// === Histograms ===
export const agentDuration = new client.Histogram({
  name: "agent_duration_seconds",
  help: "Agent execution duration",
  buckets: [0.5, 1, 2, 5, 10, 20],
});

export const confidenceGauge = new client.Gauge({
  name: "code_review_confidence",
  help: "Final confidence of code review",
});

register.registerMetric(agentRunsTotal);
register.registerMetric(findingsTotal);
register.registerMetric(agentDuration);
register.registerMetric(confidenceGauge);
