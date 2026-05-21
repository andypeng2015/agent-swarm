#!/usr/bin/env bun
/**
 * E2E demo recorder (v2) — real cursor tracking, 1920×1080, light mode.
 *
 * Changes from v1:
 *   - Resolution: 1920×1080 (was 1280×578). Pass --width/--height to override.
 *   - Theme: light mode by default. Override with --theme dark.
 *   - Cursor: real coordinates via `agent-browser get box` + `mouse move`.
 *     Emits cursor-track.json alongside the WebM clip (cursor-track schema v1).
 *   - Timing: cursor moves 200-400ms BEFORE clicks; lower-thirds fire AFTER events.
 *
 * Usage:
 *   cd assets/release-recorder
 *   bun record-e2e.ts
 *   bun record-e2e.ts --out /tmp/swarm-e2e-raw.webm --theme dark --width 1280 --height 720
 *
 * Output:
 *   raw/e2e-demo.webm          — the recording
 *   raw/e2e-demo-cursor.json   — CursorTrack JSON (schema v1)
 */

import { Database } from "bun:sqlite";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { $ } from "bun";
import type { CursorEvent, CursorTrack } from "./src/cursor-track";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const get = (flag: string, fallback: string) => {
  const i = args.indexOf(flag);
  return i >= 0 ? (args[i + 1] ?? fallback) : fallback;
};

const defaultOut = join(import.meta.dir, "raw/e2e-demo.webm");
const RAW_OUT = get("--out", defaultOut);
const CURSOR_OUT = RAW_OUT.replace(/\.webm$/, "-cursor.json");
const WIDTH = Number(get("--width", "1920"));
const HEIGHT = Number(get("--height", "1080"));
const THEME = get("--theme", "light") as "light" | "dark";
const UI = process.env.SWARM_UI_URL ?? "http://localhost:5274";
const API = process.env.SWARM_API_URL ?? "http://localhost:3013";
const API_KEY = process.env.API_KEY ?? "123123";
const DB_PATH = join(import.meta.dir, "../../agent-swarm-db.sqlite");

mkdirSync(join(import.meta.dir, "raw"), { recursive: true });

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// Cursor tracking
// ---------------------------------------------------------------------------

const cursorEvents: CursorEvent[] = [];
let recordingStartTs = 0;

/**
 * Get the center coordinates of a DOM element via `agent-browser get box`.
 * Returns {x, y} in viewport pixels (1920×1080 space).
 */
async function getCenter(selector: string): Promise<{ x: number; y: number }> {
  const json = await $`agent-browser get box ${selector}`.text();
  const box = JSON.parse(json.trim()) as { x: number; y: number; width: number; height: number };
  return {
    x: Math.round(box.x + box.width / 2),
    y: Math.round(box.y + box.height / 2),
  };
}

/**
 * Move cursor to an element with realistic easing.
 * Approach begins 200-300ms before the click — cursor arrives, then we click.
 */
async function moveTo(selector: string, label?: string): Promise<{ x: number; y: number }> {
  const { x, y } = await getCenter(selector);
  await $`agent-browser mouse move ${x} ${y}`;
  cursorEvents.push({ tsMs: Date.now() - recordingStartTs, x, y, action: "move" });
  if (label) console.log(`  ↪ cursor → ${label} (${x}, ${y})`);
  return { x, y };
}

/**
 * Hover (record position, no click).
 */
async function hover(selector: string, label?: string): Promise<{ x: number; y: number }> {
  const { x, y } = await getCenter(selector);
  await $`agent-browser mouse move ${x} ${y}`;
  cursorEvents.push({ tsMs: Date.now() - recordingStartTs, x, y, action: "hover" });
  if (label) console.log(`  ↪ hover  → ${label} (${x}, ${y})`);
  return { x, y };
}

/**
 * Move to element ~300ms, then click.
 * Lower-thirds / DB writes happen AFTER this returns.
 */
async function clickEl(selector: string, label?: string): Promise<void> {
  await moveTo(selector, label);
  await sleep(300); // cursor approach pause — timing is visible on screen
  await $`agent-browser mouse click`;
  cursorEvents.push({
    tsMs: Date.now() - recordingStartTs,
    x: cursorEvents[cursorEvents.length - 1]?.x ?? 960,
    y: cursorEvents[cursorEvents.length - 1]?.y ?? 540,
    action: "click",
  });
}

/**
 * Evaluate JS and record cursor at computed position.
 * Use for elements whose bounding box depends on scroll or JS state.
 */
