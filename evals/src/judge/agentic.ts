import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { generateText, hasToolCall, stepCountIs, tool } from "ai";
import { z } from "zod";
import { lookupOpenrouterModel, priceUsage } from "../cost/pricing.ts";
import type { JudgeContext, JudgeStep, JudgeTrace, Scenario, SwarmTask } from "../types.ts";
import type { JudgeLiveHandle } from "./live-registry.ts";
import { finishJudgeTrace, type LlmVerdict, newJudgeTrace, usageToTokens } from "./llm.ts";

const DEFAULT_AGENTIC_MODEL = "deepseek/deepseek-v4-pro";
const DEFAULT_MAX_STEPS = 10;

/** Clone for the tool log with string fields clipped, so `raw` stays bounded. */
function clipForLog(value: Record<string, unknown>, max = 2_000): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(value)) {
    out[key] = typeof v === "string" && v.length > max ? `${v.slice(0, max)}…` : v;
  }
  return out;
}

const VerdictInput = z.object({
  score: z
    .number()
    .min(0)
    .max(1)
    .describe("Overall quality of the outcome, 0 = total failure, 1 = flawless"),
  pass: z.boolean().describe("Whether the outcome satisfies the rubric"),
  reasoning: z
    .string()
    .describe("Concise justification citing the evidence you gathered with the tools"),
});

export interface AgenticJudgeInput {
  scenario: Pick<Scenario, "name" | "description">;
  rubric: string;
  tasks: SwarmTask[];
  transcript: string;
  /** Live attempt context — the agent verifies through these tools. */
  ctx: JudgeContext;
  model?: string;
  maxSteps?: number;
  /** Live-registry handle — the trace is attached before the loop starts. */
  live?: JudgeLiveHandle;
}

/** Thrown for ANY agentic-judge failure; carries the partial trace so cost is never lost. */
export class AgenticJudgeError extends Error {
  readonly trace: JudgeTrace;

  constructor(message: string, trace: JudgeTrace, options?: ErrorOptions) {
    super(message, options);
    this.name = "AgenticJudgeError";
    this.trace = trace;
  }
}

/**
 * Agentic judge: an AI SDK tool-loop (https://ai-sdk.dev/docs/agents/overview)
 * that actively verifies the outcome inside the live sandbox/API before
 * submitting a verdict, instead of trusting the transcript alone.
 *
 * Every failure (missing API key, judge-model flake, no verdict submitted)
 * throws AgenticJudgeError carrying the partial trace — callers fall back to
 * the plain LLM judge but keep the accumulated steps/cost.
 */
