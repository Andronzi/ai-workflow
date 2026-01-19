import { ReasoningState } from "./types.js";

export enum ReasoningStep {
  DECOMPOSE = "decompose",
  GENERATE_HYPOTHESES = "generateHypotheses",
  ANALYZE = "analyze",
  REFLECT = "reflect",
  CRITIQUE = "critique",
  STOP = "stop",
}

export interface StepStartEvent {
  step: ReasoningStep;
  state: ReasoningState;
}

export interface StepEndEvent {
  step: ReasoningStep;
  state: ReasoningState;
}

export interface ReflectionEvent {
  step: ReasoningStep.REFLECT;
  state: ReasoningState;
  result: {
    issuesMissed: boolean;
    reason: string;
    suggestedFocus?: string[];
  };
}

export interface CritiqueEvent {
  step: ReasoningStep.CRITIQUE;
  state: ReasoningState;
  result: {
    confidence: number;
    weakAreas: string[];
  };
}

export interface StopEvent {
  step: ReasoningStep.STOP;
  type: "stop" | "max_iterations_reached";
  state: ReasoningState;
}

export type ReasoningEvent =
  | StepStartEvent
  | StepEndEvent
  | ReflectionEvent
  | CritiqueEvent
  | StopEvent;
