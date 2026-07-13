---
date: 2026-07-13T10:00:00Z
planner: claude
topic: "Scripts-Only MCP: Per-Agent Gating + Ops-Triage Matrix Scenario"
status: completed
branch: experiment/scripts-only-mcp
pr: 969
---

# Scripts-Only MCP: Per-Agent Gating + Ops-Triage Matrix Scenario Implementation Plan

## Overview

Promote the scripts-only MCP surface from a deployment-wide env flag to a per-agent setting (global env still wins; default remains full tools), then run a second, higher-fidelity matrix scenario ("daily ops triage" with seeded fixtures and deterministic grading) across modes and harnesses — claude and codex — reusing prod codex credentials pulled into `.env.docker`.

- **Motivation**: PR #969 proved scripts-only reaches cost parity on Claude with seeds but breaks delegation fidelity on small models — the useful deployment is *mixed* (code-mode for strong agents, full tools for weak ones), which requires per-agent gating. The matrix so far only tested a delegation task; prod's dominant recurring workload (system+schedule ≈ 7K of 23.4K tasks) is read-heavy aggregation — the shape where code-mode should show an actual *win*, not parity. Prod's own `daily-blocker-digest` schedule already leans on seed scripts (`Heartbeat Audit`) to mechanize exactly these queries.
- **Related**: PR #969 (`experiment/scripts-only-mcp`), `thoughts/shared/research/2026-07-11-scripts-only-mcp-experiment.md`, `thoughts/shared/research/matrix-tools/`, `docs-site/content/docs/(documentation)/guides/scripts-only-mode.mdx`

## Current State Analysis

### The flag today (deployment-wide, two independent env reads)

- **API side**: `isScriptsOnlyMcp()` (`src/server.ts:185-187`) reads `process.env.SCRIPTS_ONLY_MCP === "true"`; `createServer(opts)` (`src/server.ts:189`) gates tool registration on `opts.scriptsOnly ?? isScriptsOnlyMcp()` (line 228). The MCP session server is constructed **per session-init** at `src/http/mcp.ts:151` with no opts — *after* `requireKnownAgent` resolved the authenticated `agentId` string at `src/http/mcp.ts:126-127`. So per-agent gating needs only one extra lookup at that call site. `src/http/mcp-bridge.ts:15` hardcodes `createServer({ scriptsOnly: false })` (the scripts-SDK bridge is deliberately full-surface) — must stay untouched.
- **Worker side**: `src/prompts/base-prompt.ts:121` reads `process.env.SCRIPTS_ONLY_MCP === "true"` directly to inject `system.agent.scripts_only_mode` (+ `.slack` variant) and suppress named-Slack-tool templates. `BasePromptArgs` (`base-prompt.ts:53-89`) has no scripts-only field; `getBasePrompt` is called only from the `buildSystemPrompt` closure in `src/commands/runner.ts:4179-4203`, which already threads `provider` the same way we need to thread this flag.
- **Divergence risk**: nothing keeps the two env reads in agreement — an agent can get a code-mode prompt with a full tool surface or vice versa.

### Existing per-agent config machinery (reuse, don't invent)

- `swarm_config` table (`src/be/migrations/001_initial.sql:246-258`): `scope IN ('global','agent','repo')` + `scopeId`, `UNIQUE(scope, scopeId, key)`, indexed on `(scope, scopeId)` (line 381).
- `PUT /api/config` (`src/http/config.ts:188`, rbac `config.write.any`, `ensureConfigAdmin` restricts bare agents to leads) upserts scoped rows; `GET /api/config/resolved` (`config.ts:110`) returns the merged view via `getResolvedConfig(agentId?, repoId?)` (`src/be/db.ts:7285-7310`, precedence repo > agent > global).
- **Precedent**: `MODEL_OVERRIDE`, `REASONING_EFFORT_OVERRIDE`, `HARNESS_PROVIDER` are stored exactly this way (scope=agent rows). Per Taras's decision, `SCRIPTS_ONLY_MCP` is set via the **config API only** — no `PATCH /api/agents/:id/runtime` extension, no migration, no new route.
- **Worker delivery channel exists**: `fetchResolvedEnv` (`src/commands/runner.ts:530-556`) already GETs `/api/config/resolved?agentId=...&includeSecrets=true` at boot (`runner.ts:4064-4085`) and periodically in the harness-reconcile loop (`runner.ts:5041-5065`), which also rebuilds `basePrompt`. A new key is returned automatically; it just isn't consumed. Note `RELOADABLE_ENV_KEYS` (`runner.ts:657-663`) deliberately excludes "coordinated values with paired state" — like `HARNESS_PROVIDER`, this flag should be threaded explicitly, not pushed into `process.env`.

### Matrix harness + codex

