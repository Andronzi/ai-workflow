import { Logger } from "openai/client.js";
import { ReasoningEvent } from "./event-types.js";

export interface ReasoningState {
  iteration: number;
  maxIterations: number;

  context: any;
  knowledge: any;
  findings: any[];

  confidence: number | null;
  previousConfidence: number | null;
  weakAreas: string[];
  lastReflection?: string;

  done: boolean;
}

export interface ReflectionResult {
  issuesMissed: boolean;
  reason: string;
  suggestedFocus?: string[];
}

export interface CritiqueResult {
  confidence: number;
  weakAreas: string[];
}

export interface AgentReasoningStrategy {
  decompose(state: ReasoningState): Promise<void>;
  generateHypotheses(state: ReasoningState): Promise<void>;
  analyze(state: ReasoningState): Promise<void>;
  reflect(state: ReasoningState): Promise<ReflectionResult>;
  critique(state: ReasoningState): Promise<CritiqueResult>;
  shouldStop(state: ReasoningState): boolean;
}

export interface RunReasoningOptions {
  maxIterations?: number;
  logger: Logger;
  stepTimeoutMs: number;
  snapshotStateForEvents?: boolean;
  awaitEvents?: boolean;
  signal?: AbortController;
  onEvent?: (params: ReasoningEvent) => void;
}
