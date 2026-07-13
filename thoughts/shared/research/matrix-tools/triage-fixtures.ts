// @ts-nocheck — research artifact
// Seed deterministic operations-triage fixtures directly into the compose SQLite DB.
const LEAD = "7a1e0000-0000-4000-8000-000000000001";
const ANALYST = "7a1e0000-0000-4000-8000-000000000002";
// A registered-but-never-booted agent. In-flight fixtures are assigned here because a LIVE
// worker's crash-recovery path resumes `in_progress` tasks assigned to itself: with the
// fixtures on `lead`, the lead worker claimed all three and ran them to `completed` within
// ~2 minutes. Nothing polls for the ghost, so its tasks stay parked. (The heartbeat reaper
// would still supersede them -- hence HEARTBEAT_DISABLE=true on the matrix compose api.)
const GHOST = "7a1e0000-0000-4000-8000-0000000000ff";

type FixtureManifest = {
  brokenSchedules: string[];
  failureClusters: Array<{ token: string; count: number }>;
  staleTaskIds: string[];
  healthySchedules: string[];
  freshTaskId: string;
};

function createManifest(): FixtureManifest {
  return {
    brokenSchedules: ["fx-sched-alpha", "fx-sched-bravo", "fx-sched-charlie"],
    failureClusters: [
      { token: "FX-CLUSTER-A-7731", count: 3 },
      { token: "FX-CLUSTER-B-7732", count: 2 },
    ],
    staleTaskIds: [crypto.randomUUID(), crypto.randomUUID()],
    healthySchedules: ["fx-sched-delta", "fx-sched-echo"],
    freshTaskId: crypto.randomUUID(),
  };
}

