import { fileContains } from "../src/judge/deterministic.ts";
import type { DeterministicCheck, Scenario } from "../src/types.ts";

/**
 * Proves the F1 `seed.sqlDump` plumbing end-to-end, independent of the agent:
 * the fixture is imported into the API sandbox DB before the server first
 * boots, so the seeded historical task must be visible via the swarm API even
 * if the agent flubs its task.
 */
const seededTaskVisible: DeterministicCheck = {
  name: "seeded-task-visible",
  fn: async (ctx) => {
    const res = (await ctx.apiGet("/api/tasks?fields=full")) as {
      tasks?: { task?: unknown; taskPreview?: unknown; status?: unknown }[];
    };
    const tasks = Array.isArray(res) ? res : (res?.tasks ?? []);
    const hit = tasks.find((t) => /flux capacitor/i.test(String(t.task ?? t.taskPreview ?? "")));
    return hit
      ? { pass: true, detail: `seeded task visible (status ${String(hit.status)})` }
      : {
          pass: false,
          detail: `no task matching /flux capacitor/i among ${tasks.length} task(s) — SQL import likely failed`,
        };
  },
};

/**
 * SQL-dump seeding scenario (v6 §1.5): the API sandbox DB is seeded from
 * `scenarios/fixtures/seeded-history.sql` — a full `sqlite3 .dump` of a fresh
 * dev DB plus one completed historical task titled "Calibrate the flux
 * capacitor". The agent must discover that task through the swarm API and
 * write its title to a file. Graded deterministically: `seeded-task-visible`
 * proves the import itself worked; the file check proves the agent consumed
 * the seeded data.
 */
export const sqlSeededHistory: Scenario = {
  id: "sql-seeded-history",
  name: "SQL-seeded history",
  description: [
    "Boots a stack whose API DB is pre-seeded from a SQL dump fixture containing one completed",
    "historical task ('Calibrate the flux capacitor'). The agent queries the swarm API, finds",
    "that task, and writes its exact title to /workspace/seeded-task.txt. Deterministic-only:",
    "one check proves the import worked (API-level), one proves the agent consumed seeded data.",
  ].join(" "),
  seed: { sqlDump: "seeded-history.sql" },
  tasks: [
    {
      title: "Find the seeded historical task",
      description: [
        "Query the swarm API at `$MCP_BASE_URL/api/tasks` (your `API_KEY` env var is the bearer",
        "token) and find the completed task about a flux capacitor. A task's title is the first",
        "line of its task text. Write its exact title to `/workspace/seeded-task.txt`, then",
        "report completion via store-progress.",
      ].join(" "),
    },
  ],
  outcome: {
    checks: [seededTaskVisible, fileContains("/workspace/seeded-task.txt", /flux capacitor/i)],
  },
  timeoutMs: 8 * 60_000,
};
