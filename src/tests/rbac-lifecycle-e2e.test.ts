/**
 * RBAC audit lifecycle e2e (DES-445) — the codex-fix surfaces from PR #922,
 * ported from the live QA in
 * thoughts/taras/qa/2026-07-07-des-445-rbac-slice1.md, step 3.
 *
 * ENV-GATED: runs only with RBAC_LIFECYCLE_E2E=1 (skipped otherwise, so the
 * default `bun test` / merge-gate path pays nothing). Each surface needs its
 * own server boot (~10s), so this is an on-demand / pre-release suite:
 *
 *   RBAC_LIFECYCLE_E2E=1 bun test src/tests/rbac-lifecycle-e2e.test.ts
 *
 * Boots, in order, against ONE scratch DB so state carries across restarts:
 *   1. default env      → 250-call burst flushes without blocking
 *   2. RBAC_AUDIT_FLUSH_MS=600000 → SIGTERM drain is what persists buffered rows
 *   3. RBAC_AUDIT_DISABLED=true   → kill-switch: gates enforce, nothing audited
 *   4. default env + backdated row + boot hammer → retention purge before
 *      listen; first accepted request is audited (no unaudited startup window)
 *   5. stdio transport → boot purge live + SIGTERM handler exits 143
 *
 * Not covered here by design (see QA report observations): the stdio
 * buffered-drain (no gated tool can reach can() over pure stdio — agent
 * identity is HTTP-header-only) and the fs non-owner deny (unreachable over
 * the wire with valid auth; characterized in rbac-charact-http.test.ts).
 */
import { Database } from "bun:sqlite";
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { openSync } from "node:fs";
import { join } from "node:path";
import {
  api,
  countAuditRows,
  E2E_API_KEY,
  LEAD,
  makeScratchDir,
  REPO_ROOT,
  registerAgent,
  removeScratchDir,
  type SwarmServer,
  spawnSwarmServer,
  WORKER_A,
  WORKER_B,
  waitForAuditCount,
} from "./rbac-e2e-helpers";

setDefaultTimeout(180_000);

const RUN = process.env.RBAC_LIFECYCLE_E2E === "1";
const suite = RUN ? describe : describe.skip;

let dir: string;
let dbPath: string;
let server: SwarmServer | null = null;

/** One gated deny: WORKER_A writing into WORKER_B's kv namespace → 403. */
async function gatedDeny(base: string, key: string): Promise<number> {
  const res = await api(base, "PUT", `/api/kv/_/task:agent:${WORKER_B}/${key}`, {
    agentId: WORKER_A,
    body: { value: "x" },
  });
  return res.status;
}

function insertBackdatedRow(marker: string): void {
  const db = new Database(dbPath);
  try {
    db.prepare(
      `INSERT INTO permission_audit (ts, principalType, principalId, verb, decision, reason, source)
       VALUES (datetime('now', '-45 days'), 'agent', ?, 'qa.backdated.probe', 'deny', 'retention probe', 'http')`,
    ).run(marker);
  } finally {
    db.close();
  }
}

function backdatedRowCount(marker: string): number {
  const db = new Database(dbPath, { readonly: true });
  try {
    const row = db
      .prepare("SELECT count(*) AS n FROM permission_audit WHERE principalId = ?")
      .get(marker) as { n: number };
    return row.n;
  } finally {
    db.close();
  }
}

