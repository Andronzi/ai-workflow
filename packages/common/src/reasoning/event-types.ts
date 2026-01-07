import { ReasoningState } from "./types.ts";

export enum ReasoningStep {
  DECOMPOSE = "decompose",
  GENERATE_HYPOTHESES = "generateHypotheses",
  ANALYZE = "analyze",
  REFLECT = "reflect",
  CRITIQUE = "critique",
}

export interface StepStartEvent {
  type: "step:start";
  step: ReasoningStep;
  state: ReasoningState;
}

export interface StepEndEvent {
  type: "step:end";
  step: ReasoningStep;
  state: ReasoningState;
}

export interface ReflectionEvent {
  type: "reflection";
  step: ReasoningStep.REFLECT;
  state: ReasoningState;
  result: {
    issuesMissed: boolean;
    reason: string;
    suggestedFocus?: string[];
  };
}

export interface CritiqueEvent {
  type: "critique";
  step: ReasoningStep.CRITIQUE;
  state: ReasoningState;
  result: {
    confidence: number;
    weakAreas: string[];
  };
}

export interface StopEvent {
  type: "stop";
  state: ReasoningState;
}

export type ReasoningEvent =
  | StepStartEvent
  | StepEndEvent
  | ReflectionEvent
  | CritiqueEvent
  | StopEvent;