- `thoughts/shared/research/matrix-tools/` drives `docker-compose.scripts-only.yml` (api on host 3113, lead + analyst + marketer, `SCRIPTS_ONLY_MCP=${SCRIPTS_ONLY_MCP:-true}`, `HARNESS_PROVIDER=${MATRIX_PROVIDER:-claude}`, `MODEL_OVERRIDE=${MATRIX_MODEL:-}`), parses per-provider session logs, emits HTML reports. Purge = `down -v`; reuse images with `up -d --no-build`.
- **Codex can't run in that compose yet — but needs no new compose env for OAuth**: codex auth is file-based (`~/.codex/auth.json`), and the entrypoint's *preferred* path is OAuth restore (`docker-entrypoint.sh:126-166`): it curls `${MCP_BASE_URL}/api/config/resolved?includeSecrets=true` for the swarm-config key `codex_oauth_0` (legacy `codex_oauth`) and converts it to `auth.json` via jq, deliberately blanking the refresh token so worker CLIs can't rotate it. `MCP_BASE_URL` + `API_KEY` are already set on every compose worker, so codex enablement = seeding `codex_oauth_0` into the **local** stack's swarm_config. The `OPENAI_API_KEY` / `codex login --with-api-key` path (`docker-entrypoint.sh:170-177`) is the fallback we are NOT using (Taras: use codex OAuth). Default model `gpt-5.6-terra` (`src/providers/codex-models.ts:35`); `MODEL_OVERRIDE`/`task.model` override.
- **Prod codex config** (verified on `swarm` host): swarm_config holds `codex_oauth_0` (scope global, isSecret=1, **encrypted=1**, ~2.6KB) — raw sqlite reads give ciphertext, so the pull must go through prod's own API (`GET /api/config/resolved?includeSecrets=true`, decrypts server-side; same endpoint the entrypoint uses), authenticated with the prod `API_KEY` read from the prod api container env. 1,497 prod tasks ran `provider=codex` on gpt-5.4/5.5/5.6-sol/terra. Reuse = pull the OAuth blob into `.env.docker` as a single-line `CODEX_OAUTH=<json>` entry (never echoed to terminal; ssh output redirected straight to file), then have the matrix driver `PUT /api/config` it into the local stack as `codex_oauth_0` before workers boot.
- **Refresh-rotation caveat**: local and prod servers would both hold the same refresh token; a local server-side refresh could rotate it and stale prod's copy. Bounded risk (re-running `codex-login` re-mints), and worker-side rotation is already prevented by the entrypoint's blanked refresh token — but flag it in the run ledger if local refresh fires.
- **Gotcha**: neither compose file loads `.env.docker` (no `env_file:` — Compose reads shell env / implicit `.env`); the matrix driver must `source`/export it before `docker compose up`.
- Prod fixture shapes for the scenario: broken schedules surface as `consecutiveErrors`/`lastErrorAt`/`lastErrorMessage` on `scheduled_tasks`; failed tasks as `status='failed'` + `failureReason` (clusterable by tag/agent); stale in-flight as `status='in_progress'` with old `lastUpdatedAt`. `agent_tasks.outputSchema` exists for structured output.

### Tests to model on

- Per-agent config assertions: `src/tests/agents-harness-provider.test.ts:380+` (asserts `getSwarmConfigs({scope:"agent", scopeId})` rows).
- Registered-tool-surface assertions: `src/tests/mcp-tools.test.ts:26-45` (reaches into `server._registeredTools`).
- **Zero existing coverage** of `scriptsOnly`/`SCRIPTS_ONLY_MCP` anywhere in `src/tests/` — Phases 1–2 add the first tests for this branch's core mechanism.

## Desired End State

- One resolution function, used by both sides: **defined-and-nonempty `SCRIPTS_ONLY_MCP` env > resolved swarm_config (`repo > agent > global` scopes) > default full tools**. Setting an agent-scoped row via `PUT /api/config` flips both that agent's MCP tool surface (next session-init) and its rendered prompt (next reconcile/boot) with no env change.
- A reproducible ops-triage matrix scenario: fixture seeder (broken + healthy schedules, failed-task clusters, stale in-flight tasks, benign noise), a structured-output digest task, and a deterministic set-comparison grader.
- 8 matrix runs ({scripts-only, full-tools} × {claude, codex} × 2 reps) with an HTML comparison report and findings folded into the research doc + PR #969.
- `.env.docker` carries the prod codex OAuth blob (`CODEX_OAUTH=<json>`) for future local codex runs; the matrix driver seeds it into local swarm_config as `codex_oauth_0`.

## What We're NOT Doing

