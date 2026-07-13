// @ts-nocheck — research artifact (scripts-only MCP experiment), not product code
// One matrix run: fresh stack (mode, provider), optional seed pack, send scenario task, wait, snapshot.
// Usage: bun /tmp/matrix-run.ts <scripts-only|full> <runId> [claude|pi|opencode] [seeds]
// Usage (snapshot only): bun /tmp/matrix-run.ts snapshot <label>
import { applySeeds } from "./matrix-seeds.ts";
import { applyTriageFixtures } from "./triage-fixtures.ts";
import { gradeTriageTask } from "./triage-grade.ts";

const REPO = process.env.SWARM_REPO ?? process.cwd(); // run from the repo root or set SWARM_REPO
const BASE = "http://localhost:3113";
const KEY = (await Bun.file(`${REPO}/.env`).text()).match(/^API_KEY=(.*)$/m)![1].trim();
const H = { Authorization: `Bearer ${KEY}` };
const HJ = { ...H, "Content-Type": "application/json" };
const LEAD = "7a1e0000-0000-4000-8000-000000000001";
const NAMES: Record<string, string> = {
  [LEAD]: "lead",
  "7a1e0000-0000-4000-8000-000000000002": "analyst",
  "7a1e0000-0000-4000-8000-000000000003": "marketer",
};
const DEEPSEEK = "openrouter/deepseek/deepseek-v4-flash";
const TRIAGE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["brokenSchedules", "failureClusters", "staleTaskIds", "healthySchedules", "verdict"],
  properties: {
    brokenSchedules: { type: "array", items: { type: "string" } },
    failureClusters: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["token", "count"],
        properties: { token: { type: "string" }, count: { type: "number" } },
      },
    },
    staleTaskIds: { type: "array", items: { type: "string" } },
    healthySchedules: { type: "array", items: { type: "string" } },
    verdict: { enum: ["OK", "WATCH", "ALERT"] },
  },
};

const TASK = `We want a short marketing blurb about this agent swarm, produced collaboratively.

Steps:
1. Delegate a subtask to the agent named "analyst": have it collect swarm stats (registered agents with name/role/status, plus a count of tasks by status) and return a compact JSON summary.
2. When the analyst's subtask completes, delegate a subtask to the agent named "marketer": give it the analyst's JSON output and have it write a punchy 3-sentence marketing blurb about the swarm.
3. Complete this task with both the blurb and the stats JSON in your final output.

Coordinate everything yourself; do not ask a human for input.`;

const args = process.argv.slice(2);
const scenarioIndex = args.indexOf("--scenario");
const scenario = scenarioIndex === -1 ? "default" : args[scenarioIndex + 1];
if (scenarioIndex !== -1) args.splice(scenarioIndex, 2);
const [mode, runId, provider = "claude", seedsFlag = ""] = args;
if (!mode || !runId || !["default", "triage"].includes(scenario)) {
  console.error(
    "usage: matrix-run.ts <scripts-only|scripts-config|full|snapshot> <runId> [claude|pi|opencode|codex] [seeds] [--scenario triage]",
  );
  process.exit(2);
}
if (provider === "codex" && !process.env.CODEX_OAUTH) {
  console.error(
    "CODEX_OAUTH is required for --provider codex; source .env.docker before starting this cell",
  );
  process.exit(1);
}
const seeds = seedsFlag === "seeds";
const label =
  mode === "snapshot"
    ? `snapshot-${runId}`
    : `${provider}-${mode}${scenario === "triage" ? "-triage" : ""}${seeds ? "-seeds" : ""}-${runId}`;
const OUT = `/tmp/matrix/${label}`;
await Bun.$`mkdir -p ${OUT}`.quiet();

const log = (m: string) => console.log(`[${new Date().toISOString()}] [${label}] ${m}`);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function api(path: string): Promise<any> {
  return fetch(BASE + path, { headers: H }).then((r) => r.json());
}