function fixtureProgram(manifest: FixtureManifest): string {
  const now = new Date();
  const stale = new Date(now.getTime() - 4 * 60 * 60 * 1000);
  const recent = new Date(now.getTime() - 5 * 60 * 1000);
  // Schedules must stay enabled=1 (that is what the agent has to notice) but must never
  // actually fire: the API scheduler ticks every 10s and executes anything with
  // `enabled=1 AND nextRunAt <= now`, which would run the fixtures, reset their
  // consecutiveErrors, and inject real tasks mid-run. Park nextRunAt 30 days out.
  const nextRun = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  const fixture = {
    manifest,
    now: now.toISOString(),
    stale: stale.toISOString(),
    recent: recent.toISOString(),
    nextRun: nextRun.toISOString(),
    lead: LEAD,
    analyst: ANALYST,
    ghost: GHOST,
  };

  return `
import { Database } from "bun:sqlite";
const fixture = ${JSON.stringify(fixture)};
const db = new Database(process.env.DATABASE_PATH);
const broken = [
  ["fx-sched-alpha", 3, "FX-ERR-1101"],
  ["fx-sched-bravo", 5, "FX-ERR-1102"],
  ["fx-sched-charlie", 7, "FX-ERR-1103"],
];
const healthy = ["fx-sched-delta", "fx-sched-echo"];
db.transaction(() => {
  db.prepare("DELETE FROM scheduled_tasks WHERE name LIKE 'fx-sched-%'").run();
  db.prepare("DELETE FROM agent_tasks WHERE tags LIKE '%matrix-triage-fixture%'").run();
  db.prepare(
    "INSERT OR REPLACE INTO agents (id, name, status, isLead, createdAt, lastUpdatedAt) VALUES (?, ?, 'offline', 0, ?, ?)"
  ).run(fixture.ghost, "fx-ghost-worker", fixture.now, fixture.now);

  const schedule = db.prepare(
    "INSERT INTO scheduled_tasks (id, name, description, cronExpression, intervalMs, taskTemplate, taskType, tags, priority, targetAgentId, enabled, lastRunAt, nextRunAt, createdByAgentId, timezone, consecutiveErrors, lastErrorAt, lastErrorMessage, scheduleType, createdAt, lastUpdatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
  );
  for (const [name, consecutiveErrors, token] of broken) {
    schedule.run(crypto.randomUUID(), name, "matrix triage broken schedule " + token, "0 * * * *", null, "{}", "matrix-triage", '["matrix-triage-fixture"]', 50, fixture.lead, 1, fixture.recent, fixture.nextRun, fixture.lead, "UTC", consecutiveErrors, fixture.recent, "fixture failure " + token, "recurring", fixture.now, fixture.now);
  }
  for (const name of healthy) {
    schedule.run(crypto.randomUUID(), name, "matrix triage healthy schedule", "0 * * * *", null, "{}", "matrix-triage", '["matrix-triage-fixture"]', 50, fixture.lead, 1, fixture.recent, fixture.nextRun, fixture.lead, "UTC", 0, null, null, "recurring", fixture.now, fixture.now);
  }

  const task = db.prepare(
    "INSERT INTO agent_tasks (id, agentId, creatorAgentId, task, status, source, taskType, tags, priority, dependsOn, createdAt, lastUpdatedAt, finishedAt, failureReason, output, progress) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
  );
  const failed = (token, count, agentId) => {
    for (let i = 0; i < count; i++) {
      task.run(crypto.randomUUID(), agentId, fixture.lead, "matrix triage failed task " + token + " #" + (i + 1), "failed", "api", "matrix-triage", JSON.stringify(["matrix-triage-fixture", token]), 50, "[]", fixture.recent, fixture.recent, fixture.recent, "fixture failure " + token, null, null);
    }
  };
  failed("FX-CLUSTER-A-7731", 3, fixture.analyst);
  failed("FX-CLUSTER-B-7732", 2, fixture.lead);
  for (let i = 0; i < 4; i++) {
    task.run(crypto.randomUUID(), fixture.analyst, fixture.lead, "matrix triage completed noise #" + (i + 1), "completed", "api", "matrix-triage", '["matrix-triage-fixture","noise"]', 50, "[]", fixture.recent, fixture.recent, fixture.recent, null, "completed noise", null);
  }
  for (const id of fixture.manifest.staleTaskIds) {
    task.run(id, fixture.ghost, fixture.lead, "matrix triage stale in-flight task", "in_progress", "api", "matrix-triage", '["matrix-triage-fixture","stale"]', 50, "[]", fixture.stale, fixture.stale, null, null, null, "fixture intentionally stale");
  }
  task.run(fixture.manifest.freshTaskId, fixture.ghost, fixture.lead, "matrix triage fresh in-flight noise", "in_progress", "api", "matrix-triage", '["matrix-triage-fixture","fresh"]', 50, "[]", fixture.now, fixture.now, null, null, null, "fixture intentionally fresh");
})();
db.close();
console.log("triage fixtures applied");
`;
}

export async function applyTriageFixtures(
  repoRoot: string,
  manifestPath: string,
): Promise<FixtureManifest> {
  const manifest = createManifest();
  const manifestDir = manifestPath.slice(0, manifestPath.lastIndexOf("/")) || ".";
  await Bun.$`mkdir -p ${manifestDir}`.quiet();
  const process = Bun.spawn(
    [
      "docker",
      "compose",
      "-f",
      "docker-compose.scripts-only.yml",
      "exec",
      "-T",
      "api",
      "bun",
      "-e",
      fixtureProgram(manifest),
    ],
    { cwd: repoRoot, stdout: "pipe", stderr: "pipe" },
  );
  const exitCode = await process.exited;
  if (exitCode !== 0) {
    throw new Error(
      `triage fixture seeding failed (${exitCode}): ${(await new Response(process.stderr).text()).slice(-500)}`,
    );
  }
  await Bun.write(manifestPath, JSON.stringify(manifest, null, 2));
  return manifest;
}

if (import.meta.main) {
  const manifestPath = process.argv[2] ?? "/tmp/matrix/triage-fixtures/fixtures.json";
  await applyTriageFixtures(process.cwd(), manifestPath);
  console.log(`fixtures manifest: ${manifestPath}`);
}
