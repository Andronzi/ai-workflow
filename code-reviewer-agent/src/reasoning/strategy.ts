// strategy.ts
import { z } from "zod";
import {
  callLLMWithRetry,
  logLLMRequest,
} from "../common/llm/llm-client.js";
import type { CodeReviewContext } from "../common/mcp/mcp.types.js";
import { AgentReasoningStrategy } from "../common/reasoning/types.js";
import { confidenceGauge, findingsTotal } from "../metrics/metrics.js";

const MAX_HYPOTHESES_PER_AREA = 4;
const MAX_TOTAL_CHECKS = 12;

export const CodeReviewStrategy: AgentReasoningStrategy = {
  async decompose(state: any) {
    const diff = state.context.diff;
    const context: CodeReviewContext = state.context.context || {};

    const Schema = z.object({
      files: z.array(z.string()),
      domain: z.string(),
      riskLevel: z.enum(["low", "medium", "high"]),
      areas: z.array(z.string()),
    });

    const system = `
You are a senior code reviewer analyzing code changes.

CRITICAL: You MUST return ONLY a JSON object with this EXACT structure:
{
  "files": string[],
  "domain": string,
  "riskLevel": "low" | "medium" | "high",
  "areas": string[]
}

DO NOT add any other fields.
DO NOT include any text before or after the JSON.
DO NOT wrap the JSON in markdown.
`.trim();

    const user = `
Analyze this code diff and return the JSON with all fields filled.

Consider these universal code review aspects and select 4–6 most relevant:
- security (vulnerabilities, injections, leaks)
- error handling & robustness
- performance (optimization, unnecessary computations)
- code style & readability (naming, formatting, magic strings)
- architecture & separation of concerns
- maintainability (DRY, complexity, duplication)
- type safety
- best practices
- input validation
- logging & debugging

Code diff:
${diff}

Pull Request title: ${context.pullRequest?.title ?? "N/A"}

Example responses:
{
  "files": ["UserDashboard.tsx"],
  "domain": "frontend",
  "riskLevel": "medium",
  "areas": ["code style & readability", "architecture & separation of concerns", "maintainability", "error handling & robustness", "type safety"]
}

{
  "files": ["auth.service.ts"],
  "domain": "backend",
  "riskLevel": "high",
  "areas": ["security", "error handling & robustness", "architecture & separation of concerns", "input validation"]
}
`.trim();

    logLLMRequest(system, user);

    const result = await callLLMWithRetry(system, user, Schema, 400);

    state.knowledge.files = result.files;
    state.knowledge.domain = result.domain;
    state.knowledge.riskLevel = result.riskLevel;
    state.knowledge.areas = result.areas;

    console.log(
      `✅ Decompose: domain=${result.domain}, risk=${
        result.riskLevel
      }, areas=${result.areas.join(", ")}`
    );
  },

  async generateHypotheses(state: any) {
    const diff = state.context.diff;

    const ExpectationsSchema = z.object({
      expectations: z.array(z.string().min(1)),
    });

    const systemExpect = `
You are an experienced software architect.
Based on the domain and code changes, infer 6–8 implicit requirements and best practices.

IMPORTANT: Return ONLY JSON: { "expectations": string[] }

Each expectation should be specific and consider the technology stack.
`.trim();

    const userExpect = `
Domain: ${state.knowledge.domain}
Risk Level: ${state.knowledge.riskLevel}

Code changes:
${diff}
`.trim();

    const expectationsResult = await callLLMWithRetry(
      systemExpect,
      userExpect,
      ExpectationsSchema,
      350
    );

    state.knowledge.expectations = expectationsResult.expectations;

    console.log(
      `🧠 Inferred ${expectationsResult.expectations.length} implicit expectations`
    );

    const HypothesesSchema = z.object({
      hypotheses: z.array(z.string().min(1)),
    });

    const hypothesesByArea: Record<string, string[]> = {};

    const areasToAnalyze =
      state.knowledge.suggestedFocus?.length > 0
        ? state.knowledge.suggestedFocus
        : state.knowledge.areas ?? [];

    for (const area of areasToAnalyze) {
      const systemHyp = `
You are an expert in "${area.toUpperCase()}".

CRITICAL INSTRUCTIONS:
1. You MUST return ONLY a JSON object
2. The JSON must have EXACTLY this structure:
   {
     "hypotheses": ["hypothesis 1", "hypothesis 2", "hypothesis 3"]
   }
3. Each hypothesis should be a short, specific potential problem
4. Return 3–5 hypotheses
5. NO additional text, NO explanations, NO markdown

Example of CORRECT response:
{
  "hypotheses": [
    "Missing validation for required environment variable",
    "Error returns stack trace to client",
    "Repeated data loading code could be extracted into function",
    "Using magic strings instead of constants",
    "Function is too large and handles multiple responsibilities"
  ]
}
`.trim();

      const userHyp = `
Domain: ${state.knowledge.domain}
Risk Level: ${state.knowledge.riskLevel}
Analysis Area: ${area}

Implicit Requirements:
${state.knowledge.expectations.join("\n")}

Code diff:
${diff}

Generate 3–5 specific potential problems in the area of "${area}".
`.trim();

      try {
        const result = await callLLMWithRetry(
          systemHyp,
          userHyp,
          HypothesesSchema,
          500
        );

        const cleaned = (result.hypotheses || [])
          .filter((h: any) => typeof h === "string" && h.trim().length > 12)
          .slice(0, MAX_HYPOTHESES_PER_AREA);

        hypothesesByArea[area] = cleaned;

        console.log(`✅ Hypotheses for "${area}": ${cleaned.length}`);
      } catch (err) {
        console.error(`Error generating hypotheses for ${area}:`, err);
        hypothesesByArea[area] = [];
      }
    }

    state.knowledge.hypotheses = hypothesesByArea;

    console.log(
      `🧠 Total hypotheses: ${Object.values(hypothesesByArea).flat().length}`
    );
  },

  async analyze(state: any) {
    const diff = state.context.diff;

    const AnalysisSchema = z.object({
      confirmed: z.boolean(),
      file: z.string().optional(),
      line: z.number().optional(),
      severity: z.enum(["low", "medium", "high"]),
      description: z.string().min(20),
      suggestion: z.string().min(10),
    });

    let totalChecks = 0;
    const allHypotheses = Object.values(
      state.knowledge.hypotheses ?? {}
    ).flat();

    // Shuffle hypotheses
    for (let i = allHypotheses.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [allHypotheses[i], allHypotheses[j]] = [
        allHypotheses[j],
        allHypotheses[i],
      ];
    }

    for (const hypothesis of allHypotheses) {
      if (totalChecks >= MAX_TOTAL_CHECKS || state.findings.length >= 10) break;
      totalChecks++;

      const system = `
You are a strict and experienced code reviewer.
You are given ONE hypothesis about a potential problem.
Check if it's confirmed in the code.

CRITICAL: Return ONLY ONE JSON object with this EXACT structure:
{
  "confirmed": boolean,
  "file": "filename" (optional, only if you know exactly),
  "line": number (optional),
  "severity": "low" | "medium" | "high",
  "description": "detailed explanation",
  "suggestion": "specific improvement suggestion"
}

RULES:
- If problem NOT confirmed → confirmed: false, severity: "low"
- If confirmed → confirmed: true with appropriate severity
- NEVER return an array
- NEVER wrap in "hypotheses" or other nesting
- NEVER add text outside JSON

Examples:
{
  "confirmed": true,
  "file": "auth.ts",
  "line": 12,
  "severity": "high",
  "description": "Environment variable used without existence check",
  "suggestion": "Add validation and throw error if missing"
}

{
  "confirmed": false,
  "severity": "low",
  "description": "Passwords are hashed before storage",
  "suggestion": "No action required"
}
`.trim();

      const user = `
Hypothesis:
"${hypothesis}"

Code diff:
${diff}

Check if this hypothesis is confirmed.
Return ONLY the JSON object.
`.trim();

      try {
        const result = await callLLMWithRetry(
          system,
          user,
          AnalysisSchema,
          700
        );

        if (result.confirmed) {
          const duplicate = state.findings.some(
            (f: any) =>
              f.hypothesis === hypothesis ||
              f.description
                .toLowerCase()
                .includes(result.description.toLowerCase().substring(0, 60))
          );

          if (!duplicate) {
            state.findings.push({
              hypothesis,
              file: result.file,
              line: result.line,
              severity: result.severity,
              description: result.description,
              suggestion: result.suggestion,
              timestamp: new Date().toISOString(),
            });
            console.log(
              `🚨 [${result.severity}] ${result.description.slice(0, 100)}...`
            );
          }
        }
      } catch (err: any) {
        console.error(
          `Analysis error: ${(hypothesis as any).slice(0, 60)}...`,
          err.message
        );
      }
    }

    console.log(
      `📊 Analysis complete: ${state.findings.length} unique issues from ${totalChecks} checks`
    );
  },

  async reflect(state: any) {
    const findingsCount = state.findings.length;
    const hasCritical = state.findings.some((f: any) => f.severity === "high");
    const weakAreas = state.weakAreas || [];

    const issuesMissed =
      findingsCount < 4 && state.knowledge.riskLevel !== "low";

    let suggestedFocus: string[] = [];

    if (weakAreas.length > 0) {
      suggestedFocus = weakAreas;
    } else if (issuesMissed) {
      suggestedFocus = [
        "code style & readability",
        "architecture & separation of concerns",
        "maintainability",
        "type safety",
        "best practices",
      ];
    }

    state.knowledge.suggestedFocus = suggestedFocus;

    return {
      issuesMissed,
      reason:
        findingsCount > 0
          ? hasCritical
            ? "Found critical issues. Deepening analysis into weak areas."
            : "Found issues. Expanding analysis to style, architecture, and maintainability."
          : "Few findings with non-low risk - focusing on style and architecture.",
      suggestedFocus,
    };
  },

  async critique(state: any) {
    const Schema = z.object({
      confidence: z.number().min(0).max(1),
      weakAreas: z.array(z.string()).default([]),
    });

    const system = `
You are a strict and objective code review expert.
Evaluate the analysis quality on a scale 0.0–1.0.

Return ONLY JSON:
{
  "confidence": number,
  "weakAreas": string[]
}
`.trim();

    const uniqueAreas = new Set(
      state.findings.map((f: any) => {
        findingsTotal.inc({ severity: f.severity });

        return (
          Object.keys(state.knowledge.hypotheses || {}).find((a) =>
            f.hypothesis.toLowerCase().includes(a.toLowerCase())
          ) || "general"
        );
      })
    );

    const user = `
Evaluate this analysis:

- Issues found: ${state.findings.length}
- Critical issues: ${
      state.findings.filter((f: any) => f.severity === "high").length
    }
- Unique areas covered: ${uniqueAreas.size}
- Iteration: ${state.iteration}

Scoring guidelines:
- If analysis covers: code style, architecture, maintainability, type safety, best practices → confidence > 0.85
- If only error handling and security → confidence < 0.7
- If there's progress across iterations and diversity → increase confidence
`.trim();

    try {
      const result = await callLLMWithRetry(system, user, Schema, 300);
      state.confidence = result.confidence;
      state.weakAreas = result.weakAreas;

      console.log(
        `📊 Critique: confidence=${result.confidence.toFixed(2)}, weak areas: ${
          result.weakAreas.join(", ") || "none"
        }`
      );
      return result;
    } catch (err) {
      console.error("Critique failed → using defaults");
      state.confidence = 0.6;
      state.weakAreas = [
        "code style & readability",
        "architecture & separation of concerns",
      ];
      return { confidence: 0.6, weakAreas: state.weakAreas };
    }
  },

  shouldStop(state: any) {
    if (state.confidence === null) return false;

    confidenceGauge.set(state.confidence);

    const hasCritical = state.findings.some((f: any) => f.severity === "high");
    const riskHigh = state.knowledge.riskLevel === "high";

    if (
      state.previousConfidence &&
      state.confidence <= state.previousConfidence + 0.04
    ) {
      if (state.iteration >= 3) return true;
    }

    if ((hasCritical || riskHigh) && state.confidence < 0.88) return false;

    if (state.confidence >= 0.82) return true;

    return state.iteration >= (state.maxIterations ?? 5);
  },
};
