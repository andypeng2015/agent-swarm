import type { Scenario } from "../src/types.ts";
import { buildVerifyFix } from "./build-verify-fix.ts";
import { helloFile } from "./hello-file.ts";
import { memoryPipeline } from "./memory-pipeline.ts";
import { memorySeededRecall } from "./memory-seeded-recall.ts";
import { quickReasoning } from "./quick-reasoning.ts";
import { relayHandoff } from "./relay-handoff.ts";
import { sqlSeededHistory } from "./sql-seeded-history.ts";
import { twoWorkers } from "./two-workers.ts";

export const scenarios: Scenario[] = [
  helloFile,
  quickReasoning,
  sqlSeededHistory,
  memorySeededRecall,
  memoryPipeline,
  twoWorkers,
  relayHandoff,
  buildVerifyFix,
];

export const DEFAULT_SCENARIO_IDS = ["hello-file"];
