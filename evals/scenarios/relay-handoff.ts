import { fileAbsentOnWorker, fileContainsOnWorker } from "../src/judge/deterministic.ts";
import type { Scenario } from "../src/types.ts";

/**
 * Cross-worker producer/consumer chain (v6 §13.1 S1): dependsOn × workers ×
 * runtime memory write. seed.exec plants a token file on worker 0 only; task 0
 * (worker 0) stores the token in swarm memory; task 1 (worker 1, dependsOn
 * task 0) must retrieve it from memory — the token never exists on worker 1's
 * filesystem, so the only path is through the swarm memory system.
 *
 * Deterministic-only: the file check on worker 1 proves the handoff, the
 * file-absent check on worker 0 proves it was not a same-sandbox shortcut.
 *
 * Requires an embedding key in evals/.env (EMBEDDING_API_KEY or OPENAI_API_KEY).
 */
export const relayHandoff: Scenario = {
  id: "relay-handoff",
  name: "Relay handoff",
  description: [
    "Two workers, two dependency-chained tasks: worker 0 reads a seeded token file and stores the",
    "token in swarm memory; worker 1 (dependsOn task 0) retrieves the token from memory and",
    "writes it to /workspace/relay-received.txt. Proves cross-worker knowledge handoff through",
    "swarm memory plus sandbox isolation. Deterministic-only.",
  ].join(" "),
  workers: 2,
  seed: {
    exec: [
      "printf 'relay-7f3a9c\\n' > /workspace/relay-token.txt && chmod 0644 /workspace/relay-token.txt",
    ],
  },
  tasks: [
    {
      title: "Record the relay token",
      worker: 0,
      description: [
        "Read the file /workspace/relay-token.txt — it contains a single relay token line. Store a",
        "swarm memory containing the exact token using your memory tools (index a memory) so other",
        "agents can find it later, include the token in your completion report, and report",
        "completion via store-progress.",
      ].join(" "),
    },
    {
      title: "Retrieve the relay token",
      worker: 1,
      dependsOn: [0],
      description: [
        "A previous agent recorded a relay token. Retrieve it from memory (search your memories —",
        "do not guess, do not invent a value) and write exactly the token to",
        "/workspace/relay-received.txt, then report completion via store-progress.",
      ].join(" "),
    },
  ],
  outcome: {
    checks: [
      fileContainsOnWorker(1, "/workspace/relay-received.txt", /relay-7f3a9c/),
      // isolation proof: the received file must only exist on worker 1
      fileAbsentOnWorker(0, "/workspace/relay-received.txt"),
    ],
  },
  timeoutMs: 12 * 60_000,
};