async function compose(args: string[]) {
  const env: Record<string, string | undefined> = {
    ...process.env,
    // `scripts-config` deliberately leaves the env EMPTY and flips the mode via per-agent
    // swarm_config rows instead -- that is the Phase 1-2 gating path under test.
    SCRIPTS_ONLY_MCP: mode === "scripts-only" ? "true" : "",
    MATRIX_PROVIDER: provider,
    MATRIX_MODEL: ["pi", "opencode"].includes(provider) ? DEEPSEEK : "",
  };
  const proc = Bun.spawn(["docker", "compose", "-f", "docker-compose.scripts-only.yml", ...args], {
    cwd: REPO,
    env,
    stdout: "pipe",
    stderr: "pipe",
  });
  const code = await proc.exited;
  if (code !== 0)
    throw new Error(
      `compose ${args.join(" ")} failed (${code}): ${(await new Response(proc.stderr).text()).slice(-500)}`,
    );
}

async function waitForApiHealth() {
  for (let i = 0; i < 60; i++) {
    try {
      const response = await fetch(`${BASE}/health`, { headers: H });
      if (response.ok) return;
    } catch {}
    await sleep(2_000);
  }
  throw new Error("API did not become healthy before Codex workers were started");
}

async function configureCodexOAuth() {
  const oauth = process.env.CODEX_OAUTH;
  if (!oauth)
    throw new Error(
      "CODEX_OAUTH is required for --provider codex; source .env.docker before starting this cell",
    );
  const response = await fetch(`${BASE}/api/config`, {
    method: "PUT",
    headers: HJ,
    body: JSON.stringify({ scope: "global", key: "codex_oauth_0", value: oauth, isSecret: true }),
  });
  if (!response.ok)
    throw new Error(`could not configure local Codex OAuth: HTTP ${response.status}`);
}

async function snapshot(extra: Record<string, unknown>) {
  const tasksRes = await api("/api/tasks?limit=100");
  const tasks: any[] = tasksRes.tasks ?? tasksRes;
  await Bun.write(`${OUT}/tasks.json`, JSON.stringify(tasks, null, 2));
  const costs = await api("/api/session-costs/summary").catch(() => null);
  await Bun.write(`${OUT}/costs.json`, JSON.stringify(costs, null, 2));
  for (const t of tasks) {
    const logs = await api(`/api/tasks/${t.id}/session-logs`).catch(() => null);
    if (logs) await Bun.write(`${OUT}/logs-${t.id.slice(0, 8)}.json`, JSON.stringify(logs));
  }
  const summary = {
    mode,
    runId,
    provider,
    seeds,
    at: new Date().toISOString(),
    tasks: tasks.map((t) => ({
      id: t.id.slice(0, 8),
      agent: NAMES[t.agentId] ?? t.agentId,
      parent: t.parentTaskId?.slice(0, 8) ?? null,
      status: t.status,
    })),
    costs: costs?.totals ?? null,
    ...extra,
  };
  await Bun.write(`${OUT}/summary.json`, JSON.stringify(summary, null, 2));
  log(`snapshot done: ${OUT}`);
  return summary;
}

if (mode === "snapshot") {
  await snapshot({ note: "manual snapshot" });
  process.exit(0);
}

log("compose down -v");
await compose(["down", "-v", "--remove-orphans"]);
if (provider === "codex") {
  log("compose up -d api before Codex workers");
  await compose(["up", "-d", "--no-build", "api"]);
  await waitForApiHealth();
  await configureCodexOAuth();
}
log(
  `compose up -d (provider=${provider}, scriptsOnly=${mode === "scripts-only"}, seeds=${seeds}, scenario=${scenario})`,
);
await compose(["up", "-d", "--no-build"]);

// wait for 3 agents (generous: fresh volumes / model downloads)
let ready = false;
for (let i = 0; i < 90; i++) {
  await sleep(10_000);
  try {
    const r = await api("/api/agents");
    const agents = r.agents ?? [];
    if (i % 3 === 0)
      log(`agents: ${agents.map((a: any) => `${a.name}(${a.status})`).join(", ") || "none"}`);
    if (agents.length >= 3) {
      ready = true;
      break;
    }
  } catch {}
}
if (!ready) {
  await snapshot({ result: "BOOT_TIMEOUT" });
  if (scenario === "triage") await compose(["down", "-v", "--remove-orphans"]);
  process.exit(1);
}
await sleep(15_000);

