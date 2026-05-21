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
  await $`agent-browser mouse down`; await $`agent-browser mouse up`;
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
// Set viewport first, then start recording. The `set viewport` command persists across navigations.
await $`agent-browser set viewport ${WIDTH} ${HEIGHT}`;
await $`agent-browser record start ${RAW_OUT} ${UI}`;
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

// Force light mode.
// The UI's use-theme.ts hook reads from localStorage key "agent-swarm-mode" (NOT "theme").
// Default is "dark" — must set explicitly + remove the dark CSS class before first paint.
// Also set OS-level media preference to light so CSS @media (prefers-color-scheme) is light.
if (THEME === "light") {
  await $`agent-browser set media light`;
  const lightModeJs = [
    `localStorage.setItem('agent-swarm-mode', 'light')`,
    `document.documentElement.classList.remove('dark')`,
    `document.documentElement.style.colorScheme = 'light'`,
  ].join(";");
  await $`agent-browser eval ${lightModeJs}`;
  await sleep(200);
}

// ---------------------------------------------------------------------------
// Scene 1: Navigate to /people — landing on the People tab
// ---------------------------------------------------------------------------

const t0 = Date.now();
console.log("📸 Scene 1: Navigate to People tab");
await $`agent-browser open ${UI}/people`;
await sleep(2000);

// Ensure light mode is applied after React hydrates (the hook reads localStorage on mount)
if (THEME === "light") {
  const lightModeReapply = [
    `localStorage.setItem('agent-swarm-mode', 'light')`,
    `document.documentElement.classList.remove('dark')`,
    `document.documentElement.style.colorScheme = 'light'`,
  ].join(";");
  await $`agent-browser eval ${lightModeReapply}`;
  await sleep(500);
}

// Cursor moves toward the People page header
await $`agent-browser mouse move ${Math.round(WIDTH * 0.5)} ${Math.round(HEIGHT * 0.18)}`;
cursorEvents.push({ tsMs: Date.now() - recordingStartTs, x: Math.round(WIDTH * 0.5), y: Math.round(HEIGHT * 0.18), action: "hover" });
await linger(2500);
console.log(`  ✓ ${((Date.now() - t0) / 1000).toFixed(1)}s`);

// ---------------------------------------------------------------------------
// Scene 2: Browse the People list — cursor scans rows
// ---------------------------------------------------------------------------

console.log("📸 Scene 2: People list — scan rows");
// Cursor moves down the list scanning rows
for (let i = 0; i < 3; i++) {
  const py = Math.round(HEIGHT * (0.32 + i * 0.07));
  await $`agent-browser mouse move ${Math.round(WIDTH * 0.5)} ${py}`;
  cursorEvents.push({ tsMs: Date.now() - recordingStartTs, x: Math.round(WIDTH * 0.5), y: py, action: "hover" });
  await sleep(600);
}
await linger(2000);
console.log(`  ✓ ${((Date.now() - t0) / 1000).toFixed(1)}s`);

// ---------------------------------------------------------------------------
// Scene 3: Click the first person row to open their detail
// ---------------------------------------------------------------------------

console.log("📸 Scene 3: Click person → detail page");
try {
  // Try clicking first row of the people table
  await clickEl("[data-rowindex='0'] .ag-cell:first-child, .ag-row-first .ag-cell:first-child", "first person row");
  await sleep(1800);
} catch {
  // Navigate to the demo user's detail page directly
  await $`agent-browser open ${UI}/people/${demoUserId}`;
  await sleep(1800);
}
// Cursor moves toward the person's profile heading
await $`agent-browser mouse move ${Math.round(WIDTH * 0.35)} ${Math.round(HEIGHT * 0.22)}`;
cursorEvents.push({ tsMs: Date.now() - recordingStartTs, x: Math.round(WIDTH * 0.35), y: Math.round(HEIGHT * 0.22), action: "hover" });
await linger(2500);
console.log(`  ✓ ${((Date.now() - t0) / 1000).toFixed(1)}s`);

// ---------------------------------------------------------------------------
// Scene 4: Person detail — hover over identities section
// ---------------------------------------------------------------------------

console.log("📸 Scene 4: Person detail — linked identities");
// Cursor moves toward the identities section in the rail
try {
  await hover("[data-testid='identities-section'], [class*='identit']", "identities section");
} catch {
  await $`agent-browser mouse move ${Math.round(WIDTH * 0.82)} ${Math.round(HEIGHT * 0.38)}`;
  cursorEvents.push({ tsMs: Date.now() - recordingStartTs, x: Math.round(WIDTH * 0.82), y: Math.round(HEIGHT * 0.38), action: "hover" });
}
await linger(3000);
console.log(`  ✓ ${((Date.now() - t0) / 1000).toFixed(1)}s`);

// ---------------------------------------------------------------------------
// Scene 5: Activity timeline — cursor scans events
// ---------------------------------------------------------------------------

console.log("📸 Scene 5: Activity timeline");
try {
  await hover("[data-testid='events-table'], [class*='event'], .ag-row", "activity timeline");
} catch {
  // Cursor drifts toward the main body (events table area)
  for (let i = 0; i < 2; i++) {
    const py = Math.round(HEIGHT * (0.5 + i * 0.08));
    await $`agent-browser mouse move ${Math.round(WIDTH * 0.45)} ${py}`;
    cursorEvents.push({ tsMs: Date.now() - recordingStartTs, x: Math.round(WIDTH * 0.45), y: py, action: "hover" });
    await sleep(700);
  }
}
await linger(3500);
console.log(`  ✓ ${((Date.now() - t0) / 1000).toFixed(1)}s`);

// ---------------------------------------------------------------------------
// Scene 6: Back to People list — cursor hovers sidebar "People" link
// ---------------------------------------------------------------------------

console.log("📸 Scene 6: Back to People list via sidebar");
try {
  await moveTo("a[href='/people'], nav a[href='/people']", "People sidebar link");
  await sleep(300);
  await $`agent-browser mouse down`; await $`agent-browser mouse up`;
  cursorEvents.push({
    tsMs: Date.now() - recordingStartTs,
    x: cursorEvents[cursorEvents.length - 1]?.x ?? Math.round(WIDTH * 0.10),
    y: cursorEvents[cursorEvents.length - 1]?.y ?? Math.round(HEIGHT * 0.35),
    action: "click",
  });
} catch {
  await $`agent-browser open ${UI}/people`;
}
await sleep(1000);
await linger(2000);
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
