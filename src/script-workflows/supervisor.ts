import { mkdir, rm } from "node:fs/promises";
import { getRunningScriptRuns, getScriptRun, updateScriptRun } from "../be/db";
import type { ScriptRun } from "../types";
import { getApiKey } from "../utils/api-key";
import { scriptRunMaxWallMs } from "./limits";

type ManagedRun = {
  proc: Bun.Subprocess<"ignore", "ignore", "pipe">;
  tmpdir: string;
  startedAtMs: number;
};

const managed = new Map<string, ManagedRun>();
let reconcileTimer: ReturnType<typeof setInterval> | null = null;

function supervisorDisabled(): boolean {
  return process.env.SCRIPT_RUN_SUPERVISOR_DISABLE === "true";
}

function harnessPath(): string {
  return process.env.SCRIPT_WORKFLOW_RUNTIME_DIR
    ? `${process.env.SCRIPT_WORKFLOW_RUNTIME_DIR}/harness.bundle.js`
    : new URL("./harness.ts", import.meta.url).pathname;
}

function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export async function startScriptRunProcess(
  run: ScriptRun,
  baseUrl: string,
  apiKeyOverride?: string,
): Promise<void> {
  if (supervisorDisabled()) return;
  if (managed.has(run.id)) return;
  const apiKey = apiKeyOverride ?? getApiKey();
  if (!apiKey) throw new Error("AGENT_SWARM_API_KEY is required to spawn script runs");
  if (process.env.SCRIPT_WORKFLOW_DEBUG === "true") {
    console.error(
      `[script-workflows] spawning ${run.id} auth override=${apiKeyOverride ? "yes" : "no"} len=${apiKey.length}`,
    );
  }

  const tmpdir = `${process.env.TMPDIR ?? "/tmp"}/script-workflow-${run.id}`;
  await mkdir(tmpdir, { recursive: true });
  const sourceFile = `${tmpdir}/source.ts`;
  const argsFile = `${tmpdir}/args.json`;
  await Bun.write(sourceFile, run.source);
  await Bun.write(argsFile, JSON.stringify(run.args ?? null));

  const proc = Bun.spawn(["bun", "run", harnessPath()], {
    cwd: tmpdir,
    stdin: "ignore",
    stdout: "ignore",
    stderr: "pipe",
    env: {
      PATH: process.env.PATH ?? "/usr/bin:/bin",
      HOME: process.env.HOME ?? "/tmp",
      LANG: process.env.LANG ?? "C.UTF-8",
      LC_ALL: process.env.LC_ALL ?? "C.UTF-8",
      TMPDIR: tmpdir,
      AGENT_SWARM_API_KEY: apiKey,
      MCP_BASE_URL: baseUrl,
      SCRIPT_RUN_ID: run.id,
      SCRIPT_RUN_AGENT_ID: run.agentId,
      SCRIPT_RUN_TMPDIR: tmpdir,
      SCRIPT_RUN_SOURCE_FILE: sourceFile,
      SCRIPT_RUN_ARGS_FILE: argsFile,
    },
  });

  const stderrPromise = new Response(proc.stderr).text().catch(() => "");
  managed.set(run.id, { proc, tmpdir, startedAtMs: Date.now() });
  updateScriptRun(run.id, {
    status: "running",
    pid: proc.pid,
    lastHeartbeatAt: new Date().toISOString(),
  });

  proc.exited
    .then(async (exitCode) => {
      const stderr = await stderrPromise;
      const current = getScriptRun(run.id);
      if (current && current.status === "running") {
        if (exitCode !== 0) {
          console.error(
            `[script-workflows] run ${run.id} subprocess exited ${exitCode}: ${stderr.trim() || "(no stderr)"}`,
          );
        }
        updateScriptRun(run.id, {
          status: exitCode === 0 ? "completed" : "failed",
          pid: null,
          finishedAt: new Date().toISOString(),
          error:
            exitCode === 0
              ? null
              : stderr.trim() || `Script workflow subprocess exited ${exitCode}`,
        });
      }
    })
    .finally(async () => {
      managed.delete(run.id);
      await rm(tmpdir, { recursive: true, force: true });
    });
}

export function terminateScriptRunProcess(runId: string): boolean {
  const managedRun = managed.get(runId);
  const run = getScriptRun(runId);
  if (managedRun) {
    managedRun.proc.kill("SIGTERM");
    managed.delete(runId);
    return true;
  }
  if (run?.pid && isProcessRunning(run.pid)) {
    process.kill(run.pid, "SIGTERM");
    return true;
  }
  return false;
}

export function pauseScriptRunProcess(runId: string): void {
  terminateScriptRunProcess(runId);
  updateScriptRun(runId, { status: "paused", pid: null });
}

export function abortScriptRunLimit(runId: string, reason: string): void {
  terminateScriptRunProcess(runId);
  updateScriptRun(runId, {
    status: "aborted_limit",
    pid: null,
    finishedAt: new Date().toISOString(),
    error: reason,
  });
}

export function reconcileScriptRuns(baseUrl: string): void {
  if (supervisorDisabled()) return;
  for (const run of getRunningScriptRuns()) {
    if (run.status === "paused") continue;
    const current = managed.get(run.id);
    if (current && Date.now() - current.startedAtMs > scriptRunMaxWallMs()) {
      abortScriptRunLimit(run.id, `SCRIPT_RUN_MAX_WALL_MS exceeded (${scriptRunMaxWallMs()})`);
      continue;
    }
    if (!current && (!run.pid || !isProcessRunning(run.pid))) {
      startScriptRunProcess(run, baseUrl).catch((err) => {
        updateScriptRun(run.id, {
          status: "failed",
          pid: null,
          finishedAt: new Date().toISOString(),
          error: err instanceof Error ? err.message : String(err),
        });
      });
    }
  }
}

export function startScriptRunSupervisor(baseUrl: string): void {
  if (supervisorDisabled() || reconcileTimer) return;
  reconcileScriptRuns(baseUrl);
  reconcileTimer = setInterval(() => reconcileScriptRuns(baseUrl), 15_000);
  reconcileTimer.unref?.();
}

export function stopScriptRunSupervisor(): void {
  if (reconcileTimer) clearInterval(reconcileTimer);
  reconcileTimer = null;
  for (const runId of [...managed.keys()]) terminateScriptRunProcess(runId);
}
