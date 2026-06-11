import type { CheckResult, DeterministicCheck, JudgeContext } from "../types.ts";
import type { JudgeLiveHandle } from "./live-registry.ts";
import { finishJudgeTrace, newJudgeTrace } from "./llm.ts";

export interface CheckRunResult extends CheckResult {
  name: string;
  /** Per-check elapsed wall clock. */
  durationMs: number;
}

/**
 * Run all deterministic checks; a thrown check counts as a failure, not a
 * crash. Each check is timed and pushed into the live trace as it completes.
 */
export async function runChecks(
  checks: DeterministicCheck[],
  ctx: JudgeContext,
  live?: JudgeLiveHandle,
): Promise<CheckRunResult[]> {
  const trace = newJudgeTrace("deterministic", null);
  live?.attach(trace);
  const results: CheckRunResult[] = [];
  for (const check of checks) {
    const t0 = Date.now();
    let res: CheckResult;
    try {
      res = await check.fn(ctx);
    } catch (err) {
      res = {
        pass: false,
        detail: `check threw: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
    const durationMs = Date.now() - t0;
    results.push({ name: check.name, ...res, durationMs });
    trace.steps.push({
      index: trace.steps.length,
      kind: "check",
      text: res.detail ?? null,
      tool: check.name,
      args: null,
      output: null,
      pass: res.pass,
      startedAt: new Date(t0).toISOString(),
      durationMs,
      tokens: null,
      costUsd: null,
    });
  }
  finishJudgeTrace(trace); // costUsd/tokens stay null — no LLM involved
  return results;
}

/** Common check: every scenario task reached a terminal-success status. */
export function allTasksCompleted(): DeterministicCheck {
  return {
    name: "all-tasks-completed",
    fn: async (ctx) => {
      const bad = ctx.tasks.filter((t) => !["done", "completed"].includes(t.status));
      return bad.length === 0
        ? { pass: true }
        : {
            pass: false,
            detail: `tasks not done: ${bad.map((t) => `${t.title}=${t.status}`).join(", ")}`,
          };
    },
  };
}

/** Common check: a file exists in the sandbox and (optionally) matches a pattern. */
export function fileContains(path: string, pattern?: RegExp): DeterministicCheck {
  return {
    name: `file-contains:${path}`,
    fn: async (ctx) => {
      const content = await ctx.readFile(path);
      if (content === null) return { pass: false, detail: `${path} not found` };
      if (pattern && !pattern.test(content)) {
        return { pass: false, detail: `${path} does not match ${pattern}` };
      }
      return { pass: true, detail: `${path} (${content.length} bytes)` };
    },
  };
}
