  1  # Weekly Evals Research — Agent-Swarm Eval Framework
  2  
  3  **Author:** Researcher · **Date:** 2026-06-29 · **Task:** 30dc6e20  
  4  **Requested by:** Taras (CTO) · **Prior work:** PR #86 (Feb 2026, context-evals research)
  5  
  6  ---
  7  
  8  ## 1. Current Eval Framework Setup
  9  
 10  ### Architecture
 11  
 12  The eval framework lives in `evals/` as its own Bun package (`@agent-swarm/evals`, v0.1.0). It is a **scenario × harness-config matrix runner** that spins up real swarm stacks in **E2B cloud sandboxes**, executes tasks against them, and grades outcomes with deterministic checks + LLM/agentic judges.
 13  
 14  **Key files:**
 15  
 16  | Path | Purpose |
 17  |---|---|
 18  | `evals/src/cli.ts` | CLI entry — `run`, `resume`, `list`, `show`, `serve`, `registry` |
 19  | `evals/src/runner/index.ts` | Core runner (~2016 lines) — boots sandboxes, seeds, executes, grades |
 20  | `evals/src/scoring.ts` | Scoring engine — weighted mean dimensions, gates, pass threshold (0.75) |
 21  | `evals/src/types.ts` | All types — Scenario, HarnessConfig, OutcomeSpec v2, DimensionSpec, etc. |
 22  | `evals/src/registry.ts` | Shape-validates scenarios + configs at load time |
 23  | `evals/src/results.ts` | Run summarization — mean ± bootstrap CI, Wilson pass-rate |
 24  | `evals/src/stats.ts` | Bootstrap CI, Wilson interval, bootstrapDiffCI |
 25  | `evals/src/judge/` | Deterministic checks, LLM judge, agentic judge, session-log parsing |
 26  | `evals/src/db/` | Turso embedded replica (libsql) — local WAL synced to remote primary |
 27  | `evals/src/api/` | API server + analytics aggregation for the serve UI |
 28  | `evals/configs/` | Harness configs (60+ entries), presets, AA benchmarks |
 29  | `evals/scenarios/` | Scenario definitions + fixtures |
 30  | `evals/scripts/calibration-report.ts` | Ship-gate report (frontier−budget gap ≥ 0.2) |
 31  | `evals/docs/calibration.md` | Calibration sweep recipe + recorded baselines |
 32  | `evals/ui/` | React SPA dashboard (Vite, port 4801) |
 33  | `evals/SCENARIO-AUTHORING.md` | Durable rulebook for scenario design (OutcomeSpec v2, 5 rules, etc.) |
 34  
 35  ### What evals exist today
 36  
 37  **6 active scenarios** (round-11 catalog, after the swarm-redesign prune):
 38  
 39  | Scenario | What it proves | Workers | Embedding key? |
 40  |---|---|---|---|
 41  | `sql-audit` | sqlDump seed import + agent consuming seeded API history | 1 | No |
 42  | `memory-distractor` | Seeded truth vs in-prompt wrong default; judge grades "retrieved, not guessed" | 1 | Yes |
 43  | `bug-ladder` | Build → verify/fix dependency chain, deterministic compile-grade check | 1 | No |
 44  | `relay-pipeline` | Cross-worker handoff through swarm memory (dependsOn × workers) | 2 | Yes |
 45  | `distributed-audit` | Deep multi-worker audit scenario | 2+ | No |
 46  | `delegation-probe` | Lead delegation behavior — the canonical worked example for rubric design | 2+ lead | No |
 47  
 48  **Pruned scenarios** (non-discriminators): `memory-coordination`, `failure-recovery`, `failure-recovery-mixed`, `cross-worker-invent`, `plan-implement-review`. Historical runs still render in the UI.
 49  
 50  ### Harness configs (60+ entries across 4 providers)
 51  
 52  | Provider | Count | Examples |
 53  |---|---|---|
 54  | `claude` | 7 | haiku, sonnet, opus (latest, 4.6, 4.7, 4.8), fable |
 55  | `pi` (pi-mono) | 28 | deepseek flash/pro, gemini flash/pro, glm, qwen, kimi, minimax, grok, mistral, etc. |
 56  | `opencode` | 23 | mirrors pi configs across opencode harness |
 57  | `codex` | 3 | gpt-5.4-mini, gpt-5.4, gpt-5.5 |
 58  
 59  **5 presets** for quick selection: `frontier`, `challengers`, `oss`, `claude-family`, `budget`.
 60  
 61  ### How evals are run
 62  
 63  ```bash
 64  cd evals && bun install
 65  bun src/cli.ts registry                    # validate & list everything
 66  bun src/cli.ts run --scenarios X --configs Y --attempts N --concurrency C
 67  bun src/cli.ts resume <runId>              # continue interrupted runs
 68  bun src/cli.ts show <runId>                # terminal result matrix
 69  bun src/cli.ts serve                       # UI dashboard on :4801
 70  bun scripts/calibration-report.ts <runId>  # ship-gate report
 71  ```
 72  
 73  ### What they measure
 74  
 75  - **Correctness/completeness** (deterministic checks on task output, file contents, API state)
 76  - **Behavioral quality** (delegation patterns, cross-worker handoff, memory retrieval fidelity)
 77  - **Efficiency** (cost/duration vs budget — waste-guard, not discriminator)
 78  - **Discrimination** — frontier vs budget gap ≥ 0.2 is the ship gate
 79  
 80  ### Scoring model
 81  
 82  ```
 83  score = Σ(wᵢ · dimᵢ) / Σ wᵢ     # weighted mean over dimensions
 84  passed = allGatesPass && score >= 0.75
 85  ```
 86  
 87  Headline per cell: **mean dimension-score ± bootstrap CI** with **Wilson pass-rate** companion. The ✓/~/✗ indicator compares the threshold against the CI. `n` (attempts) is a confidence dial.
 88  
 89  ### Results storage
 90  
 91  **Turso database** `swarm-evals-local` via libsql embedded replica (`evals/evals-replica.db`, gitignored). Writes forward synchronously to the remote Turso primary. No `EVALS_DB_SYNC_URL` → fails explicitly (no silent empty DB).
 92  
 93  ### CI integration
 94  
 95  The merge-gate already runs eval **unit tests** (pure, no E2B, ~0.5s):
 96  - `bun install --frozen-lockfile` in `evals/`
 97  - `bun run tsc:check` (typecheck scenarios + UI)
 98  - `bun test` (scoring, registry, normalize, scenario structure tests — 35 test files)
 99  - `bun run ui:build` (build the UI)
