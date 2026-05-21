#!/usr/bin/env node
/**
 * E2E demo recorder v6 — DOM cursor (baked into recording) + native speed.
 *
 * Key changes from v5:
 *   1. DOM cursor injected via addInitScript() — cursor is baked into captured frames,
 *      no Remotion overlay needed. Cursor.tsx is retired in SceneDemo.tsx.
 *   2. No setpts speedup — native recording speed with deliberate but tight pacing.
 *   3. Auth + theme injected via addInitScript() — no double-navigation per beat.
 *
 * Beats (target ~7s each, ~35s total):
 *   1. navigate-people   — full People list, wide pan across heading
 *   2. scan-list         — close-up row-by-row scan
 *   3. open-person       — click Ada row → profile detail page
 *   4. linked-identities — identity badges (Slack/GitHub/Linear/GitLab)
 *   5. activity-timeline — events feed scan (12 varied events)
 */

import { chromium } from '/opt/global-deps/node_modules/playwright/index.mjs';
import { execFileSync } from 'child_process';
import { writeFileSync, readFileSync, mkdirSync, renameSync, existsSync, readdirSync, unlinkSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const RAW_DIR    = join(__dirname, 'raw');
const FINAL_MP4  = join(RAW_DIR, 'swarm-demo.mp4');
const CURSOR_OUT = join(RAW_DIR, 'e2e-demo-cursor.json');
const FFMPEG     = process.env.FFMPEG_BIN ?? 'ffmpeg';
const WIDTH  = 1920;
const HEIGHT = 1080;
const FPS    = 30;
const UI  = process.env.SWARM_UI_URL  ?? 'http://localhost:5274';
const API = process.env.SWARM_API_URL ?? 'http://localhost:3013';
const API_KEY = process.env.API_KEY ?? '123123';
const ADA_ID  = '7f944e82787b481bb78d4c20d12b1fa3';

mkdirSync(RAW_DIR, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// Preflight
// ---------------------------------------------------------------------------

console.log('🎬 E2E demo recorder v6 (DOM cursor, native speed)\n');
const health = await fetch(`${API}/health`).then(r => r.json()).catch(() => null);
if (!health?.status) { console.error(`✗ API not reachable at ${API}`); process.exit(1); }
console.log(`  API: ${API} ✓ (v${health.version})`);
const uiCode = await fetch(UI).then(r => r.status).catch(() => 0);
if (uiCode !== 200) { console.error(`✗ UI not reachable at ${UI}`); process.exit(1); }
console.log(`  UI: ${UI} ✓\n`);

// ---------------------------------------------------------------------------
// Page init script — injected BEFORE any page scripts on every navigation
// ---------------------------------------------------------------------------

const CONN_CONFIG = JSON.stringify({
  connections: [{ id: 'demo-conn', name: 'local', apiUrl: API, apiKey: API_KEY }],
  activeId: 'demo-conn',
});
const USER_KEY = `swarm:v1:${API}:current-user`;

function pageInitScript({ connConfig, userKey, userId }) {
  // Auth — must be set before React reads localStorage
  try {
    localStorage.setItem('agent-swarm-connections', connConfig);
    localStorage.setItem(userKey, userId);
    localStorage.setItem('agent-swarm-mode', 'light');
  } catch { /* about:blank guard */ }

  document.documentElement.classList.remove('dark');
  document.documentElement.style.colorScheme = 'light';

  // DOM cursor SVG (matches Cursor.tsx path + hotspot offset of -8, -4)
  const SVG = `<svg width="24" height="28" viewBox="0 0 24 28" fill="none" xmlns="http://www.w3.org/2000/svg" style="filter:drop-shadow(0 1px 4px rgba(0,0,0,0.6))"><path d="M2 2L2 22L7.5 16.5L11 24L14 22.5L10.5 15L18 15L2 2Z" fill="white" stroke="#1a1a1a" stroke-width="1.5" stroke-linejoin="round"/></svg>`;

  let cX = -200, cY = -200;  // current rendered pos
  let sX = -200, sY = -200;  // tween start
  let tX = -200, tY = -200;  // tween target
  let t0 = 0, dur = 300;
  let running = false;

  function ease(t) { const c = Math.min(1, Math.max(0, t)); return 1 - Math.pow(1 - c, 3); }

  function tick(now) {
    const el = document.getElementById('rec-cursor');
    if (el) {
      const e = ease(dur > 0 ? (now - t0) / dur : 1);
      cX = sX + (tX - sX) * e;
      cY = sY + (tY - sY) * e;
      el.style.transform = `translate(${cX - 8}px,${cY - 4}px)`;
    }
    requestAnimationFrame(tick);
  }

  function inject() {
    if (!document.body || document.getElementById('rec-cursor')) return;
    const style = document.createElement('style');
    style.textContent = '* { cursor: none !important; }';
    document.head.appendChild(style);
    const el = document.createElement('div');
    el.id = 'rec-cursor';
    el.style.cssText = 'position:fixed;top:0;left:0;z-index:99999;pointer-events:none;will-change:transform;';
    el.innerHTML = SVG;
    el.style.transform = `translate(${cX - 8}px,${cY - 4}px)`;
    document.body.appendChild(el);
    const ring = document.createElement('div');
    ring.id = 'rec-cursor-ring';
    ring.style.cssText = 'position:fixed;top:0;left:0;width:48px;height:48px;border-radius:50%;border:2px solid #f59e0b;opacity:0;pointer-events:none;z-index:99998;';
    document.body.appendChild(ring);
    if (!running) { running = true; requestAnimationFrame(tick); }
  }

  document.readyState !== 'loading' ? inject() : document.addEventListener('DOMContentLoaded', inject, { once: true });
  const obs = new MutationObserver(inject);
  const startObs = () => document.body ? obs.observe(document.body, { childList: true }) : setTimeout(startObs, 10);
  startObs();

  window.__rc = {
    moveTo(x, y, d) { inject(); sX = cX; sY = cY; tX = x; tY = y; dur = d ?? 300; t0 = performance.now(); },
    setPos(x, y) {
      inject(); cX = sX = tX = x; cY = sY = tY = y; dur = 0;
      const el = document.getElementById('rec-cursor');
      if (el) el.style.transform = `translate(${x - 8}px,${y - 4}px)`;
    },
    click(x, y, d) {
      inject(); sX = cX; sY = cY; tX = x; tY = y; dur = d ?? 140; t0 = performance.now();
      setTimeout(() => {
        const r = document.getElementById('rec-cursor-ring');
        if (!r) return;
        r.style.transition = 'none';
        r.style.transform = `translate(${x - 24}px,${y - 24}px) scale(0.4)`;
        r.style.opacity = '0.85';
        r.offsetHeight;
        r.style.transition = 'transform 0.38s cubic-bezier(0.25,0.1,0.25,1),opacity 0.38s ease-out';
        r.style.transform = `translate(${x - 24}px,${y - 24}px) scale(1.9)`;
        r.style.opacity = '0';
      }, 40);
    },
  };
}

// ---------------------------------------------------------------------------
// Beat recording
// ---------------------------------------------------------------------------

async function recordBeat(label, startUrl, fn) {
  console.log(`\n🔴 [${label}]`);

  const browser = await chromium.launch({
    headless: true,
    executablePath: '/opt/playwright/chromium-1208/chrome-linux64/chrome',
    args: ['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage','--disable-extensions','--force-color-profile=srgb'],
  });
  const context = await browser.newContext({
    viewport: { width: WIDTH, height: HEIGHT },
    recordVideo: { dir: RAW_DIR, size: { width: WIDTH, height: HEIGHT } },
  });
  await context.addInitScript(pageInitScript, { connConfig: CONN_CONFIG, userKey: USER_KEY, userId: ADA_ID });

  const page    = await context.newPage();
  const events  = [];
  const t0      = Date.now();
  function track(x, y, a = 'move') { events.push({ tsMs: Date.now() - t0, x, y, action: a }); }

  // moveTo: drives DOM cursor AND real mouse (needed for hover effects / clicks)
  async function moveTo(x, y, d = 300) {
    await Promise.all([
      page.evaluate(({ x, y, d }) => { if (window.__rc) window.__rc.moveTo(x, y, d); }, { x, y, d }),
      page.mouse.move(x, y, { steps: Math.max(3, Math.ceil(d / 70)) }),
    ]);
    await sleep(d + 20);
    track(x, y);
  }

  async function click(x, y) {
    await moveTo(x, y, 240);
    await sleep(260); // cursor holds at target before click
    await page.evaluate(({ x, y }) => { if (window.__rc) window.__rc.click(x, y); }, { x, y });
    await page.mouse.click(x, y);
    track(x, y, 'click');
    await sleep(350);
  }

  // Navigate + wait for React hydration
  await page.goto(startUrl, { waitUntil: 'domcontentloaded' });
  await sleep(1200);

  // Re-enforce light theme (React may flip to dark after hydration)
  await page.evaluate(() => {
    document.documentElement.classList.remove('dark');
    document.documentElement.style.colorScheme = 'light';
    try { localStorage.setItem('agent-swarm-mode', 'light'); } catch {}
  });
  await sleep(200);

  // Place cursor at a neutral starting position
  await page.evaluate(({ x, y }) => { if (window.__rc) window.__rc.setPos(x, y); },
    { x: Math.round(WIDTH * 0.5), y: Math.round(HEIGHT * 0.5) });
  track(Math.round(WIDTH * 0.5), Math.round(HEIGHT * 0.5));

  await fn(page, moveTo, click, track);
  await sleep(400); // hold at beat end

  const videoPath = await page.video()?.path();
  await page.close();
  await context.close();
  await browser.close();
  await sleep(600);

  const dest = join(RAW_DIR, `beat-${label}.webm`);
  if (videoPath && existsSync(videoPath)) {
    if (existsSync(dest)) unlinkSync(dest);
    renameSync(videoPath, dest);
  } else {
    const ws = readdirSync(RAW_DIR)
      .filter(f => f.endsWith('.webm') && !f.startsWith('beat-'))
      .map(f => ({ f, m: statSync(join(RAW_DIR, f)).mtimeMs }))
      .sort((a, b) => b.m - a.m);
    if (ws.length) { if (existsSync(dest)) unlinkSync(dest); renameSync(join(RAW_DIR, ws[0].f), dest); }
  }

  let durationMs = Date.now() - t0;
  try {
    const d = execFileSync('ffprobe', ['-v','error','-show_entries','format=duration','-of','default=noprint_wrappers=1:nokey=1',dest]).toString().trim();
    durationMs = Math.round(parseFloat(d) * 1000);
  } catch {
    try {
      const out = execFileSync(FFMPEG, ['-v','quiet','-i',dest,'-f','null','-'],{stdio:['ignore','ignore','pipe']});
      const m = out.toString().match(/Duration:\s*(\d+):(\d+):([\d.]+)/);
      if (m) durationMs = Math.round((+m[1]*3600+m[2]*60+parseFloat(m[3]))*1000);
    } catch {}
  }

  console.log(`⏹  [${label}] ${(durationMs/1000).toFixed(2)}s — ${events.length} events`);
  return { label, webmPath: dest, events, durationMs };
}

// ---------------------------------------------------------------------------
// Beat choreographies — tight pacing targeting ~7s each / ~35s total
// ---------------------------------------------------------------------------

const beats = [];

// Beat 1: People list — establishing pan (~6s)
// Visible: 10-person grid, page heading, varied names/statuses/roles
beats.push(await recordBeat('navigate-people', `${UI}/people`, async (page, moveTo) => {
  try { await page.waitForSelector('.ag-row', { timeout: 4000 }); } catch {}
  await sleep(400);

  // Slow deliberate pan: left edge → heading centre → right
  await moveTo(Math.round(WIDTH * 0.10), Math.round(HEIGHT * 0.09), 500);
  await sleep(280);
  await moveTo(Math.round(WIDTH * 0.42), Math.round(HEIGHT * 0.09), 600);
  await sleep(360);
  await moveTo(Math.round(WIDTH * 0.72), Math.round(HEIGHT * 0.09), 500);
  await sleep(280);
  // Drop to first data row
  await moveTo(Math.round(WIDTH * 0.28), Math.round(HEIGHT * 0.25), 650);
  await sleep(380);
  await moveTo(Math.round(WIDTH * 0.52), Math.round(HEIGHT * 0.23), 450);
  await sleep(320);
}));

// Beat 2: Row scan — close-up hover (~6s)
// Visible: 3 rows highlighted with cursor sweeping name → status column
beats.push(await recordBeat('scan-list', `${UI}/people`, async (page, moveTo) => {
  try { await page.waitForSelector('.ag-row', { timeout: 4000 }); } catch {}
  await sleep(300);

  const nameX   = Math.round(WIDTH * 0.22);
  const statusX = Math.round(WIDTH * 0.58);

  for (const yFrac of [0.30, 0.38, 0.46]) {
    const rowY = Math.round(HEIGHT * yFrac);
    await moveTo(nameX, rowY, 340);
    await sleep(180);
    await moveTo(statusX, rowY, 400);
    await sleep(180);
  }
  await moveTo(Math.round(WIDTH * 0.38), Math.round(HEIGHT * 0.38), 380);
  await sleep(260);
}));

// Beat 3: Open Ada — click row → profile (~8s includes navigation wait)
// Visible: click on first row → transition → Ada Sandoval profile header
beats.push(await recordBeat('open-person', `${UI}/people`, async (page, moveTo, click) => {
  try { await page.waitForSelector('.ag-row', { timeout: 4000 }); } catch {}
  await sleep(400);

  await moveTo(Math.round(WIDTH * 0.22), Math.round(HEIGHT * 0.30), 450);
  await sleep(280);
  await click(Math.round(WIDTH * 0.22), Math.round(HEIGHT * 0.30));

  try {
    await page.waitForURL('**/people/**', { timeout: 5000 });
  } catch {
    await page.goto(`${UI}/people/${ADA_ID}`, { waitUntil: 'domcontentloaded' });
  }
  await sleep(1600);

  await page.evaluate(() => {
    document.documentElement.classList.remove('dark');
    document.documentElement.style.colorScheme = 'light';
    if (window.__rc) window.__rc.setPos(960, 300);
  });
  await sleep(200);

  // Explore profile header (name, role badge, avatar area)
  await moveTo(Math.round(WIDTH * 0.14), Math.round(HEIGHT * 0.17), 580);
  await sleep(320);
  await moveTo(Math.round(WIDTH * 0.31), Math.round(HEIGHT * 0.19), 520);
  await sleep(320);
  await moveTo(Math.round(WIDTH * 0.31), Math.round(HEIGHT * 0.27), 450);
  await sleep(380);
}));

// Beat 4: Linked identities — right-rail badges (~6s)
// Visible: 4 identity chips (Slack, GitHub, Linear, GitLab) in right column
beats.push(await recordBeat('linked-identities', `${UI}/people/${ADA_ID}`, async (page, moveTo) => {
  await sleep(1100);

  await page.evaluate(() => {
    document.documentElement.classList.remove('dark');
    document.documentElement.style.colorScheme = 'light';
  });
  await sleep(180);

  const identX = Math.round(WIDTH * 0.72);
  await moveTo(identX, Math.round(HEIGHT * 0.25), 500);
  await sleep(250);

  for (const yFrac of [0.33, 0.41, 0.49]) {
    const y = Math.round(HEIGHT * yFrac);
    await moveTo(identX, y, 360);
    await sleep(180);
    await moveTo(Math.round(WIDTH * 0.85), y, 360);
    await sleep(160);
  }
  await moveTo(Math.round(WIDTH * 0.62), Math.round(HEIGHT * 0.44), 420);
  await sleep(280);
}));

// Beat 5: Activity timeline — events feed (~7s)
// Visible: events table with 12 rows (identity_added, budget_changed, profile_changed, etc.)
beats.push(await recordBeat('activity-timeline', `${UI}/people/${ADA_ID}`, async (page, moveTo) => {
  await sleep(1100);

  await page.evaluate(() => {
    document.documentElement.classList.remove('dark');
    document.documentElement.style.colorScheme = 'light';
  });
  await sleep(180);

  await page.evaluate(() => window.scrollBy(0, 380));
  await sleep(350);

  const evtX = Math.round(WIDTH * 0.42);
  await moveTo(evtX, Math.round(HEIGHT * 0.27), 420);
  await sleep(240);

  // 3 rows × 3 moves: timestamp → event-type → source
  for (const yFrac of [0.34, 0.44, 0.54]) {
    const rowY = Math.round(HEIGHT * yFrac);
    await moveTo(Math.round(WIDTH * 0.24), rowY, 360);
    await sleep(160);
    await moveTo(evtX, rowY, 380);
    await sleep(160);
    await moveTo(Math.round(WIDTH * 0.64), rowY, 360);
    await sleep(160);
  }
  await moveTo(Math.round(WIDTH * 0.45), Math.round(HEIGHT * 0.60), 420);
  await sleep(300);
}));

// ---------------------------------------------------------------------------
// Stitch → final MP4 (no setpts speedup — native playback)
// ---------------------------------------------------------------------------

console.log(`\n🎞  Stitching ${beats.length} beats → ${FINAL_MP4}`);
const inputs  = beats.flatMap(b => ['-i', b.webmPath]);
const vParts  = beats.map((_, i) => `[${i}:v]`).join('');
execFileSync(FFMPEG, [
  '-y', ...inputs,
  '-filter_complex', `${vParts}concat=n=${beats.length}:v=1[out]`,
  '-map', '[out]', '-c:v', 'libx264', '-preset', 'fast', '-crf', '22', '-pix_fmt', 'yuv420p', '-an', FINAL_MP4,
], { stdio: 'inherit' });

const sizeMb = (statSync(FINAL_MP4).size / 1024 / 1024).toFixed(1);
console.log(`  ✓ ${FINAL_MP4} (${sizeMb} MB)`);

// ---------------------------------------------------------------------------
// Cursor track (drives zoom effect in SceneDemo — overlay retired)
// ---------------------------------------------------------------------------

const allEvents = [];
let offsetMs = 0;
for (const b of beats) {
  for (const e of b.events) allEvents.push({ ...e, tsMs: e.tsMs + offsetMs });
  offsetMs += b.durationMs;
}
writeFileSync(CURSOR_OUT, JSON.stringify({ version:'1', durationMs: offsetMs, viewport:{width:WIDTH,height:HEIGHT}, theme:'light', events: allEvents }, null, 2));
console.log(`  ✓ ${CURSOR_OUT} (${allEvents.length} events, ${(offsetMs/1000).toFixed(1)}s)`);

// ---------------------------------------------------------------------------
// Compute Remotion timing + auto-update source files
// ---------------------------------------------------------------------------

console.log('\n📊 Beat summary:');
let cumMs = 0;
const beatBounds = [];
for (const b of beats) {
  const sf = Math.round(cumMs / 1000 * FPS);
  const ef = Math.round((cumMs + b.durationMs) / 1000 * FPS);
  beatBounds.push({ label: b.label, sf, ef });
  console.log(`   [${b.label}] ${(b.durationMs/1000).toFixed(2)}s  frames=${sf}-${ef}  offset=${(cumMs/1000).toFixed(2)}s`);
  cumMs += b.durationMs;
}
const totalDemoMs     = offsetMs;
const totalDemoFrames = Math.round(totalDemoMs / 1000 * FPS);
const outroStart      = 90 + totalDemoFrames;
const totalFrames     = outroStart + 135;
console.log(`\n   Total demo: ${(totalDemoMs/1000).toFixed(2)}s = ${totalDemoFrames} frames`);
console.log(`   Total composition: ${(totalFrames/FPS).toFixed(2)}s = ${totalFrames} frames`);

// Caption copy + timing (fire 21 frames / 0.7s after beat start; end 21 frames before beat end)
const CAPTIONS = [
  'People tab — humans as first-class users',
  'Real identities, not just agent IDs',
  null,   // beat 3: navigation beat — no caption
  'Linked identities across every system',
  'Full activity timeline',
];
const lowerThirds = beatBounds
  .map((b, i) => CAPTIONS[i] ? { start: b.sf + 21, end: b.ef - 21, text: CAPTIONS[i] } : null)
  .filter(Boolean);

console.log('\n📐 Lower-thirds:');
lowerThirds.forEach(l => console.log(`   { start:${l.start}, end:${l.end}, text:"${l.text}" }`));

const VIDEO_SRC = join(__dirname, '../video-source/src');

// SceneDemo.tsx
{
  const p = join(VIDEO_SRC, 'scenes/swarm-demo/SceneDemo.tsx');
  let s = readFileSync(p, 'utf8');
  s = s.replace(/const DEMO_FRAME_COUNT = \d+;.*$/m,
    `const DEMO_FRAME_COUNT = ${totalDemoFrames}; // ${(totalDemoFrames/FPS).toFixed(1)}s @ ${FPS}fps`);
  s = s.replace(
    /interpolate\(frame,\s*\[\d+,\s*\d+\],\s*\[1,\s*0\],\s*\{\s*extrapolateLeft:\s*"clamp",\s*extrapolateRight:\s*"clamp"\s*\}\)/,
    `interpolate(frame, [${totalDemoFrames - 15}, ${totalDemoFrames}], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })`);
  const ltLines = lowerThirds
    .map(l => `  { start: ${String(l.start).padEnd(4)}, end: ${String(l.end).padEnd(4)}, text: "${l.text}" },`)
    .join('\n');
  s = s.replace(/const LOWER_THIRDS:[\s\S]*?\];/m,
    `const LOWER_THIRDS: Array<{ start: number; end: number; text: string }> = [\n${ltLines}\n];`);
  writeFileSync(p, s);
  console.log('\n✅ Updated SceneDemo.tsx');
}

// SwarmDemo.tsx
{
  const p = join(VIDEO_SRC, 'compositions/SwarmDemo.tsx');
  let s = readFileSync(p, 'utf8');
  s = s.replace(
    /<Sequence from=\{90\} durationInFrames=\{\d+\}>\s*\n\s*<SceneDemo/,
    `<Sequence from={90} durationInFrames={${totalDemoFrames}}>\n        <SceneDemo`);
  s = s.replace(
    /<Sequence from=\{\d+\} durationInFrames=\{135\}>\s*\n\s*<SceneOutro/,
    `<Sequence from={${outroStart}} durationInFrames={135}>\n        <SceneOutro`);
  writeFileSync(p, s);
  console.log('✅ Updated SwarmDemo.tsx');
}

// Root.tsx
{
  const p = join(VIDEO_SRC, 'Root.tsx');
  let s = readFileSync(p, 'utf8');
  s = s.replace(/(id="SwarmDemo"[\s\S]*?durationInFrames=\{)\d+(\})/m, `$1${totalFrames}$2`);
  writeFileSync(p, s);
  console.log('✅ Updated Root.tsx');
}

// Copy assets
const PUBLIC_MP4 = join(VIDEO_SRC, '../public/swarm-demo.mp4');
const SRC_JSON   = join(VIDEO_SRC, 'cursor-track.json');
execFileSync('cp', [FINAL_MP4, PUBLIC_MP4]);
console.log(`✅ Copied → ${PUBLIC_MP4}`);
execFileSync('cp', [CURSOR_OUT, SRC_JSON]);
console.log(`✅ Copied → ${SRC_JSON}`);

console.log('\n✅ All done! Render with:');
console.log(`   cd assets/video-source && npx remotion render src/index.ts SwarmDemo out/swarm-demo-v6.mp4`);