async function evalAndMove(
  js: string,
  label?: string,
): Promise<{ x: number; y: number }> {
  const result = await $`agent-browser eval ${js}`.text();
  const { x, y } = JSON.parse(result.trim()) as { x: number; y: number };
  await $`agent-browser mouse move ${x} ${y}`;
  cursorEvents.push({ tsMs: Date.now() - recordingStartTs, x, y, action: "move" });
  if (label) console.log(`  ↪ eval   → ${label} (${x}, ${y})`);
  return { x, y };
}

// ---------------------------------------------------------------------------
// Scroll helper with cursor tracking
// ---------------------------------------------------------------------------

async function linger(ms: number) {
  const stepMs = 600;
  const steps = Math.max(1, Math.floor(ms / stepMs));
  for (let i = 0; i < steps; i++) {
    const dir = i % 2 === 0 ? "down" : "up";
    await $`agent-browser scroll ${dir} 80`.quiet().catch(() => {});
    await sleep(stepMs);
  }
}

async function invalidateTask(taskId: string) {
  const js = `window.__queryClient?.invalidateQueries({queryKey:["task","${taskId}"]})`;
  await $`agent-browser eval ${js}`.quiet().catch(() => {});
  await sleep(800);
}

// ---------------------------------------------------------------------------
// API / DB helpers
// ---------------------------------------------------------------------------

