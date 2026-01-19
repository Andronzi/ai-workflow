export interface ReasoningLog {
  step: string;
  details?: unknown;
}

export class AgentLogger {
  private reasoning: ReasoningLog[] = [];

  constructor(private agentName: string, private traceId?: string) {}

  info(message: string, data?: any) {
    console.log(
      `[${this.agentName}]`,
      this.traceId ? `[trace:${this.traceId}]` : "",
      message,
      data ?? ""
    );
  }

  reasoningStep(step: string, details?: any) {
    this.reasoning.push({ step, details });
    this.info(`REASONING: ${step}`, details);
  }

  getReasoning() {
    return this.reasoning.map((r) => r.step);
  }
}