export async function judgeAgentic(
  input: AgenticJudgeInput,
): Promise<LlmVerdict & { raw: string; trace: JudgeTrace }> {
  const model = input.model ?? process.env.EVAL_JUDGE_MODEL ?? DEFAULT_AGENTIC_MODEL;
  const maxSteps = input.maxSteps ?? DEFAULT_MAX_STEPS;

  // Attached before any work so the live view shows the judge as started.
  const trace = newJudgeTrace("agentic", model);
  input.live?.attach(trace);

  // Reading order: reasoning(call N) → tools(call N) → reasoning(call N+1) → …
  // Tool steps are pushed live as they complete; each onStepFinish then inserts
  // the call's reasoning step BEFORE them and renumbers.
  let callStartIndex = 0;
  let callStartTime = Date.now();

  /** Push a tool step IMMEDIATELY (live visibility), keeping insertion order. */
  function recordToolStep(
    name: string,
    args: unknown,
    output: Record<string, unknown>,
    t0: number,
  ): void {
    trace.steps.push({
      index: trace.steps.length,
      kind: "tool",
      text: null,
      tool: name,
      args,
      output: JSON.stringify(clipForLog(output)),
      pass: null,
      startedAt: new Date(t0).toISOString(),
      durationMs: Date.now() - t0,
      tokens: null,
      costUsd: null,
    });
  }

  try {
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) throw new Error("OPENROUTER_API_KEY is required for the agentic judge");
    const openrouter = createOpenRouter({ apiKey });
    // Resolved once per judge call.
    const priced = await lookupOpenrouterModel(model);

    let verdict: LlmVerdict | null = null;
    const toolLog: { tool: string; args: unknown; output: unknown }[] = [];

    const taskSummaries = input.tasks
      .map(
        (t, i) =>
          `### Task ${i + 1}: ${t.title}\nStatus: ${t.status}\nDescription: ${t.description}\nResult: ${t.result ?? "(none)"}`,
      )
      .join("\n\n");

    const { steps } = await generateText({
      model: openrouter(model),
      tools: {
        run_command: tool({
          description:
            "Run a shell command inside the worker sandbox the agent worked in (e.g. inspect /workspace). Returns exit code, stdout, stderr.",
          inputSchema: z.object({ command: z.string().describe("Shell command to run") }),
          execute: async ({ command }) => {
            const t0 = Date.now();
            const res = await input.ctx.exec(command);
            const output = {
              exitCode: res.exitCode,
              stdout: res.stdout.slice(0, 8_000),
              stderr: res.stderr.slice(0, 4_000),
            };
            toolLog.push({ tool: "run_command", args: { command }, output: clipForLog(output) });
            recordToolStep("run_command", { command }, output, t0);
            return output;
          },
        }),
        read_file: tool({
          description:
            "Read a file from the worker sandbox. Returns null when the file is missing.",
          inputSchema: z.object({ path: z.string().describe("Absolute file path") }),
          execute: async ({ path }) => {
            const t0 = Date.now();
            const content = await input.ctx.readFile(path);
            const output = {
              exists: content !== null,
              content: content?.slice(0, 16_000) ?? null,
            };
            toolLog.push({ tool: "read_file", args: { path }, output: clipForLog(output) });
            recordToolStep("read_file", { path }, output, t0);
            return output;
          },
        }),
        api_get: tool({
          description:
            "Authenticated GET against the attempt's swarm API (paths under /api/, e.g. /api/tasks/<id>/session-logs).",
          inputSchema: z.object({ path: z.string().describe("Path starting with /api/") }),
          execute: async ({ path }) => {
            const t0 = Date.now();
            let output: Record<string, unknown>;
            if (!path.startsWith("/api/") && path !== "/health") {
              output = { error: "path must start with /api/" };
            } else {
              try {
                const result = await input.ctx.apiGet(path);
                output = { result: JSON.stringify(result).slice(0, 16_000) };
              } catch (err) {
                output = { error: err instanceof Error ? err.message : String(err) };
              }
            }
            toolLog.push({ tool: "api_get", args: { path }, output: clipForLog(output) });
            recordToolStep("api_get", { path }, output, t0);
            return output;
          },
        }),
        submit_verdict: tool({
          description:
            "Submit your final verdict. Call exactly once, after you have verified the rubric with the other tools.",
          inputSchema: VerdictInput,
          execute: async (v) => {
            const t0 = Date.now();
            verdict = v;
            const output = { recorded: true };
            toolLog.push({ tool: "submit_verdict", args: v, output });
            recordToolStep("submit_verdict", v, output, t0);
            return output;
          },
        }),
      },
      stopWhen: [stepCountIs(maxSteps), hasToolCall("submit_verdict")],
      onStepFinish: (step) => {
        // Per-call latency excludes the time spent inside this call's tools.
        const toolMs = trace.steps
          .slice(callStartIndex)
          .reduce((s, st) => s + (st.kind === "tool" ? (st.durationMs ?? 0) : 0), 0);
        const textParts = [step.reasoningText, step.text].filter(
          (t): t is string => typeof t === "string" && t.trim().length > 0,
        );
        const tokens = usageToTokens(step.model?.modelId ?? model, step.usage);
        const reasoningStep: JudgeStep = {
          index: callStartIndex,
          kind: "reasoning",
          text: textParts.length > 0 ? textParts.join("\n\n") : null,
          tool: null,
          args: null,
          output: null,
          pass: null,
          startedAt: new Date(callStartTime).toISOString(),
          durationMs: Math.max(0, Date.now() - callStartTime - toolMs),
          tokens,
          costUsd: priced ? priceUsage(priced, tokens, { inputIncludesCacheRead: true }) : null,
        };
        trace.steps.splice(callStartIndex, 0, reasoningStep);
        trace.steps.forEach((s, i) => {
          s.index = i;
        });
        callStartIndex = trace.steps.length;
        callStartTime = Date.now();
      },
      prompt: `You are an agentic judge grading the outcome of an autonomous-agent evaluation scenario. You have live access to the worker sandbox and the swarm API — verify, don't trust.

## Scenario: ${input.scenario.name}
${input.scenario.description ?? ""}

## Rubric (what a successful outcome looks like)
${input.rubric}

## Final task records (authoritative orchestrator state)
${taskSummaries}

## Transcript excerpt (may be truncated mid-stream)
${input.transcript.slice(0, 30_000)}

Verify the rubric's claims with the tools (inspect files, run commands, query the API), then call submit_verdict exactly once. Harness-internal activity (memory searches, tool discovery, progress reporting) is normal — judge the outcome, not the style. Keep tool use focused: a handful of targeted verifications, not an exhaustive crawl.`,
    });

    if (!verdict) {
      throw new Error(
        `agentic judge finished ${steps.length} step(s) without submitting a verdict (tools used: ${toolLog.map((t) => t.tool).join("; ") || "none"})`,
      );
    }
    const v = verdict as LlmVerdict;
    finishJudgeTrace(trace);
    return {
      ...v,
      raw: JSON.stringify({ model, steps: steps.length, toolLog, verdict: v }),
      trace,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    trace.steps.push({
      index: trace.steps.length,
      kind: "error",
      text: message,
      tool: null,
      args: null,
      output: null,
      pass: null,
      startedAt: new Date().toISOString(),
      durationMs: null,
      tokens: null,
      costUsd: null,
    });
    trace.error = message;
    finishJudgeTrace(trace);
    throw new AgenticJudgeError(message, trace, { cause: err });
  }
}