async function apiPost(path: string, body: unknown) {
  const r = await fetch(`${API}${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`POST ${path}: HTTP ${r.status} ${await r.text().catch(() => "")}`);
  return r.json();
}

function dbRun(db: Database, sql: string, ...params: (string | number | null)[]) {
  db.run(sql, params);
}

// ---------------------------------------------------------------------------
// Preflight
// ---------------------------------------------------------------------------

console.log(`🎬 E2E demo recorder v2`);
console.log(`   viewport: ${WIDTH}×${HEIGHT}  theme: ${THEME}`);

const health = await fetch(`${API}/health`)
  .then((r) => r.json())
  .catch(() => null) as { status?: string; version?: string } | null;
if (!health?.status) {
  console.error(`✗ API not reachable at ${API} — run bin/reset-demo-stack.sh first`);
  process.exit(1);
}
console.log(`  API: ${API} ✓ (v${health.version})`);

const uiCode = await $`curl -sf -o /dev/null -w "%{http_code}" ${UI}`.text().catch(() => "0");
if (!uiCode.trim().startsWith("2")) {
  console.error(`✗ UI not reachable at ${UI}`);
  process.exit(1);
}
console.log(`  UI: ${UI} ✓`);

const db = new Database(DB_PATH);
console.log(`  DB: ${DB_PATH} ✓\n`);

// ---------------------------------------------------------------------------
// Pre-create demo user + task
// ---------------------------------------------------------------------------

const demoSuffix = Math.random().toString(36).slice(2, 10);
const demoUserId = `demo-user-${demoSuffix}`;
const nowTs = new Date().toISOString();
db.run("INSERT INTO users (id, name, email, createdAt, lastUpdatedAt) VALUES (?,?,?,?,?)", [
  demoUserId, "Demo User", `demo-${demoSuffix}@swarm.local`, nowTs, nowTs,
]);

console.log("⚙  Pre-creating demo task...");
const created = await apiPost("/api/tasks", {
  task: "Analyze PR #513 — security review for the release-recorder pipeline",
  priority: 80,
  tags: ["security", "review"],
  source: "api",
}) as { id: string; status: string };
const taskId = created.id;
console.log(`  task id: ${taskId}\n`);

// ---------------------------------------------------------------------------
// EXIT-trap
// ---------------------------------------------------------------------------

let recording = false;
process.on("exit", () => {
  if (recording) {
    try { Bun.spawnSync(["agent-browser", "record", "stop"]); } catch { /* best-effort */ }
  }
});
for (const sig of ["SIGINT", "SIGTERM"] as NodeJS.Signals[]) {
  process.on(sig, () => process.exit(1));
}

// ---------------------------------------------------------------------------
// START RECORDING — 1920×1080, light mode
// ---------------------------------------------------------------------------

console.log(`🔴 Starting recording → ${RAW_OUT}`);
// Pass viewport dimensions to agent-browser record start.
// Default: 1920×1080. Override via --width / --height CLI flags.
await $`agent-browser record start ${RAW_OUT} ${UI} --width ${WIDTH} --height ${HEIGHT}`;
recording = true;
recordingStartTs = Date.now();
cursorEvents.push({ tsMs: 0, x: WIDTH / 2, y: HEIGHT / 2, action: "move" });
await sleep(1200);

// Inject connection + user identity
const connConfig = JSON.stringify({
  connections: [{ id: "demo-conn", name: "local", apiUrl: API, apiKey: API_KEY }],
  activeId: "demo-conn",
});
const userKey = `swarm:v1:${API}:current-user`;
const jsInject = [
  `localStorage.setItem('agent-swarm-connections', '${connConfig}')`,
  `localStorage.setItem('${userKey}', '${demoUserId}')`,
].join(";");
await $`agent-browser eval ${jsInject}`;
await sleep(300);

// Force light mode (shadcn/next-themes stores preference in localStorage)
if (THEME === "light") {
  const lightModeJs = [
    `localStorage.setItem('theme', 'light')`,
    `document.documentElement.classList.remove('dark')`,
    `document.documentElement.classList.add('light')`,
    `document.documentElement.style.colorScheme = 'light'`,
  ].join(";");
  await $`agent-browser eval ${lightModeJs}`;
  await sleep(200);
}

// ---------------------------------------------------------------------------
// Scene 1: Tasks list — cursor hovers over a task row
// ---------------------------------------------------------------------------

const t0 = Date.now();
console.log("📸 Scene 1: Tasks list");
await $`agent-browser open ${UI}/tasks`;
await sleep(1200);

// Hover over the first task row — use agent-browser get box on the row selector
try {
  await hover("[data-testid='task-row']:first-child, .task-row:first-child, tr:first-child", "task row");
} catch {
  // Fallback: move to center of the task list area
  await $`agent-browser mouse move ${Math.round(WIDTH * 0.5)} ${Math.round(HEIGHT * 0.4)}`;
  cursorEvents.push({ tsMs: Date.now() - recordingStartTs, x: Math.round(WIDTH * 0.5), y: Math.round(HEIGHT * 0.4), action: "hover" });
}
await linger(3000);
console.log(`  ✓ ${((Date.now() - t0) / 1000).toFixed(1)}s`);

// ---------------------------------------------------------------------------
// Scene 2: Task detail — navigate, cursor moves toward task title
// ---------------------------------------------------------------------------

console.log("📸 Scene 2: Task detail — pending");
await $`agent-browser open ${UI}/tasks/${taskId}`;
await sleep(1500);

// Cursor moves toward the task status badge (real position)
try {
  await hover("[data-testid='task-status'], .task-status, [class*='status']", "status badge");
} catch {
  await $`agent-browser mouse move ${Math.round(WIDTH * 0.35)} ${Math.round(HEIGHT * 0.25)}`;
  cursorEvents.push({ tsMs: Date.now() - recordingStartTs, x: Math.round(WIDTH * 0.35), y: Math.round(HEIGHT * 0.25), action: "hover" });
}
await linger(2500);
console.log(`  ✓ ${((Date.now() - t0) / 1000).toFixed(1)}s`);

// ---------------------------------------------------------------------------
// Scene 3: pending → in_progress
// ---------------------------------------------------------------------------

console.log("📸 Scene 3: in_progress — agent claimed");
dbRun(db, "UPDATE agent_tasks SET status='in_progress', lastUpdatedAt=? WHERE id=?", new Date().toISOString(), taskId);
await invalidateTask(taskId);

// Cursor moves toward the IN PROGRESS badge after it appears (~100ms delay)
await sleep(150); // wait for event to render on screen
try {
  await hover("[data-testid='task-status'], .task-status, [class*='status']", "IN PROGRESS badge");
} catch {
  await $`agent-browser mouse move ${Math.round(WIDTH * 0.35)} ${Math.round(HEIGHT * 0.27)}`;
  cursorEvents.push({ tsMs: Date.now() - recordingStartTs, x: Math.round(WIDTH * 0.35), y: Math.round(HEIGHT * 0.27), action: "hover" });
}
await linger(2500);
console.log(`  ✓ ${((Date.now() - t0) / 1000).toFixed(1)}s`);

// ---------------------------------------------------------------------------
// Scene 4: Progress updates — cursor near progress text
// ---------------------------------------------------------------------------

const progressUpdates = [
  "🔍 Scanning PR diff for authentication changes...",
  "⚠️  Found 2 potential issues — checking token expiry and CSRF headers",
  "✅ Review complete — writing final report",
];

for (const [idx, msg] of progressUpdates.entries()) {
  console.log(`📸 Scene 4.${idx + 1}: progress update`);
  dbRun(db, "UPDATE agent_tasks SET progress=?, lastUpdatedAt=? WHERE id=?", msg, new Date().toISOString(), taskId);
  await invalidateTask(taskId);
  await sleep(150); // let the progress text render
  // Cursor drifts toward the progress text area after it updates
  try {
    await hover("[data-testid='task-progress'], .task-progress, [class*='progress']", "progress text");
  } catch {
    const py = Math.round(HEIGHT * (0.38 + idx * 0.02));
    await $`agent-browser mouse move ${Math.round(WIDTH * 0.36)} ${py}`;
    cursorEvents.push({ tsMs: Date.now() - recordingStartTs, x: Math.round(WIDTH * 0.36), y: py, action: "hover" });
  }
  await linger(2200);
  console.log(`  ✓ ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}

// ---------------------------------------------------------------------------
// Scene 5: Task completes — cursor moves toward output section
// ---------------------------------------------------------------------------

console.log("📸 Scene 5: completed with output");
const output = [
  "Security review of PR #513 (release-recorder pipeline):",
  "",
  "RESULT: ✅ APPROVED — 2 low-severity findings:",
  "  1. Token expiry not validated on WebM upload endpoint",
  "     → Non-critical: local dev tool, no external auth gate needed",
  "  2. Missing CSRF header on /api/tasks POST",
  "     → Mitigated by mandatory Bearer token requirement",
  "",
  "No blocking issues. Safe to merge.",
].join("\n");

dbRun(
  db,
  `UPDATE agent_tasks SET status='completed', output=?, progress=NULL, finishedAt=?, lastUpdatedAt=? WHERE id=?`,
  output, new Date().toISOString(), new Date().toISOString(), taskId,
);
await invalidateTask(taskId);
await sleep(150); // let COMPLETED state render
// Cursor moves toward the output section AFTER it appears
try {
  await hover("[data-testid='task-output'], .task-output, [class*='output']", "output section");
} catch {
  await $`agent-browser mouse move ${Math.round(WIDTH * 0.36)} ${Math.round(HEIGHT * 0.5)}`;
  cursorEvents.push({ tsMs: Date.now() - recordingStartTs, x: Math.round(WIDTH * 0.36), y: Math.round(HEIGHT * 0.5), action: "hover" });
}
await linger(4500);
console.log(`  ✓ ${((Date.now() - t0) / 1000).toFixed(1)}s`);

// ---------------------------------------------------------------------------
// Scene 6: Back to tasks list — cursor clicks the back link
// ---------------------------------------------------------------------------

console.log("📸 Scene 6: back to tasks list");
try {
  // Move to back link 300ms before clicking (timing is intentional)
  await moveTo("[data-testid='back-link'], a[href='/tasks'], [class*='back']", "back to tasks link");
  await sleep(300);
  await $`agent-browser mouse click`;
  cursorEvents.push({
    tsMs: Date.now() - recordingStartTs,
    x: cursorEvents[cursorEvents.length - 1]?.x ?? Math.round(WIDTH * 0.14),
    y: cursorEvents[cursorEvents.length - 1]?.y ?? Math.round(HEIGHT * 0.22),
    action: "click",
  });
} catch {
  await $`agent-browser open ${UI}/tasks`;
}
await sleep(1000);
await linger(2500);
console.log(`  total: ${((Date.now() - t0) / 1000).toFixed(1)}s`);

// ---------------------------------------------------------------------------
// STOP RECORDING
// ---------------------------------------------------------------------------

console.log("\n⏹  Stopping recording...");
await $`agent-browser record stop`;
recording = false;
const durationMs = Date.now() - recordingStartTs;
db.close();

// ---------------------------------------------------------------------------
// Emit cursor-track.json
// ---------------------------------------------------------------------------

const cursorTrack: CursorTrack = {
  version: "1",
  durationMs,
  viewport: { width: WIDTH, height: HEIGHT },
  theme: THEME,
  events: cursorEvents,
};

writeFileSync(CURSOR_OUT, JSON.stringify(cursorTrack, null, 2));
console.log(`\n✅ Recorded: ${RAW_OUT} (${(Bun.file(RAW_OUT).size / 1024 / 1024).toFixed(1)} MB)`);
console.log(`   Cursor track: ${CURSOR_OUT} (${cursorEvents.length} events)`);
console.log(`\nNext steps:`);
console.log(`  1. Convert to mp4:`);
console.log(`     ffmpeg -y -i ${RAW_OUT} -c:v libx264 -preset fast -crf 22 -pix_fmt yuv420p -movflags +faststart -an /tmp/swarm-e2e-demo.mp4`);
console.log(`  2. Copy cursor track to video-source:`);
console.log(`     cp ${CURSOR_OUT} assets/video-source/src/cursor-track.json`);
console.log(`  3. Import it in SwarmDemo.tsx instead of sample-cursor-track.json`);
console.log(`  4. Render: cd assets/video-source && npm run build:swarm-demo`);