if (seeds) {
  const res = await applySeeds(BASE, KEY);
  log("seeds: " + res.join(" | "));
  await Bun.write(`${OUT}/seeds-applied.json`, JSON.stringify(res, null, 2));
  if (res.some((r) => !/200|201/.test(r))) log("WARNING: some seed upserts failed");
}

if (mode === "scripts-config") {
  for (const agentId of Object.keys(NAMES)) {
    const r = await fetch(`${BASE}/api/config`, {
      method: "PUT",
      headers: HJ,
      body: JSON.stringify({
        scope: "agent",
        scopeId: agentId,
        key: "SCRIPTS_ONLY_MCP",
        value: "true",
      }),
    });
    if (!r.ok) throw new Error(`per-agent SCRIPTS_ONLY_MCP row failed for ${agentId}: ${r.status}`);
  }
  log("per-agent SCRIPTS_ONLY_MCP rows set; waiting out the 10s harness reconcile");
  await sleep(25_000);
}

const fixtureManifestPath = `${OUT}/fixtures.json`;
if (scenario === "triage") {
  await applyTriageFixtures(REPO, fixtureManifestPath);
  log(`triage fixtures: ${fixtureManifestPath}`);
}

const t0 = Date.now();
const task =
  scenario === "triage"
    ? await Bun.file(new URL("./triage-task.md", import.meta.url)).text()
    : TASK;
const created = await fetch(`${BASE}/api/tasks`, {
  method: "POST",
  headers: HJ,
  body: JSON.stringify({
    task,
    agentId: LEAD,
    source: "api",
    ...(scenario === "triage" ? { outputSchema: TRIAGE_SCHEMA } : {}),
  }),
}).then((r) => r.json());
const parentId = created.id;
log(`parent task ${parentId}`);

let parentStatus = "unknown";
while (Date.now() - t0 < 30 * 60 * 1000) {
  await sleep(20_000);
  try {
    const t = await api(`/api/tasks/${parentId}`);
    parentStatus = t.status;
    if (["completed", "failed", "cancelled"].includes(parentStatus)) break;
  } catch {}
}
const parentWallMs = Date.now() - t0;
log(`parent ${parentStatus} after ${(parentWallMs / 60000).toFixed(1)} min`);

const settle0 = Date.now();
while (Date.now() - settle0 < 10 * 60 * 1000) {
  await sleep(20_000);
  try {
    const r = await api("/api/tasks?limit=100");
    const open = (r.tasks ?? r).filter(
      (t: any) =>
        !["completed", "failed", "cancelled"].includes(t.status) &&
        // Triage fixtures deliberately park tasks in `in_progress` forever; they are not
        // live work and must not hold the settle loop hostage for its full 10-minute cap.
        !String(t.tags ?? "").includes("matrix-triage-fixture"),
    );
    if (open.length === 0) break;
  } catch {}
}

let grade: Record<string, unknown> | undefined;
let gradeError: unknown;
if (scenario === "triage") {
  try {
    grade = await gradeTriageTask(parentId, fixtureManifestPath, { base: BASE, apiKey: KEY });
    await Bun.write(`${OUT}/grade.json`, JSON.stringify(grade, null, 2));
  } catch (error) {
    gradeError = error;
  }
}
const summary = await snapshot({ result: parentStatus, parentId, parentWallMs, ...(grade ?? {}) });
if (scenario === "triage") await compose(["down", "-v", "--remove-orphans"]);
if (gradeError) throw gradeError;
console.log("SUMMARY " + JSON.stringify(summary));
process.exit(parentStatus === "completed" && (scenario !== "triage" || grade?.pass) ? 0 : 1);