100  
101  These are **not** live eval runs — they validate the framework code itself. No E2B sandboxes are created in CI today.
102  
103  ### Env requirements for live runs
104  
105  | Var | Purpose | Cost implication |
106  |---|---|---|
107  | `E2B_API_KEY` | Sandbox creation | ~$0.10-0.50/attempt (sandbox compute) |
108  | `OPENROUTER_API_KEY` | Judge LLM + pi/opencode workers | Per-token costs |
109  | `CLAUDE_CODE_OAUTH_TOKEN` or `ANTHROPIC_API_KEY` | Claude workers | Per-token |
110  | `OPENAI_API_KEY` | Codex workers | Per-token |
111  | `EMBEDDING_API_KEY` | Memory seeding | Tiny per-embed |
112  | `EVALS_DB_SYNC_URL` + `EVALS_DB_AUTH_TOKEN` | Turso replica | Free tier |
113  
114  ---
115  
116  ## 2. Existing Automation Around Evals
117  
118  ### Critical distinction: the eval FRAMEWORK vs the swarm's eval DASHBOARD
119  
120  These are **two separate systems** that share the word "eval":
121  
122  | | Eval Framework (`evals/`) | Swarm Eval Dashboard |
123  |---|---|---|
124  | **What** | Code-level scenario × config matrix runner on E2B | Operational metrics dashboard (memory quality, script usage, cost, context) |
125  | **Where** | `evals/` subpackage, Turso DB | Swarm scripts + KV store + swarm Page |
126  | **Runs on** | Local machine or CI (E2B sandboxes) | Swarm schedules (daily, Jackknife/Picateclas) |
127  | **Measures** | Model/harness capability (pass rate, discrimination) | Swarm operational health (memory quality axes, cost trends, script adoption) |
128  | **Cost** | $35-100 per full sweep (72 attempts) | Free (reads swarm DB, no E2B) |
129  
130  ### Existing swarm-side automation (the dashboard pipeline)
131  
132  1. **`memory-eval-daily`** — schedule (Jackknife, 06:17 UTC)
133     - 3-axis memory quality evaluation: carry-forward context, preference adherence, freshness
134     - Writes results to KV for trend tracking
135     - Deterministic metrics only
136  
137  2. **`render-unified-swarm-eval-dashboard`** — global script
138     - Renders a unified dashboard page with deterministic charts
139     - Covers: memory axes (grouped bar), script usage (stacked), cost charts with tasks-processed overlay, date-range controls
140     - Page: `0d1bbbe340c53a5c25b88a0ae4bdee38` (slug `swarm-eval-dashboard`)
141  
142  3. **`swarm-eval-dashboard-daily`** — schedule (status: pending wiring per memory `b0fa8365`)
143     - Intended to run the renderer daily at ~07:15 UTC (Picateclas)
144     - **Option A** (Taras-picked): keep `memory-eval-daily` as thin data feeder, replace `script-nudges-eval-dashboard-daily` with this new job
145  
146  4. **`daily-cost-engagement-snapshot`** — global script
147     - Separate cost & engagement telemetry page with Chart.js interactive charts
148  
149  ### What's NOT automated
150  
151  The `evals/` **code-level eval framework has ZERO automation today.** Every eval run is manual:
152  - A human runs `bun src/cli.ts run ...` from their local machine
153  - Results go to Turso, viewable via `bun src/cli.ts serve`
154  - No scheduled runs, no GH Action, no swarm schedule
155  - The calibration sweep (`docs/calibration.md`) is a manual recipe
156  
157  ---
158  
159  ## 3. Weekly Eval Options
160  
161  ### Option A: GitHub Action (cron workflow)
162  
163  **How:** A new `.github/workflows/eval-weekly.yml` with `schedule: cron: '0 6 * * 0'` (Sunday 06:00 UTC).
164  
165  ```yaml
166  name: Weekly Eval Sweep
167  on:
168    schedule:
169      - cron: '0 6 * * 0'  # Sunday 06:00 UTC
170    workflow_dispatch:       # manual trigger
171  jobs:
172    eval-sweep:
173      runs-on: ubuntu-latest
174      timeout-minutes: 120   # full sweep can take 1-2h
175      steps:
176        - uses: actions/checkout@v5
177        - uses: oven-sh/setup-bun@v2
178        - run: cd evals && bun install --frozen-lockfile
179        - run: cd evals && bun src/cli.ts run \
180            --name "weekly-$(date +%Y%m%d)" \
181            --scenarios sql-audit,memory-distractor,bug-ladder \
182            --configs claude-haiku,pi-deepseek-flash,claude-sonnet \
183            --attempts 2 --concurrency 2
184        # Post results to Slack / PR comment / artifact
185  ```
186  
187  **Pros:**
188  - Familiar CI pattern, version-controlled trigger definition
189  - `workflow_dispatch` for manual ad-hoc runs
190  - Results can be posted as GH artifacts, Slack webhook, or commit
191  - Free GH Actions minutes on public repos (or uses org's pool)
192  - No swarm dependency — runs independently
193  
194  **Cons:**
195  - **Secrets management:** needs E2B_API_KEY, OPENROUTER_API_KEY, CLAUDE_CODE_OAUTH_TOKEN, EMBEDDING_API_KEY, EVALS_DB_SYNC_URL, EVALS_DB_AUTH_TOKEN as GH secrets
196  - **Cost:** GH runners are modest hardware; E2B sandboxes are the real cost ($35-100/full sweep)
197  - **Results surfacing:** no built-in dashboard — would need to post to Slack, commit a report, or upload artifacts
198  - **DB access:** needs Turso credentials to persist results where the `serve` UI can read them
199  - **Timeout risk:** full 6-scenario × 4-anchor × 3-attempt sweep could exceed the 2h GH Actions timeout
200  - **No live UI:** can't attach the `serve` dashboard to a GH Action run
