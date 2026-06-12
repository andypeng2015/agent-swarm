import { configs } from "../configs/index.ts";
import { scenarios } from "../scenarios/index.ts";
import type { Registry } from "./runner/index.ts";
import type { HarnessConfig, Scenario } from "./types.ts";

const MAX_WORKERS = 3;
const MAX_SEED_MEMORIES = 16;
/** Bare filename, no path separators — prevents traversal out of evals/scenarios/fixtures/. */
const SQL_DUMP_NAME_RE = /^[A-Za-z0-9._-]+\.sql$/;

/**
 * Scenario shape validation (v6 §0.11 — rules FROZEN). Returns human-readable
 * violations; empty array = valid. File existence/content of `seed.sqlDump` is
 * validated later, host-side in the runner, so a missing fixture breaks one
 * attempt — not the whole registry.
 */
export function validateScenario(s: Scenario): string[] {
  const errors: string[] = [];
  if (
    s.workers !== undefined &&
    (!Number.isInteger(s.workers) || s.workers < 1 || s.workers > MAX_WORKERS)
  ) {
    errors.push(`workers must be an integer in [1, ${MAX_WORKERS}], got ${s.workers}`);
  }
  const workers = s.workers ?? 1;
  s.tasks.forEach((task, i) => {
    if (
      task.worker !== undefined &&
      (!Number.isInteger(task.worker) || task.worker < 0 || task.worker >= workers)
    ) {
      errors.push(
        `task ${i} ("${task.title}"): worker ${task.worker} out of range [0, ${workers - 1}]`,
      );
    }
    if (task.dependsOn !== undefined) {
      const seen = new Set<number>();
      for (const dep of task.dependsOn) {
        if (!Number.isInteger(dep)) {
          errors.push(`task ${i} ("${task.title}"): dependsOn entry ${dep} is not an integer`);
          continue;
        }
        // Strictly-earlier-index rule: self/forward references — and therefore
        // cycles — are impossible by construction. This rule IS the cycle check.
        if (dep < 0 || dep >= i) {
          errors.push(
            `task ${i} ("${task.title}"): dependsOn entry ${dep} must reference a strictly earlier task (0 <= d < ${i})`,
          );
        }
        if (seen.has(dep)) {
          errors.push(`task ${i} ("${task.title}"): duplicate dependsOn entry ${dep}`);
        }
        seen.add(dep);
      }
    }
  });
  if (s.seed?.sqlDump !== undefined && !SQL_DUMP_NAME_RE.test(s.seed.sqlDump)) {
    errors.push(
      `seed.sqlDump "${s.seed.sqlDump}" must be a bare filename ending in .sql (no path separators)`,
    );
  }
  if (s.seed?.memories !== undefined) {
    if (s.seed.memories.length > MAX_SEED_MEMORIES) {
      errors.push(`seed.memories has ${s.seed.memories.length} entries (max ${MAX_SEED_MEMORIES})`);
    }
    s.seed.memories.forEach((memory, i) => {
      if (typeof memory !== "string" || memory.trim().length === 0) {
        errors.push(`seed.memories[${i}] must be a non-empty string`);
      }
    });
  }
  return errors;
}

/** Fail fast at CLI/server startup: aggregate every violation across all scenarios. */
export function loadRegistry(): Registry {
  const violations: string[] = [];
  for (const scenario of scenarios) {
    for (const error of validateScenario(scenario)) {
      violations.push(`scenario "${scenario.id}": ${error}`);
    }
  }
  if (violations.length > 0) {
    throw new Error(
      `invalid scenario definitions:\n${violations.map((v) => `  - ${v}`).join("\n")}`,
    );
  }
  return {
    scenarios: new Map(scenarios.map((s) => [s.id, s])),
    configs: new Map(configs.map((c) => [c.id, c])),
  };
}

/** JSON-safe scenario shape for the API/UI (check functions become names). v2 — v6 §0.10. */
export interface SerializedScenario {
  id: string;
  name: string;
  description: string | null;
  workers: number;
  tasks: { title: string; description: string; worker: number; dependsOn: number[] }[];
  seed: { exec: string[]; sqlDump: string | null; memories: string[] } | null;
  timeoutMs: number;
  outcome: {
    checks: string[];
    llmJudge: { rubric: string; model: string | null } | null;
    agenticJudge: { rubric: string; model: string | null; maxSteps: number | null } | null;
    passThreshold: number;
  };
}

export function serializeScenario(s: Scenario): SerializedScenario {
  const hasSeed = Boolean(s.seed?.exec?.length || s.seed?.sqlDump || s.seed?.memories?.length);
  return {
    id: s.id,
    name: s.name,
    description: s.description ?? null,
    workers: s.workers ?? 1,
    tasks: s.tasks.map((t) => ({
      title: t.title,
      description: t.description,
      worker: t.worker ?? 0,
      dependsOn: t.dependsOn ?? [],
    })),
    seed: hasSeed
      ? {
          exec: s.seed?.exec ?? [],
          sqlDump: s.seed?.sqlDump ?? null,
          memories: s.seed?.memories ?? [],
        }
      : null,
    timeoutMs: s.timeoutMs ?? 10 * 60 * 1000,
    outcome: {
      checks: ["tasks-completed", ...(s.outcome.checks ?? []).map((c) => c.name)],
      llmJudge: s.outcome.llmJudge
        ? { rubric: s.outcome.llmJudge.rubric, model: s.outcome.llmJudge.model ?? null }
        : null,
      agenticJudge: s.outcome.agenticJudge
        ? {
            rubric: s.outcome.agenticJudge.rubric,
            model: s.outcome.agenticJudge.model ?? null,
            maxSteps: s.outcome.agenticJudge.maxSteps ?? null,
          }
        : null,
      passThreshold: s.outcome.passThreshold ?? 0.7,
    },
  };
}

/** JSON-safe config shape — env values stay out (they can carry credentials). */
export function serializeConfig(c: HarnessConfig) {
  return {
    id: c.id,
    label: c.label ?? null,
    provider: c.provider,
    model: c.model ?? null,
    modelTier: c.modelTier ?? null,
    envKeys: c.env ? Object.keys(c.env) : [],
  };
}
