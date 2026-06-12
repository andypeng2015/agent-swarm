import { fileAbsentOnWorker, fileContainsOnWorker } from "../src/judge/deterministic.ts";
import type { Scenario } from "../src/types.ts";

/**
 * Multi-worker v1 demo (v6 §3.5): one API + two homogeneous workers, one
 * marker-file task explicitly routed to each worker by index. Tasks execute
 * sequentially in v1 — this scenario proves routing + sandbox isolation +
 * per-worker artifacts/logs/versions, not concurrency. Deliberately dep-free:
 * it gates the unchanged sequential creation mode under multi-worker.
 */
export const twoWorkers: Scenario = {
  id: "two-workers",
  name: "Two workers",
  description:
    "Boots one API + two workers; routes one marker-file task to each worker and verifies both the side effects and the sandbox isolation (each file exists ONLY on its own worker).",
  workers: 2,
  tasks: [
    {
      title: "Create marker A",
      worker: 0,
      description:
        "Create /workspace/eval-worker-a.txt containing exactly one line:\n\nworker-a-ok\n\nThen report completion via store-progress.",
    },
    {
      title: "Create marker B",
      worker: 1,
      description:
        "Create /workspace/eval-worker-b.txt containing exactly one line:\n\nworker-b-ok\n\nThen report completion via store-progress.",
    },
  ],
  outcome: {
    checks: [
      fileContainsOnWorker(0, "/workspace/eval-worker-a.txt", /worker-a-ok/),
      fileContainsOnWorker(1, "/workspace/eval-worker-b.txt", /worker-b-ok/),
      // isolation proof: the cross files must NOT exist
      fileAbsentOnWorker(0, "/workspace/eval-worker-b.txt"),
      fileAbsentOnWorker(1, "/workspace/eval-worker-a.txt"),
    ],
    passThreshold: 1,
  },
  timeoutMs: 10 * 60 * 1000,
};
