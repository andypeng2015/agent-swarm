import { Database } from "bun:sqlite";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { unlink } from "node:fs/promises";
import {
  redactStepInput,
  valueLooksLikeSecret,
} from "../../scripts/backfill-redact-workflow-run-steps";
import { REDACTED_SECRET_VALUE } from "../workflows/input";

const TEST_DB_PATH = "./test-backfill-redact-workflow-run-steps.sqlite";

async function cleanupDb(): Promise<void> {
  await unlink(TEST_DB_PATH).catch(() => undefined);
  await unlink(`${TEST_DB_PATH}-shm`).catch(() => undefined);
  await unlink(`${TEST_DB_PATH}-wal`).catch(() => undefined);
}

function runScript(args: string[]): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(
    "bun",
    ["run", "scripts/backfill-redact-workflow-run-steps.ts", "--db", TEST_DB_PATH, ...args],
    { encoding: "utf8" },
  );
  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

describe("valueLooksLikeSecret", () => {
  test("matches GitHub PATs", () => {
    expect(valueLooksLikeSecret("github_pat_11ABC".padEnd(40, "X"))).toBe(true);
    expect(valueLooksLikeSecret("ghp_" + "X".repeat(30))).toBe(true);
  });
  test("matches GitLab PATs and sk-/JWT shapes", () => {
    expect(valueLooksLikeSecret("glpat-" + "X".repeat(25))).toBe(true);
    expect(valueLooksLikeSecret("sk-ant-" + "X".repeat(25))).toBe(true);
    expect(
      valueLooksLikeSecret(
        "eyJabc" + "X".repeat(15) + ".eyJdef" + "X".repeat(15) + ".sig" + "X".repeat(15),
      ),
    ).toBe(true);
  });
  test("ignores non-string and short values", () => {
    expect(valueLooksLikeSecret(42)).toBe(false);
    expect(valueLooksLikeSecret("")).toBe(false);
    expect(valueLooksLikeSecret("hello world")).toBe(false);
  });
  test("ignores already-redacted marker", () => {
    expect(valueLooksLikeSecret(REDACTED_SECRET_VALUE)).toBe(false);
  });
});

describe("redactStepInput", () => {
  test("definition-based: redacts keys flagged by workflow.input", () => {
    const ctx = {
      input: {
        TURSO_DB_TOKEN: "raw-jwt-value-here",
        TURSO_DB_URL: "https://example.turso.io",
      },
      outputs: {},
    };
    const result = redactStepInput(ctx, {
      TURSO_DB_TOKEN: "secret.TURSO_DB_TOKEN",
      TURSO_DB_URL: "https://example.turso.io",
    });
    expect(result.changed).toBe(1);
    expect(result.redactedKeys).toEqual(["TURSO_DB_TOKEN"]);
    const redacted = result.redacted as { input: Record<string, unknown> };
    expect(redacted.input.TURSO_DB_TOKEN).toBe(REDACTED_SECRET_VALUE);
    expect(redacted.input.TURSO_DB_URL).toBe("https://example.turso.io");
  });

  test("pattern-based: redacts sensitive-named keys even without workflow def", () => {
    const ctx = {
      input: {
        GITHUB_TOKEN: "github_pat_" + "X".repeat(30),
        SOME_BENIGN_FIELD: "harmless",
      },
    };
    const result = redactStepInput(ctx, undefined);
    expect(result.redactedKeys).toContain("GITHUB_TOKEN");
    expect(result.redactedKeys).not.toContain("SOME_BENIGN_FIELD");
    const redacted = result.redacted as { input: Record<string, unknown> };
    expect(redacted.input.GITHUB_TOKEN).toBe(REDACTED_SECRET_VALUE);
    expect(redacted.input.SOME_BENIGN_FIELD).toBe("harmless");
  });

  test("pattern-based: redacts JWT-shaped values on non-sensitive keys", () => {
    const jwt = "eyJ" + "a".repeat(20) + ".eyJ" + "b".repeat(20) + "." + "c".repeat(20);
    const ctx = { input: { weird_field: jwt } };
    const result = redactStepInput(ctx, undefined);
    expect(result.redactedKeys).toContain("weird_field");
  });

  test("idempotent: already-redacted values are not re-touched", () => {
    const ctx = {
      input: {
        GITHUB_TOKEN: REDACTED_SECRET_VALUE,
        TURSO_DB_URL: "https://example.turso.io",
      },
    };
    const result = redactStepInput(ctx, undefined);
    expect(result.changed).toBe(0);
    expect(result.redacted).toBe(ctx);
  });

  test("no-op when input block missing", () => {
    const ctx = { outputs: {}, trigger: {} };
    const result = redactStepInput(ctx, undefined);
    expect(result.changed).toBe(0);
    expect(result.redacted).toBe(ctx);
  });

  test("does not mutate input ctx", () => {
    const original = {
      input: { GITHUB_TOKEN: "ghp_" + "X".repeat(30) },
    };
    const beforeSerialized = JSON.stringify(original);
    redactStepInput(original, undefined);
    expect(JSON.stringify(original)).toBe(beforeSerialized);
  });
});

