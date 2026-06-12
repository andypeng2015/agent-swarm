import { describe, expect, test } from "bun:test";
import { createClient } from "@libsql/client";
import { ANALYTICS_SQL } from "./server.ts";

/**
 * ANALYTICS_SQL extracts worker_version straight out of attempts.sandbox_json.
 * It must read BOTH persisted blob shapes (v6 spec §0.3):
 *  - v1 (legacy rows): flat `$.workerVersion`
 *  - v2 (every round-6+ attempt): `$.workers[0].version`
 * Regression: round 6 initially shipped with only the v1 key, silently nulling
 * worker-version analytics for all new attempts.
 */

const V1_BLOB = JSON.stringify({
  apiSandboxId: "api-v1",
  workerSandboxId: "w-v1",
  apiUrl: "https://api.example",
  swarmKey: "k",
  apiVersion: "agent-swarm v1.93.0",
  workerVersion: "agent-swarm v1.93.0",
});

const V2_BLOB = JSON.stringify({
  v: 2,
  apiSandboxId: "api-v2",
  apiTemplate: "agent-swarm-api-latest",
  apiUrl: "https://api.example",
  swarmKey: "k",
  domain: null,
  apiStartedAt: null,
  apiVersion: "1.94.0",
  workers: [
    { index: 0, sandboxId: "w0", template: "t", agentId: "a0", version: "1.94.0" },
    { index: 1, sandboxId: "w1", template: "t", agentId: "a1", version: "1.94.1" },
  ],
});

const V2_NULL_VERSION_BLOB = JSON.stringify({
  v: 2,
  apiSandboxId: "api-v2n",
  apiUrl: "https://api.example",
  swarmKey: "k",
  apiVersion: null,
  workers: [{ index: 0, sandboxId: "w0", template: "t", agentId: "a0", version: null }],
});

async function setupDb() {
  const db = createClient({ url: ":memory:" });
  // Minimal projections of the real schema — only the columns ANALYTICS_SQL touches.
  await db.execute(
    "CREATE TABLE eval_runs (id TEXT PRIMARY KEY, name TEXT, created_at TEXT NOT NULL)",
  );
  await db.execute(
    `CREATE TABLE attempts (
       id TEXT PRIMARY KEY, run_id TEXT NOT NULL, scenario_id TEXT NOT NULL,
       config_id TEXT NOT NULL, attempt_index INTEGER NOT NULL, status TEXT NOT NULL,
       score REAL, cost_usd REAL, cost_source TEXT, judge_cost_usd REAL,
       duration_ms INTEGER, tokens_json TEXT, sandbox_json TEXT
     )`,
  );
  await db.execute({
    sql: "INSERT INTO eval_runs (id, name, created_at) VALUES ('run-1', 'r', '2026-06-11T00:00:00Z')",
    args: [],
  });
  return db;
}

async function insertAttempt(
  db: Awaited<ReturnType<typeof setupDb>>,
  id: string,
  index: number,
  sandboxJson: string | null,
) {
  await db.execute({
    sql: `INSERT INTO attempts (id, run_id, scenario_id, config_id, attempt_index, status, sandbox_json)
          VALUES (?, 'run-1', 's1', 'c1', ?, 'passed', ?)`,
    args: [id, index, sandboxJson],
  });
}

describe("ANALYTICS_SQL worker_version extraction", () => {
  test("reads v1 flat workerVersion, v2 workers[0].version, and degrades to NULL", async () => {
    const db = await setupDb();
    await insertAttempt(db, "a-v1", 0, V1_BLOB);
    await insertAttempt(db, "a-v2", 1, V2_BLOB);
    await insertAttempt(db, "a-v2-null", 2, V2_NULL_VERSION_BLOB);
    await insertAttempt(db, "a-garbage", 3, "not-json{");
    await insertAttempt(db, "a-missing", 4, null);

    const res = await db.execute(ANALYTICS_SQL);
    const rows = res.rows;
    expect(rows).toHaveLength(5);
    // ORDER BY run created_at, attempt_index → insertion order here.
    expect(rows[0]!.worker_version).toBe("agent-swarm v1.93.0"); // v1 flat key
    expect(rows[0]!.api_version).toBe("agent-swarm v1.93.0");
    expect(rows[1]!.worker_version).toBe("1.94.0"); // v2 → worker 0 is representative
    expect(rows[1]!.api_version).toBe("1.94.0");
    expect(rows[2]!.worker_version).toBeNull(); // v2 with null capture
    expect(rows[3]!.worker_version).toBeNull(); // malformed JSON → json_valid guard
    expect(rows[4]!.worker_version).toBeNull(); // sandbox_json never written
    db.close();
  });
});