suite("RBAC audit lifecycle (spawned servers, one scratch DB)", () => {
  beforeAll(async () => {
    dir = await makeScratchDir();
    dbPath = join(dir, "lifecycle.sqlite");
  });

  afterAll(async () => {
    if (server) await server.stop().catch(() => null);
    if (dir) await removeScratchDir(dir);
  });

  test("boot 1: 250-call gated burst flushes fully without blocking the request path", async () => {
    server = await spawnSwarmServer({ dbPath, logPath: join(dir, "boot1.log") });
    await registerAgent(server.base, LEAD, "e2e-lead", true);
    await registerAgent(server.base, WORKER_A, "e2e-worker-a", false);
    await registerAgent(server.base, WORKER_B, "e2e-worker-b", false);

    const statuses = await Promise.all(
      Array.from({ length: 250 }, (_, i) => gatedDeny(server!.base, `burst${i}`)),
    );
    expect(statuses.every((s) => s === 403)).toBe(true);

    // The writer must not block the request path: a control request right
    // after the burst answers promptly (QA measured 1.7ms; 1s is the CI bound).
    const t0 = Date.now();
    const control = await api(server.base, "GET", "/api/agents", {});
    expect(control.status).toBe(200);
    expect(Date.now() - t0).toBeLessThan(1_000);

    // 200 rows flush on the threshold path, the tail on the 2s interval.
    const n = await waitForAuditCount(dbPath, 250);
    expect(n).toBe(250);

    await server.stop();
    server = null;
  });

  test("boot 2: SIGTERM drain persists buffered rows (timer flush disabled via RBAC_AUDIT_FLUSH_MS)", async () => {
    const before = countAuditRows(dbPath);
    server = await spawnSwarmServer({
      dbPath,
      logPath: join(dir, "boot2.log"),
      env: { RBAC_AUDIT_FLUSH_MS: "600000" },
    });

    for (let i = 0; i < 3; i++) {
      expect(await gatedDeny(server.base, `drain${i}`)).toBe(403);
    }
    // With a 600s flush interval (and only 3 rows, far below the 200-row
    // threshold), nothing can persist these except the shutdown drain.
    await Bun.sleep(3_000);
    expect(countAuditRows(dbPath)).toBe(before);

    const exitCode = await server.stop();
    server = null;
    expect(exitCode).toBe(0);
    expect(countAuditRows(dbPath)).toBe(before + 3);
  });

  test("boot 3: RBAC_AUDIT_DISABLED=true keeps gates enforcing but audits nothing", async () => {
    const before = countAuditRows(dbPath);
    server = await spawnSwarmServer({
      dbPath,
      logPath: join(dir, "boot3.log"),
      env: { RBAC_AUDIT_DISABLED: "true" },
    });

    expect(await gatedDeny(server.base, "killswitch")).toBe(403);
    const leadUpsert = await api(server.base, "POST", "/api/scripts/upsert", {
      agentId: LEAD,
      body: {
        name: "e2e-killswitch",
        source: "export default async function main() { return 1; }",
        scope: "global",
      },
    });
    expect(leadUpsert.status).toBe(200);

    await Bun.sleep(3_000);
    expect(countAuditRows(dbPath)).toBe(before);

    await server.stop();
    server = null;
  });

  test("boot 4: retention purge runs before listen; the first accepted request is audited", async () => {
    insertBackdatedRow("backdated-boot4");
    expect(backdatedRowCount("backdated-boot4")).toBe(1);
    const before = countAuditRows(dbPath);

    // Hammer from BEFORE the spawn: the first response the socket ever
    // returns must already be gated AND audited (sink wired pre-listen).
    // spawnSwarmServer picks the port itself, so the hammer spins against a
    // dead placeholder until the spawn hands the real base over.
    let pendingBase = "http://localhost:1";
    const firstResponse = (async () => {
      for (let i = 0; i < 4_500; i++) {
        try {
          return await gatedDeny(pendingBase, "bootrace");
        } catch {
          await Bun.sleep(20);
        }
      }
      return -1;
    })();

    server = await spawnSwarmServer({
      dbPath,
      logPath: join(dir, "boot4.log"),
      waitForListen: false,
    });
    pendingBase = server.base;

    const status = await firstResponse;
    expect(status).toBe(403);

    // Purge line must precede the listen line in the boot log.
    const log = await Bun.file(join(dir, "boot4.log")).text();
    const purgeIdx = log.indexOf("Initial retention purge removed 1 audit row");
    const listenIdx = log.indexOf("MCP HTTP server running");
    expect(purgeIdx).toBeGreaterThan(-1);
    expect(listenIdx).toBeGreaterThan(-1);
    expect(purgeIdx).toBeLessThan(listenIdx);

    expect(backdatedRowCount("backdated-boot4")).toBe(0);
    // -1 purged backdated row, +1 boot-race deny (the hammer stops after its
    // first accepted response, so exactly one).
    const n = await waitForAuditCount(dbPath, before);
    expect(n).toBe(before);

    await server.stop();
    server = null;
  });

  test("boot 5: stdio wires the audit module (boot purge) and SIGTERM exits 143", async () => {
    insertBackdatedRow("backdated-stdio");
    const logFd = openSync(join(dir, "stdio.log"), "a");
    const proc = Bun.spawn(["bun", "src/stdio.ts"], {
      cwd: REPO_ROOT,
      stdin: "pipe",
      stdout: logFd,
      stderr: logFd,
      env: {
        ...process.env,
        DATABASE_PATH: dbPath,
        API_KEY: E2E_API_KEY,
        AGENT_SWARM_API_KEY: E2E_API_KEY,
      },
    });
    proc.stdin.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2024-11-05",
          clientInfo: { name: "rbac-e2e-stdio", version: "1" },
          capabilities: {},
        },
      })}\n`,
    );
    await proc.stdin.flush();

    // startAuditGc purges on boot — poll until the backdated row is gone.
    const deadline = Date.now() + 30_000;
    while (backdatedRowCount("backdated-stdio") > 0 && Date.now() < deadline) {
      await Bun.sleep(250);
    }
    expect(backdatedRowCount("backdated-stdio")).toBe(0);

    proc.kill("SIGTERM");
    await proc.exited;
    // src/stdio.ts installs an explicit SIGTERM handler: drain, then exit(143).
    expect(proc.exitCode).toBe(143);
  });
});
