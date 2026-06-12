import { fileContains } from "../src/judge/deterministic.ts";
import type { Scenario } from "../src/types.ts";

/**
 * F2 plumbing proof (v6 §2.5 variant): `seed.memories` is indexed into the
 * freshly booted stack (swarm scope, embedded server-side) BEFORE the task
 * starts; the agent must retrieve the seeded fact from memory — the value
 * appears nowhere in the task description.
 *
 * This is the F2 E2E gate: it fails fast at seed time (loud attempt error)
 * when embeddings are broken — the API sandbox needs EMBEDDING_API_KEY or
 * OPENAI_API_KEY in evals/.env.
 *
 * Designated smoke scenario (v7 §5.1): 1 worker, 1 task, deterministic-only
 * (zero judge LLM spend) — the cheapest run that still proves a real swarm
 * capability end to end.
 */
export const memorySeededRecall: Scenario = {
  id: "memory-seeded-recall",
  name: "Memory seeded recall",
  description: [
    "Seeds one swarm-scope memory (the Nightjar deploy host + port) via the memory API before",
    "the task starts, then asks the agent to retrieve that knowledge from memory and write",
    "host:port to /workspace/nightjar-deploy.txt. The value is absent from the task description,",
    "so a pass proves seeded memories are embedded and retrievable. Deterministic-only.",
    "Designated smoke scenario — cheapest meaningful end-to-end verification (run this first",
    "after harness changes).",
  ].join(" "),
  seed: {
    memories: [
      "The production deploy host for project Nightjar is nightjar-prod.internal, port 8422. This is the canonical deploy target recorded by the platform team.",
    ],
  },
  tasks: [
    {
      title: "Recall deploy knowledge",
      description: [
        "Another agent previously recorded the production deploy host and port for project",
        "Nightjar. Retrieve that knowledge from memory (search your memories; do not guess and do",
        "not invent a value) and write exactly `<host>:<port>` to `/workspace/nightjar-deploy.txt`,",
        "then report completion via store-progress.",
      ].join(" "),
    },
  ],
  outcome: {
    checks: [fileContains("/workspace/nightjar-deploy.txt", /nightjar-prod\.internal:8422/)],
  },
  timeoutMs: 8 * 60_000,
};
