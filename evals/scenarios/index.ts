import type { Scenario } from "../src/types.ts";
import { buildVerifyFix } from "./build-verify-fix.ts";
import { memoryPipeline } from "./memory-pipeline.ts";
import { memorySeededRecall } from "./memory-seeded-recall.ts";
import { relayHandoff } from "./relay-handoff.ts";
import { rosterDemo } from "./roster-demo.ts";
import { sqlSeededHistory } from "./sql-seeded-history.ts";
import { twoWorkers } from "./two-workers.ts";

// v7 §5.1: the `hello-file` and `quick-reasoning` dummies are REMOVED from the
// registry. Historical runs referencing them keep rendering everywhere (run
// lists/details/analytics use stored ids, no registry lookups); the scenario
// detail route degrades to the unregistered-scenario fallback.
// `memory-seeded-recall` is the designated smoke scenario.
export const scenarios: Scenario[] = [
  sqlSeededHistory,
  memorySeededRecall,
  memoryPipeline,
  twoWorkers,
  relayHandoff,
  buildVerifyFix,
  rosterDemo,
];

export const DEFAULT_SCENARIO_IDS = ["memory-seeded-recall"];