describe("backfill script — end-to-end against seeded DB", () => {
  beforeAll(async () => {
    await cleanupDb();
  });

  afterAll(async () => {
    await cleanupDb();
  });

  test("dry-run reports rows, commit redacts, second commit is no-op", () => {
    // Bootstrap the DB by running the script once against the empty file —
    // this triggers migrations in a subprocess (no in-memory test template) so
    // the file on disk has all tables and we can seed via a raw connection.
    const bootstrap = runScript([]);
    expect(bootstrap.status).toBe(0);
    expect(bootstrap.stdout).toContain("scanned 0 workflow_run_steps rows");

    // Seed via raw Database (bypasses bun-test's in-memory template fast path
    // — writes here actually hit the file the subprocess will read).
    const seed = new Database(TEST_DB_PATH);
    seed.run("PRAGMA foreign_keys = ON;");
    seed.run(`INSERT INTO workflows (id, name, definition, input) VALUES (?, ?, ?, ?)`, [
      "wf-1",
      "test-leaky-wf",
      JSON.stringify({ nodes: [], edges: [] }),
      JSON.stringify({
        TURSO_DB_TOKEN: "secret.TURSO_DB_TOKEN",
        TURSO_DB_URL: "https://example.turso.io",
        GITHUB_TOKEN: "${GITHUB_TOKEN}",
        IMGFLIP_USERNAME: "dummy",
      }),
    ]);
    seed.run(`INSERT INTO workflow_runs (id, workflowId, status, startedAt) VALUES (?, ?, ?, ?)`, [
      "run-1",
      "wf-1",
      "completed",
      new Date().toISOString(),
    ]);

    const leakyCtxA = {
      input: {
        TURSO_DB_TOKEN: "real-jwt-here-12345",
        TURSO_DB_URL: "https://example.turso.io",
        GITHUB_TOKEN: "github_pat_" + "X".repeat(40),
        IMGFLIP_USERNAME: "dummy",
      },
      outputs: { someNode: { ok: true } },
    };
    seed.run(
      `INSERT INTO workflow_run_steps (id, runId, nodeId, nodeType, status, startedAt, input) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        "step-A",
        "run-1",
        "context-builder",
        "script",
        "completed",
        new Date().toISOString(),
        JSON.stringify(leakyCtxA),
      ],
    );

    // step B: same workflow, but contains a sensitive key not in current def
    // → pattern-based fallback handles it.
    const leakyCtxB = {
      input: {
        TURSO_DB_URL: "https://example.turso.io",
        AGENT_FS_API_KEY: "raw-fs-key-here-and-very-long-string",
        OLD_LEGACY_TOKEN: "ghp_" + "Y".repeat(35),
      },
    };
    seed.run(
      `INSERT INTO workflow_run_steps (id, runId, nodeId, nodeType, status, startedAt, input) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        "step-B",
        "run-1",
        "downstream",
        "script",
        "completed",
        new Date().toISOString(),
        JSON.stringify(leakyCtxB),
      ],
    );

    // step C: already redacted (idempotency)
    const redactedCtxC = {
      input: {
        TURSO_DB_TOKEN: REDACTED_SECRET_VALUE,
        TURSO_DB_URL: "https://example.turso.io",
      },
    };
    seed.run(
      `INSERT INTO workflow_run_steps (id, runId, nodeId, nodeType, status, startedAt, input) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        "step-C",
        "run-1",
        "already-clean",
        "script",
        "completed",
        new Date().toISOString(),
        JSON.stringify(redactedCtxC),
      ],
    );

    seed.close();

    // Dry-run
    const dryRun = runScript([]);
    expect(dryRun.status).toBe(0);
    expect(dryRun.stdout).toContain("2 rows would change");
    expect(dryRun.stdout).toContain("mode=DRY-RUN");

    // Commit
    const commit = runScript(["--commit"]);
    expect(commit.status).toBe(0);
    expect(commit.stdout).toContain("COMMIT done: 2 rows updated");

    // Verify via raw connection
    const verify = new Database(TEST_DB_PATH, { readonly: true });
    const stepA = verify
      .prepare<{ input: string }, [string]>("SELECT input FROM workflow_run_steps WHERE id = ?")
      .get("step-A");
    const stepB = verify
      .prepare<{ input: string }, [string]>("SELECT input FROM workflow_run_steps WHERE id = ?")
      .get("step-B");
    const stepC = verify
      .prepare<{ input: string }, [string]>("SELECT input FROM workflow_run_steps WHERE id = ?")
      .get("step-C");
    if (!stepA || !stepB || !stepC) throw new Error("expected rows missing");

    const parsedA = JSON.parse(stepA.input) as { input: Record<string, string> };
    expect(parsedA.input.TURSO_DB_TOKEN).toBe(REDACTED_SECRET_VALUE);
    expect(parsedA.input.GITHUB_TOKEN).toBe(REDACTED_SECRET_VALUE);
    expect(parsedA.input.TURSO_DB_URL).toBe("https://example.turso.io");
    expect(parsedA.input.IMGFLIP_USERNAME).toBe("dummy");

    const parsedB = JSON.parse(stepB.input) as { input: Record<string, string> };
    expect(parsedB.input.AGENT_FS_API_KEY).toBe(REDACTED_SECRET_VALUE);
    expect(parsedB.input.OLD_LEGACY_TOKEN).toBe(REDACTED_SECRET_VALUE);
    expect(parsedB.input.TURSO_DB_URL).toBe("https://example.turso.io");

    const parsedC = JSON.parse(stepC.input) as { input: Record<string, string> };
    expect(parsedC.input.TURSO_DB_TOKEN).toBe(REDACTED_SECRET_VALUE);
    verify.close();

    // Second commit — idempotent no-op
    const second = runScript(["--commit"]);
    expect(second.status).toBe(0);
    expect(second.stdout).toContain("0 rows would change");
    expect(second.stdout).toContain("COMMIT done: 0 rows updated");
  });
});
