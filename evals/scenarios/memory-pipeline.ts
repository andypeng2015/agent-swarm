import { fileContains } from "../src/judge/deterministic.ts";
import type { Scenario } from "../src/types.ts";

/**
 * Headline memory scenario (v6 §2.5): knowledge flows between tasks via swarm
 * memory. Task 1 stores a fact with its memory tools; task 2 — which never
 * sees the value in its description — must retrieve it from memory.
 *
 * Task 2 declares `dependsOn: [0]` (native swarm-API dependency, v6 §9), so
 * this scenario is also the DAG-creation-mode E2E gate: both tasks are created
 * upfront and the server holds task 2 `pending` until task 1 completes.
 *
 * Note: task 1's session summary is itself auto-indexed as a memory (source
 * `session_summary`) — either retrieval path (the explicitly stored memory or
 * the auto-indexed summary) counts as "memory works".
 *
 * Requires an embedding key in evals/.env (EMBEDDING_API_KEY or OPENAI_API_KEY).
 */
export const memoryPipeline: Scenario = {
  id: "memory-pipeline",
  name: "Memory pipeline",
  description: [
    "Two dependency-chained tasks: task 1 stores the Nightjar deploy host + port in swarm memory;",
    "task 2 (dependsOn task 1, value absent from its description) must retrieve it from memory",
    "and write host:port to /workspace/nightjar-deploy.txt. Proves cross-task knowledge flow via",
    "the memory system, graded by a file check plus an agentic judge that verifies the value came",
    "from memory retrieval rather than guessing.",
  ].join(" "),
  tasks: [
    {
      title: "Establish deploy knowledge",
      description: [
        "The production deploy host for project Nightjar is `nightjar-prod.internal`, port `8422`.",
        "Store this fact in swarm memory using your memory tools (index a memory containing the",
        "host and port) so other agents can find it later, then report completion via",
        "store-progress.",
      ].join(" "),
    },
    {
      title: "Recall deploy knowledge",
      dependsOn: [0],
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
    agenticJudge: {
      rubric: [
        "Task 1 stored the Nightjar deploy fact (host nightjar-prod.internal, port 8422) in swarm",
        "memory; task 2 retrieved it from memory and wrote exactly",
        "'nightjar-prod.internal:8422' to /workspace/nightjar-deploy.txt.",
        "Verify the file content yourself with the sandbox tools — do not trust the transcript alone.",
        "Then verify task 2's transcript shows the value came from memory retrieval (a memory",
        "search result or a memory injected into its prompt), NOT from guessing — task 2's own",
        "description does not contain the value. Either retrieval path counts: the memory task 1",
        "explicitly stored, or task 1's auto-indexed session summary.",
        "If a task record is marked skipped (failed dependency), grade the root failure and treat",
        "skipped tasks as consequences, not independent evidence.",
      ].join("\n"),
      maxSteps: 10,
    },
    passThreshold: 0.7,
  },
  timeoutMs: 12 * 60_000,
};