- No `PATCH /api/agents/:id/runtime` extension, no new route, no migration, no reserved-key guard for `SCRIPTS_ONLY_MCP` (config API is the surface — Taras's call).
- No UI for the flag (dashboard column/badge is a follow-up if the mode graduates).
- Not promoting the scenario to `apps/evals` — research-grade in `thoughts/matrix-tools`; promotion criteria is discrimination in this round (Taras's call).
- No pi/opencode runs this round (deepseek-class delegation failure is already characterized; codex is the new axis).
- No commits by the implementer — Taras handles commits.
- Not changing `mcp-bridge.ts` (stays full-surface) or `stdio.ts` (no agent identity at construction; keeps env-default behavior).

## Implementation Approach

- Centralize resolution in one exported helper (`resolveScriptsOnlyMode(agentId, resolvedConfigLookup)`-shaped) so API and worker share *semantics* while each side supplies its own config source (API: `getResolvedConfig(agentId)`; worker: the already-fetched resolved env). Empty-string env counts as unset (compose `${VAR:-}` pattern).
- Thread the worker-side value as an explicit `BasePromptArgs` field computed in `runner.ts` — mirror how `provider` is threaded; keep a `process.env` fallback inside `base-prompt.ts` only as a deprecation shim for direct callers/tests.
- Scenario grading via structured output: the digest task carries an `outputSchema`; the grader parses JSON and compares sets (recall on seeded defects, precision against benign noise) — no judge, no string-fishing in prose.
- Dogfood Phase 1–2 in Phase 4: at least one scripts-only run cell configured via per-agent config rows instead of the env var.
- Sequencing: per-agent gating first (Phases 1–2, it's product code on PR #969), then scenario tooling (Phase 3), then runs + report (Phase 4) — runs exercise the new gating path.

## Quick Verification Reference

- `bun test` (targeted: `bun test src/tests/mcp-tools.test.ts src/tests/scripts-*.test.ts src/tests/prompt-template-session.test.ts`)
- `bun run lint` && `bun run tsc:check`
- `bash scripts/check-db-boundary.sh` && `bun run check:dep-graph`
- Matrix stack: `docker compose -f docker-compose.scripts-only.yml up -d --no-build` / `down -v`

---

## Phase 1: Per-Agent Resolution on the API Side (MCP Tool Surface)

### Overview

`createServer` at the `/mcp` session-init call site resolves scripts-only per authenticated agent via a new shared helper; an agent with a `scope=agent SCRIPTS_ONLY_MCP=true` config row gets the 8-tool surface while its neighbor keeps 100+, with global env still winning when set.

### Changes Required:

#### 1. Shared resolution helper
**File**: `src/utils/scripts-only-mode.ts` (new)
**Changes**: Export `resolveScriptsOnlyMode(opts: { env?: string; configValue?: string }): boolean` implementing: env defined and non-empty → `env === "true"`; else configValue defined → `configValue === "true"`; else `false`. Pure function, no imports from `src/be/db` (must be importable by worker code in Phase 2 — keep it out of the db-boundary blast radius).

#### 2. API-side per-agent lookup
**File**: `src/server.ts`
**Changes**: Re-express `isScriptsOnlyMcp()` in terms of the helper (env-only, unchanged behavior for `stdio.ts`/tests). No change to `createServer`'s signature.

**File**: `src/http/mcp.ts`
**Changes**: In the session-init branch (around line 151), after `agentId` is known: look up the agent's resolved `SCRIPTS_ONLY_MCP` via `getResolvedConfig(agentId)` (API-side, `src/be/db.ts:7285`) and pass `createServer({ scriptsOnly: resolveScriptsOnlyMode({ env: process.env.SCRIPTS_ONLY_MCP, configValue }) })`. One indexed query per session-init only.

#### 3. Tests
**File**: `src/tests/scripts-only-gating.test.ts` (new)
**Changes**: Model on `src/tests/mcp-tools.test.ts:26-45` `_registeredTools` assertions + `agents-harness-provider.test.ts` config-row setup. Cases: (a) no env, no row → full surface; (b) no env, agent row `true` → exactly the 8 script tools for that agent, full surface for a second agent without the row; (c) global-scope config row `true`, no agent row → scripts-only; (d) env `true` + agent row `false` → env wins (scripts-only); (e) env `""` → treated as unset; (f) unit tests for `resolveScriptsOnlyMode` truth table; (g) bridge unaffected: `createServer({scriptsOnly:false})` full surface regardless of env/rows.

### Success Criteria:

#### Automated Verification:
- [x] New tests pass: `bun test src/tests/scripts-only-gating.test.ts` (14 pass)
- [x] Existing MCP/tool tests still pass: `bun test src/tests/mcp-tools.test.ts src/tests/scripts-mcp-e2e.test.ts` (7 pass — plan named a nonexistent `scripts-runtime-e2e.test.ts`; the real suite is `scripts-mcp-e2e.test.ts`)
- [x] Types + lint: `bun run tsc:check && bun run lint`
- [x] Boundary checks: `bash scripts/check-db-boundary.sh && bun run check:dep-graph` (0 errors; 12 pre-existing warnings)

#### Automated QA:
- [x] Against a locally running API (`bun run start:http`, fresh DB): `PUT /api/config` an agent-scoped `SCRIPTS_ONLY_MCP=true` row for a registered agent, open an MCP session as that agent (initialize + tools/list via curl or a bun script), assert exactly the 8 script tools; repeat as a second agent without the row, assert the full surface; delete the row, re-init, assert full surface again. — **QA PASS**: baseline 118/118 tools; after PUT, gated agent = exactly the 8 script tools while neighbor stays at 118 with `send-task`; after DELETE `/api/config/{id}`, gated agent back to 118.

#### Manual Verification:
- [x] None — fully automatable.

**Implementation Note**: After this phase, pause for manual confirmation. Taras handles commits.

---

## Phase 2: Per-Agent Resolution on the Worker Side (Prompt) + Docs

### Overview

The worker computes the same resolution from its env + the already-fetched resolved config and threads it into `getBasePrompt` as an explicit arg, so prompt and tool surface can no longer diverge; docs describe per-agent enablement.

### Changes Required:

#### 1. Thread the flag through the runner
**File**: `src/commands/runner.ts`
**Changes**: In the `buildSystemPrompt` closure (`~4179-4203`) and its boot/reconcile call sites, compute `scriptsOnly = resolveScriptsOnlyMode({ env: process.env.SCRIPTS_ONLY_MCP, configValue })` where `configValue` comes from the **raw `data.configs` list** returned by the resolved-config fetch (`fetchResolvedEnv`, `runner.ts:550-558` — find the `SCRIPTS_ONLY_MCP` entry), NOT from the merged env record: `fetchResolvedEnv` overlays config values onto a copy of `process.env`, so the merged record cannot distinguish "worker env var" from "config row" and would corrupt the env-wins precedence. Reconcile loop (`~5041-5065`) already rebuilds `basePrompt`, so flips propagate without new plumbing. Pass as new arg.

#### 2. Base prompt consumes the arg
**File**: `src/prompts/base-prompt.ts`
**Changes**: Add `scriptsOnly?: boolean` to `BasePromptArgs`; replace the direct env read at line 121 with `args.scriptsOnly ?? (process.env.SCRIPTS_ONLY_MCP === "true")` (shim for direct callers). All three consumption points (scripts_only_mode injection, named-Slack suppression, `.slack` variant selection) use the same resolved value.

#### 3. Tests
**File**: `src/tests/scripts-only-gating.test.ts` (extend)
**Changes**: `getBasePrompt` with `scriptsOnly: true` injects `system.agent.scripts_only_mode` and suppresses named-Slack templates; `scriptsOnly: false` with env `true` respects the arg (arg is the resolved value — runner owns precedence); slackContext + `scriptsOnly: true` selects the `.slack` variant template.

#### 4. Docs
**File**: `docs-site/content/docs/(documentation)/guides/scripts-only-mode.mdx`
**Changes**: New "Per-agent enablement" section: `PUT /api/config` example (`{scope:"agent", scopeId:"<agentId>", key:"SCRIPTS_ONLY_MCP", value:"true"}`), precedence table (env > repo > agent > global config > off), propagation semantics (tool surface: next MCP session; prompt: next reconcile/boot), and the mixed-fleet recommendation (code-mode for strong models, full surface for small ones).

**File**: `runbooks/local-development.md`
**Changes**: Update the `SCRIPTS_ONLY_MCP` env-var row to note env is the global override and per-agent rows exist.

### Success Criteria:

#### Automated Verification:
- [x] Tests pass: `bun test src/tests/scripts-only-gating.test.ts src/tests/prompt-template-session.test.ts` (41 pass)
- [x] Full suite green: `bun test` (6260 pass / 7 skip / 0 fail across 418 files)
- [x] Types + lint: `bun run tsc:check && bun run lint`
- [x] Docs build: `cd docs-site && pnpm build` (exit 0)

#### Automated QA:
- [x] Compose stack up with NO `SCRIPTS_ONLY_MCP` env on any service; set an agent-scoped row via `PUT /api/config` (api on :3113); assert from session logs that the gated agent used the script tools while an ungated one used named tools. — **Satisfied by the `claude-scripts-config-r2` matrix cell** (Phase 4): stack booted with `SCRIPTS_ONLY_MCP` empty on every service (`printenv` prints a blank line), per-agent rows set via `PUT /api/config`, and the gated lead ran `script-run` ×8 / `script-query-types` ×5 — versus `get-tasks` / `send-task` / `post-message` / `memory-search` in the full-tools cell. Recall was unaffected (7/7).

#### Manual Verification:
- [x] None — fully automatable.

**Implementation notes (actual)**: `fetchResolvedEnv` now returns `scriptsOnlyConfigValue`, read from the raw `data.configs` list *before* the merged-env overlay, preserving env-wins precedence. `applySwarmConfigDrift` takes `nextScriptsOnly` and rebuilds the system prompt when it changes (guarded so a simultaneous provider swap doesn't rebuild twice). The value is runner-local — never written to `process.env`. `SCRIPTS_ONLY_MCP` added to the `RELOADABLE_ENV_KEYS` "coordinated values" exclusion note.

**Implementation Note**: After this phase, pause for manual confirmation. Taras handles commits.

---

## Phase 3: Ops-Triage Scenario Tooling + Codex Enablement

### Overview

`thoughts/shared/research/matrix-tools/` gains a fixture seeder, a structured-output triage task, and a deterministic grader; codex workers boot via the entrypoint's OAuth-restore path; `.env.docker` holds the prod codex OAuth blob (`CODEX_OAUTH`).

### Changes Required:

#### 1. Codex enablement (OAuth restore path — per Taras's review)
**File**: `.env.docker`
**Changes**: Add single-line `CODEX_OAUTH=<json>` pulled from prod's `GET /api/config/resolved?includeSecrets=true` (key `codex_oauth_0`; the prod row is encrypted so a raw sqlite read won't do — curl prod's API from the `swarm` host using the prod api container's `API_KEY`, output redirected straight into the file, value never echoed to terminal/logs). Keep `HARNESS_PROVIDER` line untouched. Precondition: `git check-ignore .env.docker` passes — if not ignored, STOP and ask.

**File**: `docker-compose.scripts-only.yml`
**Changes**: Nothing for auth — the entrypoint's OAuth-restore branch (`docker-entrypoint.sh:126-166`) already curls the local API (`MCP_BASE_URL` + `API_KEY`, both set on every worker service) for `codex_oauth_0` at boot. NOT adding `OPENAI_API_KEY` (API-key login is the fallback path we're skipping). **Required for the no-flag boot (review finding)**: flip the default on all 4 services from `SCRIPTS_ONLY_MCP=${SCRIPTS_ONLY_MCP:-true}` to `SCRIPTS_ONLY_MCP=${SCRIPTS_ONLY_MCP:-}` — `:-` substitutes `true` when the shell var is unset *or empty*, which made "boot with no flag" (Phase 2 QA, Phase 4 per-agent cell, Manual E2E step 1) impossible. Empty is treated as unset by the Phase 1 helper, so scripts-only-via-env cells now pass `SCRIPTS_ONLY_MCP=true` explicitly (matrix driver sets it per cell), and the bare default becomes full tools — matching the product's backward-compat default.

**File**: `thoughts/shared/research/matrix-tools/matrix-drive2.sh` (or a new `matrix-drive3.sh`)
**Changes**: Source `.env.docker` without echoing values (`set -a; source; set +a`); accept cell params `MODE={scripts,full}`, `PROVIDER={claude,codex}` (codex ⇒ `MATRIX_PROVIDER=codex`, model left default `gpt-5.6-terra`). For codex cells, boot ordering matters: `up -d api` → wait healthy → `PUT /api/config {scope:"global", key:"codex_oauth_0", value:$CODEX_OAUTH, isSecret:true}` → `up -d` the workers, so the entrypoint restore finds the row at boot. (If a worker boots early, the runner's credential-wait loop parks it until the row appears — acceptable fallback, but seed-first is deterministic.) Note: the local stack has no `SECRETS_ENCRYPTION_KEY`, so the seeded blob sits plaintext in the local DB — acceptable because every run ends in `down -v` (volume purged); the durable copy lives only in gitignored `.env.docker`.

#### 2. Fixture seeder
**File**: `thoughts/shared/research/matrix-tools/triage-fixtures.ts` (new, `@ts-nocheck` header like siblings)
**Changes**: Seeds via `docker compose exec api bun -e '<bun:sqlite inserts>'` (fixtures need states unreachable through the API: `consecutiveErrors`, old `lastUpdatedAt`, terminal `failed` rows). Fixtures with grep-proof unique tokens:
- 3 broken schedules: names `fx-sched-{alpha,bravo,charlie}`, `enabled=1`, `consecutiveErrors ∈ {3,5,7}`, `lastErrorMessage` embedding tokens `FX-ERR-{1101,1102,1103}`.
- 2 healthy schedules (benign noise): `fx-sched-{delta,echo}`, `consecutiveErrors=0`.
- 5 failed tasks in 2 clusters: cluster A (3 tasks, `failureReason` embedding `FX-CLUSTER-A-7731`, same tag), cluster B (2 tasks, `FX-CLUSTER-B-7732`); plus 4 completed tasks (noise).
- 2 stale in-progress tasks: ids recorded, `lastUpdatedAt` set 4h back; plus 1 fresh in-progress task (noise, updated now).
- Prints a `fixtures.json` manifest (expected sets) for the grader.

#### 3. Codex tool-naming check for the scripts-only template
**File**: `src/prompts/session-templates.ts` (`system.agent.scripts_only_mode`) — verify, change only if needed
**Changes**: The template's "exact prefixed tool ids" guidance says `mcp__agent-swarm__script-run` — that's Claude Code's MCP naming. Before the codex/scripts cells, verify how the swarm MCP tools are named inside a codex session (session log or a one-off probe task) and, if the prefix differs, make the tool-id line provider-aware (template var) or provider-neutral ("the script-run tool on the agent-swarm MCP server"). Round 1 showed wrong tool-id guidance directly causes bare-name call errors — don't let the template sabotage the codex cells.

#### 4. Triage task + grader
**File**: `thoughts/shared/research/matrix-tools/triage-task.md` (new)
**Changes**: Lead-addressed task modeled on prod `daily-blocker-digest`, simplified: inspect schedules, recent failed tasks (cluster by failureReason/tag), and stale in-flight tasks (>2h since update); verify before reporting; produce JSON exactly matching the outputSchema: `{ brokenSchedules: string[], failureClusters: [{token, count}], staleTaskIds: string[], healthySchedules: string[], verdict: "OK"|"WATCH"|"ALERT" }`. Sent with `outputSchema` attached (`agent_tasks.outputSchema` column; POST /api/tasks supports it — verify at implementation, else instruct JSON-only output in prose).

**File**: `thoughts/shared/research/matrix-tools/triage-grade.ts` (new)
**Changes**: Reads lead task output via API :3113 + `fixtures.json`; parses JSON (tolerating fenced code blocks); scores deterministically — recall: all 3 broken schedule names, both cluster tokens with correct counts, both stale ids; precision: no healthy schedule in `brokenSchedules`, no fresh task in `staleTaskIds`, verdict ≠ "OK" (defects exist). Emits per-run score `{recall: x/7, precisionViolations: n, pass: recall==7 && violations==0}` plus the usual cost/time/context/tool-call metrics via existing session-log parsers.

#### 5. Runner integration
**File**: `thoughts/shared/research/matrix-tools/matrix-run.ts`
**Changes**: Add `--scenario triage` path: boot stack → wait ready → seed catalog scripts (existing) → run `triage-fixtures.ts` → send triage task to lead → poll to terminal → `triage-grade.ts` → collect metrics → `down -v`.

### Success Criteria:

#### Automated Verification:
- [x] `bun run tsc:check` still green (new files carry `@ts-nocheck` like existing matrix-tools) and `bun run lint` passes
- [x] Seeder dry-run against a fresh stack: `bun thoughts/shared/research/matrix-tools/triage-fixtures.ts && docker compose -f docker-compose.scripts-only.yml exec api bun -e "<count fixture rows>"` returns expected counts (3 broken / 2 healthy schedules, 5 failed / 4 completed tasks, 2 stale / 1 fresh in-progress) — **all exact**, and re-verified after 4 minutes of live agents + live scheduler: fixtures unchanged, 0 noise tasks leaked in, 0 schedules due, 0 pending fixture rows
- [x] Grader unit check: `bun triage-grade.ts --self-test` against two synthetic outputs (one perfect, one with a miss + a noise violation) produces `pass:true` / `pass:false` respectively

#### Automated QA:
- [x] One end-to-end smoke cell (claude, scripts-only): full `matrix-run.ts --scenario triage` cycle completes, grader emits a score, stack tears down clean — superseded by the full 8-cell run

#### Manual Verification:
- [x] Taras eyeballs the triage-task prompt + fixture design once before the paid runs (fixture realism is judgment, not automation) — approved 2026-07-13

### Fixture-integrity bugs found and fixed during implementation

Four live subsystems would have eaten the fixtures mid-run; all four are now neutralized (verified empirically — see the seeder dry-run above).

0. **Live workers claimed and completed the in-flight fixtures.** The first dry-run seeded the 3 `in_progress` tasks against `lead`/`analyst` on the assumption that "only `pending` tasks get claimed". Wrong: a worker's **crash-recovery path resumes `in_progress` tasks assigned to itself**, and the lead worker duly picked up both stale fixtures and the fresh one and drove them to `completed` within ~2 minutes — recall would have been 5/7 on every cell, for reasons having nothing to do with the model. **Fix**: the seeder now inserts a registered-but-never-booted agent row (`fx-ghost-worker`, `7a1e...00ff`, status `offline`) and assigns all three in-flight fixtures to it. Nothing polls for the ghost, so its tasks stay parked; they remain fully visible to the triage agent through the API.
1. **Scheduler would execute the fixture schedules.** `startScheduler` ticks every 10s (`src/http/index.ts:609`) and `getDueSchedules` (`src/be/db.ts:6850`) selects `enabled = 1 AND nextRunAt <= now`. The seeder originally wrote `nextRunAt = now`, so all 5 fixture schedules would have fired immediately — running `taskTemplate` `{}`, resetting `consecutiveErrors`, and injecting real tasks into the graded run. **Fix**: `nextRunAt` parked 30 days out; `enabled=1` preserved (that is the signal the agent must notice).
2. **Heartbeat reaper would supersede the stale-task fixtures.** `detectAndRemediateStalledTasks` (`src/heartbeat/heartbeat.ts:282`) Case A supersedes/fails any `in_progress` task with no active session older than `STALL_THRESHOLD_NO_SESSION_MIN` (5 min) and spawns a "resume" follow-up. Our stale fixtures are 4h old → they'd be destroyed within one 90s sweep and replaced with noise tasks. **Fix**: `HEARTBEAT_DISABLE=${HEARTBEAT_DISABLE:-true}` on the matrix compose's `api` service.
3. **Settle loop could never converge.** `matrix-run.ts` waits for zero non-terminal tasks; the 3 fixture `in_progress` rows are permanently non-terminal, so every triage cell would have burned the full 10-minute settle cap (~80 min across 8 runs). **Fix**: the open-task filter now ignores rows tagged `matrix-triage-fixture`.

Also: grader now coerces `failureClusters[].count` with `Number()` (a model answering `"count": "3"` got the answer right — grading it as a miss would measure JSON-typing pedantry, not triage recall), and the stray `@ts-nocheck` HTML comment was stripped from `triage-task.md` (it is sent verbatim as the agent's task text).

Phase 3 §3 (codex tool-naming) needed **no change**: `system.agent.scripts_only_mode` already hedges — "your harness may expose them under a prefix, e.g. `mcp__agent-swarm__script-run` — use the exact registered tool id".

**Implementation Note**: After this phase, pause for manual confirmation. Taras handles commits. `.env.docker` is gitignored — verify before writing the key (`git check-ignore .env.docker`); if not ignored, STOP and ask.

---

## Phase 4: Run the 8-Cell Matrix + Report

### Overview

Eight graded runs ({scripts-only, full} × {claude, codex} × 2 reps) with DB purges between, at least one scripts-only cell driven by per-agent config rows (dogfooding Phases 1–2), producing an HTML comparison report and updated findings on the research doc + PR #969.

### Changes Required:

#### 1. Runs
**Files**: none (execution) — run ledger appended to `thoughts/shared/research/2026-07-11-scripts-only-mcp-experiment.md`
**Changes**: Execute cells in order claude/full ×2, claude/scripts ×2 (one rep via env, one rep via per-agent config rows with env unset), codex/full ×2, codex/scripts ×2. `down -v` purge between every run; images reused (`up -d --no-build` — no rebuilds unless Phase 1–3 changed `src/`, which they did: exactly ONE rebuild of the worker+api images before run 1, per Taras's storage constraint).

#### 2. Report
**File**: `thoughts/shared/research/2026-07-13-ops-triage-matrix-report.html` (new)
**Changes**: Chart.js self-contained report like the previous two: grade (recall/precision/pass) per cell, cost, wall time, lead context tokens, tool-call counts, per-run notes; a claude-vs-codex and scripts-vs-full analysis section; explicit comparison to round-1 findings (does aggregation show the predicted code-mode win?).

#### 3. Findings + PR
**File**: `thoughts/shared/research/2026-07-11-scripts-only-mcp-experiment.md`
**Changes**: Phase-3 section: table of 8 runs, verdict on the aggregation hypothesis, codex-in-code-mode assessment, per-agent-gating E2E note.

**File**: PR #969
**Changes**: Comment summarizing per-agent gating + round-2 results; update PR description's findings section.

### Success Criteria:

### Run ledger (final — 8/8 cells graded)

| cell | mode | recall | viol | pass | cost | wall | context tokens |
|---|---|---|---|---|---|---|---|
| claude-full-r1 | full tools | 7/7 | 0 | yes | $0.61 | 2.0 min | 289,252 |
| claude-full-r2 | full tools | 7/7 | 0 | yes | $0.44 | 1.3 min | 160,124 |
| claude-scripts-only-r1 | scripts-only (env) | 7/7 | 0 | yes | $0.65 | 2.0 min | 271,485 |
| claude-scripts-config-r2 | scripts-only (per-agent config rows) | 7/7 | 0 | yes | $1.06 | 3.0 min | 759,438 |
| codex-full-r1b | full tools | 7/7 | 0 | yes | $0.35 | 1.0 min | 931,174 |
| codex-full-r2 | full tools | 7/7 | 0 | yes | $0.41 | 1.7 min | 1,217,533 |
| codex-scripts-only-r1 | scripts-only (env) | **5/7** | 0 | **no** | $0.76 | 2.3 min | 2,319,956 |
| codex-scripts-only-r2 | scripts-only (env) | 7/7 | 0 | yes | $1.12 | 2.0 min | 2,743,210 |

(`codex-full-r1` hit a BOOT_TIMEOUT — infrastructure, not a result — and was re-run as `r1b`. The first pass of all
four codex cells failed at $0 on a `.env.docker` quoting bug; see the research doc's "Infrastructure findings".)

**Verdict: the aggregation hypothesis does not hold.** Code-mode loses on every axis, on both harnesses — cost
(1.6× worse on claude, 2.5× on codex), wall time (~1.5×), context (2.3×: claude 515K vs 225K, codex 2.53M vs 1.07M),
and it is the *only* config that lost recall (codex/scripts-only r1 surfaced zero stale in-flight tasks). Round 2 was
designed to give code-mode its best case (read-heavy aggregation) and it still lost, reproducing round 1's direction
on a different task shape and a second harness. The scenario does not discriminate on quality among full-tools cells
(all 7/7), so it is a cost/context probe, not a capability probe.

**Per-agent gating is validated E2E** and independently useful: the config-driven cell ran `script-run` ×8 /
`script-query-types` ×5 with the worker's `SCRIPTS_ONLY_MCP` env empty, while its neighbors kept the full surface.

#### Automated Verification:
- [x] All 8 runs reached a terminal state and produced a grader score (run ledger lists 8 rows, no `status:error` cells)
- [x] Merge-gate checklist green on the final branch state: `bun install --frozen-lockfile && bun run lint && bun run tsc:check && bun test && bash scripts/check-db-boundary.sh && bun run check:dep-graph` — all green (6260 pass / 7 skip / 0 fail; dep-graph 0 errors; api-key-boundary also green)

#### Automated QA:
- [x] The per-agent-config rep's session logs confirm the gating path: scripts-only tool usage + scripts-only prompt section present with the worker container's `SCRIPTS_ONLY_MCP` env **empty** — confirmed: `printenv SCRIPTS_ONLY_MCP` prints an empty line, and the config cell's lead used `script-run` ×8 / `script-query-types` ×5 vs `get-tasks`/`send-task`/`post-message`/`memory-search` in the full cell
- [x] HTML report renders and every chart is populated from the 8-run dataset — `thoughts/shared/research/2026-07-13-ops-triage-matrix-report.html`

#### Manual Verification:
- [ ] Taras reviews the report + verdict and decides follow-ups (evals promotion, UI badge, prod trial) — **open**

**Implementation Note**: After this phase, pause for manual confirmation. Taras handles commits.

---

## Manual E2E

Commands to verify the feature end-to-end against the local compose stack (api host port **3113**):

```bash
# 0. One-time: rebuild images with Phase 1-3 code (single rebuild, storage constraint)
docker compose -f docker-compose.scripts-only.yml build

# 1. Boot with NO global flag (works only after the Phase 3 compose-default fix: ${SCRIPTS_ONLY_MCP:-})
SCRIPTS_ONLY_MCP= docker compose -f docker-compose.scripts-only.yml up -d --no-build

# 2. Flip ONE agent to scripts-only via config API (analyst = 7a1e0000-...-0002)
curl -s -X PUT http://localhost:3113/api/config \
  -H "Authorization: Bearer 123123" -H "Content-Type: application/json" \
  -d '{"scope":"agent","scopeId":"7a1e0000-0000-0000-0000-000000000002","key":"SCRIPTS_ONLY_MCP","value":"true"}'

# 3. Verify resolved view
curl -s "http://localhost:3113/api/config/resolved?agentId=7a1e0000-0000-0000-0000-000000000002" \
  -H "Authorization: Bearer 123123" | grep SCRIPTS_ONLY_MCP

# 4. Send one task to analyst, one to marketer; then inspect sessions:
#    analyst session log shows mcp__agent-swarm__script-run + scripts-only prompt section;
#    marketer session shows named tools, no scripts-only section.

# 5. Scenario smoke (one cell, claude/scripts-only):
bun thoughts/shared/research/matrix-tools/matrix-run.ts --scenario triage --mode scripts --provider claude

# 6. Codex smoke (OAuth restore materialization):
set -a; source .env.docker; set +a   # loads CODEX_OAUTH without echoing
MATRIX_PROVIDER=codex docker compose -f docker-compose.scripts-only.yml up -d --no-build api
# wait for api health, then seed the OAuth blob (value comes from env, not typed):
curl -s -X PUT http://localhost:3113/api/config \
  -H "Authorization: Bearer 123123" -H "Content-Type: application/json" \
  -d "{\"scope\":\"global\",\"key\":\"codex_oauth_0\",\"value\":$(printf %s "$CODEX_OAUTH" | jq -Rs .),\"isSecret\":true}" > /dev/null
MATRIX_PROVIDER=codex docker compose -f docker-compose.scripts-only.yml up -d --no-build
docker compose -f docker-compose.scripts-only.yml logs analyst-worker | grep -i "oauth\|auth.json"

# 7. Full matrix + report (Phase 4)
bun thoughts/shared/research/matrix-tools/matrix-run.ts --scenario triage --matrix
open thoughts/shared/research/2026-07-13-ops-triage-matrix-report.html
```

---

## Appendix

- **Follow-up plans**: evals promotion of the delegation-fidelity + triage-recall checks (blocked on Phase 4 discrimination read); UI badge/toggle for the per-agent flag; typed returns in `swarm-sdk.d.ts` (attacks the envelope-guessing failure mode directly).
- **Derail notes**:
  - `requireKnownAgent` fetches the agent row and throws it away (`src/http/mcp.ts:70-75`) — fine here (flag lives in swarm_config, not agents), but worth a cleanup someday.
  - `base-prompt.ts` reading `process.env` directly is a pattern worth auditing beyond this flag.
  - Prod's `daily-blocker-digest` hardcodes Slack channel/user ids in the template — if the triage scenario graduates to evals, strip those.
  - `.env.docker` is consumed by `docker run --env-file` flows but NOT by compose — recurring confusion; consider adding `env_file:` to the local compose files in a separate PR.
- **References**:
  - Research: `thoughts/shared/research/2026-07-11-scripts-only-mcp-experiment.md`
  - PR: https://github.com/desplega-ai/agent-swarm/pull/969
  - Prod evidence: `daily-blocker-digest` schedule template; `agent_tasks.provider` histogram (claude 11,506 / codex 1,497 / pi 154 / opencode 53)
  - Docs: `docs-site/content/docs/(documentation)/guides/scripts-only-mode.mdx`, `runbooks/model-tiers.md`, `runbooks/harness-providers.md`

## Review Errata

_Reviewed: 2026-07-13 by claude (gap analysis), output mode: auto-apply_

### Applied
- [x] **Critical** — compose `${SCRIPTS_ONLY_MCP:-true}` default made "boot with no flag" impossible (`:-` substitutes on unset *or empty*); plan now flips the default to `${SCRIPTS_ONLY_MCP:-}` on all 4 services and has env-driven cells pass `true` explicitly (Phase 3 §1, Manual E2E step 1) — auto-applied with Taras's approval
- [x] **Important** — Phase 2 read `configValue` from the merged env record, which cannot distinguish worker-env from config-row (`fetchResolvedEnv` overlays configs onto `process.env`); now specified to read the raw `data.configs` list — auto-applied
- [x] **Important** — Phase 4 QA asserted `SCRIPTS_ONLY_MCP` env *absent* from the worker; after the compose fix the var exists but empty; check rewritten to assert empty value — auto-applied
- [x] **Important** — `system.agent.scripts_only_mode` hardcodes Claude Code tool naming (`mcp__agent-swarm__…`); codex sessions may name MCP tools differently, and round 1 proved wrong tool-id guidance causes bare-name call errors; added Phase 3 §3 verification step — auto-applied
- [x] **Minor** — frontmatter lacked `planner` field — auto-fixed
- [x] **Minor** — noted that the local stack stores the seeded codex OAuth blob plaintext (no `SECRETS_ENCRYPTION_KEY`), bounded by `down -v` purges — auto-fixed

### Remaining
- (none)
