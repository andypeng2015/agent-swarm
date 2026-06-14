---
date: 2026-06-13T00:00:00Z
author: Claude
topic: "Evals v8.0 (round 11) — OutcomeSpec v2: gates + weighted graded dimensions"
tags: [qa, evals, scoring, outcomespec, round-11]
status: pass
source_plan: thoughts/taras/plans/2026-06-13-evals-v8-0-round11-outcomespec-v2-spec.md
related_pr: 737
environment: local
last_updated: 2026-06-13
last_updated_by: Claude
---

# Evals v8.0 (round 11) — OutcomeSpec v2 — QA Report

## Context

QA of the working-tree (uncommitted) implementation of the OutcomeSpec-v2 grading overhaul described in
`thoughts/taras/plans/2026-06-13-evals-v8-0-round11-outcomespec-v2-spec.md` (PR #737, branch
`feat/evals-subproject`). The plan's status was `implemented (working tree, uncommitted, pre-calibration-sweep)`.

Method: **autopilot**. Two-layer verification — (1) ran every local gate the plan lists, (2) fanned out a
10-agent adversarial verification (one per plan phase + a cross-cutting invariants checker + a test-honesty
checker), each reading the on-disk code and checking each phase's specific claims with `file:line` evidence.

## Scope

### In Scope
- All 8 phases' code-level claims (types/normalizer, DB migration, runner aggregation, agentic judge,
  efficiency, catalog swap, UI, calibration scaffolding).
- The plan's back-compat invariants (single `DEFAULT_PASS_THRESHOLD`, `judgments.kind` not widened,
  judge-infra→`error` vs check-throw→score-0, `judgeLive` threading, mandatory normalization).
- Whether the new tests assert what the plan claims (test-honesty), not just that the suite is green.

### Out of Scope
- **The E2B calibration sweep (Manual E2E / Phase 8 ship gate).** It requires live spend (~$40–120) plus
  `E2B_API_KEY` + 4 provider keys. Not runnable in autopilot without spend authorization → **BLOCKED/deferred**.
- Round-9 analytics components (separate in-flight work; Phase 7 depends on them).

## Test Cases

### TC-1: Typecheck (src + ui) — `cd evals && bun run tsc:check`
**Expected:** exit 0, no diagnostics. **Actual:** `tsc --noEmit && tsc --noEmit -p ui` → `TSC_EXIT=0`.
**Status:** ✅ pass

### TC-2: Full unit suite — `cd evals && bun test`
**Expected:** all green. **Actual:** `391 pass, 1 skip, 0 fail` (2281 expect() calls, 392 tests across 30 files).
**Status:** ✅ pass

### TC-3: Registry sanity — `cd evals && bun src/cli.ts registry`
**Expected:** exactly the 7 new scenarios load, no validation errors. **Actual:** lists `sql-audit`,
`memory-distractor`, `bug-ladder`, `cross-worker-invent`, `relay-pipeline`, `plan-implement-review`,
`distributed-audit`; `REGISTRY_EXIT=0`. **Status:** ✅ pass

### TC-4: Root lint (read-only, mirrors CI) — `bun run lint`
**Expected:** clean. **Actual:** `biome check src evals` → `Checked 985 files. No fixes applied.`
**Status:** ✅ pass

### TC-5: UI build — `cd evals && bun run ui:build`
**Expected:** vite build succeeds. **Actual:** `77 modules transformed … built in 608ms`. **Status:** ✅ pass

### TC-6: Phase 1 — OutcomeSpec v2 types + v1→v2 normalization
**Expected:** new optional schema fields + pure `normalizeOutcome` + shared `DEFAULT_PASS_THRESHOLD` + validation/serialization.
**Actual:** 13/14 claims confirmed. `CheckResult.score?` (`types.ts:143`), `DeterministicCheck.weight?` (`:154`),
`OutcomeSpec.gates?/dimensions?` (`:213/:215`), new `CoreDimension`/`DimensionName`/`JudgeSubSpec`/`DimensionSpec`/`NormalizedOutcome`
(`:161-242`), all v1 fields retained. `normalize-outcome.ts:20-35` is pure (header "Pure, no I/O."): v1 `checks→gates`
order-preserved, v1 judges→one weight-1 `correctness` dim (`agentic=!!agenticJudge`, agentic preferred when both set),
v2 passthrough, `passThreshold ?? DEFAULT_PASS_THRESHOLD` (explicit 0 survives), does NOT prepend `tasksCompletedCheck`.
`scoring.ts:17 export const DEFAULT_PASS_THRESHOLD = 0.75`. `validateDimensions` enforces weight>0, ≥1 of checks/judge,
unique names, total-weight>0. The 1 "discrepancy" is a **doc-attribution nit only** (see Issues). **Status:** ✅ pass

### TC-7: Phase 2 — `judgments` migration (nullable `dimension` + `weight`)
**Expected:** two additive nullable columns threaded through reader/writer; `kind` CHECK untouched.
**Actual:** 5/5 confirmed. `ALTER TABLE judgments ADD COLUMN dimension TEXT` / `… weight REAL` appended to
`COLUMN_MIGRATIONS`; `kind` CHECK unchanged; `rowToJudgment` reads both as nullable; `insertJudgment` column/placeholder/arg
counts in lockstep; `JudgmentRow` gains nullable fields; `client.test.ts` round-trips set-values AND NULL-on-omit.
**Status:** ✅ pass

### TC-8: Phase 3 — runner weighted aggregation + gates + score-on-gate-failure + failure semantics (highest risk)
**Expected:** gates-first, per-dimension 0–1 sub-scores, weighted aggregate, `passed = allGatesPass && score ≥ threshold`,
score computed even on gate failure, judge-infra→`error`.
**Actual:** 8/9 claims confirmed — **the implementation is correct**. `normalizeOutcome` called; `tasksCompletedCheck`
prepended as first gate; gates run via `runChecks(…, judgeLive)`; per-dimension graded-mean / judge sub-scores; one
`judgments` row per gate and per dimension with correct `name`/`dimension`/`weight`; aggregate `Σw·dim/Σw` with Σ=0 guard;
no early-return on gate failure (score persisted regardless); `JudgeInfraError` thrown on judge-infra failure and mapped to
status `error` at `runner/index.ts:1689,1720`; `signal.throwIfAborted()` ahead of fallback; check-throw stays score 0;
`?? 0.7` replaced by `DEFAULT_PASS_THRESHOLD`. The 1 discrepancy is **test-coverage gaps, not an implementation defect**
(see Issues). **Status:** ✅ pass (impl) / ⚠️ test gaps logged

### TC-9: Phase 4 — agentic judge full-roster tools + roster manifest + head+tail transcript
**Expected:** `worker` arg on `run_command`/`read_file`, roster manifest, head+tail `truncateMiddle(…, 60_000)`.
**Actual:** 6/6 confirmed. `worker: z.number().int().optional()` dispatches to `ctx.workers[worker]`; out-of-range returns
an error object (not a throw); worker-0 aliases intact; roster manifest rendered + lead marked; **head-only 30k slice
replaced by `truncateMiddle(…, 60_000)`** (the non-optional fix for scenarios 6/7); `JudgeWorkerContext` extended from
boot-time `BootMember`; `llm.ts` gets the manifest too; `agentic.test.ts` asserts worker dispatch, out-of-range error,
roster block, and an end-of-transcript sentinel surviving truncation. **Status:** ✅ pass

### TC-10: Phase 5 — deterministic efficiency dimension vs budget
**Expected:** `budgetUsd`/`budgetMs` metadata + `efficiencyScore` + unpriced skip/renormalize.
**Actual:** 5/5 confirmed. `Scenario.budgetUsd?/budgetMs?`; registry validates >0 and serializes; `efficiencyScore`
(1.0 ≤budget, 0 at N×, ~0.5 mid; min of cost/time when both set); runner computes the `efficiency` dimension from real
`costUsd`/`durationMs`; **unpriced (`costSource` null) → dimension skipped and remaining weights re-normalized** (not scored 0);
boundary + renormalization tests present. **Status:** ✅ pass

### TC-11: Phase 6 — catalog swap (delete 7 old, author 7 new)
**Expected:** 7 old deleted, 7 new authored against the anti-gaming checklist, graded check factories return `score`.
**Actual:** 6/6 confirmed. `index.ts` registers exactly the 7 new ids; `DEFAULT_SCENARIO_IDS` set to a cheap smoke scenario;
all 7 old files deleted and unimported; each new scenario has gates + ≥1 weighted dimension; multi-worker ≤3; `bug-ladder`
sets `budgetUsd: 0.5`; new graded check factories return `CheckResult` with numeric `score`; fixtures present;
`scenarios.test.ts` extended (single file) with per-scenario structural assertions. **Status:** ✅ pass

### TC-12: Phase 7 — analytics/UI per-dimension breakdown
**Expected:** UI types + RunDetails per-dimension breakdown + ScenariosPage dimension config + AnalyticsPage dimension selector.
**Actual:** 4/6 confirmed — **partial**. ✅ `JudgmentJson` gains optional `dimension`/`weight`; ✅ `/api/attempts/:id`
emits them for free (no server serializer added); ✅ RunDetailsPage renders the per-dimension breakdown (NULL → legacy bucket,
no crash); ✅ `attempt.score` render sites unchanged. ❌ ScenariosPage does NOT render the dimension/weight config
(`ScenarioJson.outcome` omits the fields; page reads only the legacy view). ❌ AnalyticsPage has NO dimension selector
(Option A — per-run-only — was taken; `ANALYTICS_SQL` unchanged). **Status:** ⚠️ partial (2 UI gaps — see Issues)

### TC-13: Phase 8 — calibration sweep tooling/recipe + ship gate (scaffolding only, pre-sweep)
**Expected:** calibration doc + anchors + (optional) report helper. Baselines empty by design pre-sweep.
**Actual:** 4/4 confirmed. Calibration doc exists with the run command, ship-gate formula
(`mean(frontier) − mean(budget) ≥ 0.2`), borderline rule, cost ceilings, pinned frontier model `claude-opus-4.8`, and budget
cohort `pi-deepseek-flash` + `claude-haiku`; all 4 anchor configs exist in `configs/index.ts`. **Status:** ✅ pass (scaffolding)

### TC-14: Cross-cutting back-compat invariants (plan Appendix)
**Expected:** all 6 invariants hold across the package.
**Actual:** 6/6 confirmed. Single `DEFAULT_PASS_THRESHOLD` in `scoring.ts`; **both** inlined `?? 0.7` literals gone
(grep clean); `judgments.kind` CHECK still `IN ('llm','deterministic')` (not widened); no backfill of `dimension`/`weight`;
every `runChecks(…)` call in the runner threads `judgeLive`; no scoring path bypasses `normalizeOutcome`. **Status:** ✅ pass

### TC-15: Manual E2E — E2B calibration sweep (Phase 8 ship gate) — **EXECUTED**
**Expected:** real sweep clears `frontierAvg − budgetAvg ≥ 0.2` per scenario. **Actual:** ran a scoped real E2B sweep on a
fresh local DB (`/tmp/evals-calibration.sqlite`, Turso replica neutralized). Cheap-4: 4 scenarios × {opus-4.8, deepseek-flash,
haiku} × 1 attempt = 11/12 passed, $3.80. Lead-2 (`plan-implement-review`, `distributed-audit` × {opus, deepseek}) ran
after. **Scoring machinery verified correct live; discrimination ship gate fails on 3/4 cheap scenarios.** Full results +
per-dimension breakdown in the **Calibration Sweep Results** section below. **Status:** ✅ executed / ⚠️ 3 of 4 scenarios
sub-gate (scenario calibration issue, not an implementation defect)

## Calibration Sweep Results (real E2B run — `run-202606132111-9c9013`)

Scoped sweep, fresh local DB, Turso replica neutralized (`EVALS_DB_SYNC_URL=''`). Frontier anchor = `claude-opus-4.8`
(only — `codex-5.5` skipped to conserve frontier spend); budget cohort = `pi-deepseek-flash` + `claude-haiku`. **1 attempt
per cell** (noisy — plan wants 3; treat saturation, not single failures, as signal).

| Scenario | opus-4.8 | deepseek-flash | haiku | gate (opus − budgetAvg) |
|---|---|---|---|---|
| sql-audit | ✓ 1.00 | ✓ 1.00 | ✗ 0.49 | **+0.256 PASS** |
| memory-distractor | ✓ 1.00 | ✓ 1.00 | ✓ 1.00 | 0.000 FAIL |
| bug-ladder | ✓ 0.93 | ✓ 1.00 | ✓ 1.00 | −0.065 FAIL (inverted) |
| cross-worker-invent | ✓ 1.00 | ✓ 1.00 | ✓ 1.00 | 0.000 FAIL |

Lead-2 sweep (`run-202606132125-292247`, opus + deepseek only, 1 attempt) — validates lead-orchestration + the Phase-4
head+tail transcript + the communication judge on the final report:

| Scenario (lead+workers) | opus-4.8 | deepseek-flash | gate (opus − deepseek) | discriminator |
|---|---|---|---|---|
| distributed-audit | ✓ 1.00 | ✓ 0.79 | **+0.21 PASS** | correctness 1.00 vs 0.60 (merged answer-key) |
| plan-implement-review | ✓ 0.99 | ✓ 0.96 | +0.03 FAIL | only communication judge (0.95 vs 0.75); correctness+citation tied at 1.00 |

**Combined ship gate — 2 of 6 scenarios clear ≥0.2** (both marginal, single-attempt): ✅ `sql-audit` (+0.256),
✅ `distributed-audit` (+0.21); ❌ `memory-distractor`, `cross-worker-invent`, `plan-implement-review` (graded correctness
too easy — budget models tie at 1.00), ❌ `bug-ladder` (efficiency inversion). `relay-pipeline` not swept. **Pattern: a
scenario discriminates exactly when its graded *correctness* checks catch budget-model errors** (`sql-audit` haiku 0.33,
`distributed-audit` deepseek 0.60); soft judge dimensions at weight 1 can't move the aggregate ≥0.2 on their own.

Cost: cheap-4 $3.80 + lead-2 $3.44 = **$7.24 total**. Spend stayed within budget: 6 frontier (opus) calls + 10 cheap.
Phase-4 validated: both lead scenarios ran the communication judge on the final report (the head+tail transcript fix in
the live path); `citation-validity` graded checks confirmed both models cited real file lines.

**Machinery verified correct against real attempts (strong positive evidence):**
- Weighted aggregate exact: `bug-ladder opus = (3·1.00 + 1·1.00 + 1·0.67)/5 = 0.93`; `sql-audit haiku = (3·0.33 + 1·0.95)/4
  = 0.49 → passed=0` (below 0.75 threshold). Gate-on-aggregate semantics correct.
- **Efficiency dimension works exactly as designed:** opus on `bug-ladder` cost $0.826 vs `budgetUsd 0.5` → efficiency 0.67
  (`clamp(1 − (0.826−0.5)/((3−1)·0.5)) = 0.674`); cheap models under budget → 1.00.
- Per-dimension persistence correct: `correctness(w3)`, `communication`/`provenance`/`retrieval-fidelity`/
  `instruction-following`/`efficiency(w1)` rows all written with right name/dimension/weight.
- Gates ran live: `tasks-completed`, `file-contains`, `file-absent[w1]`/`[w2]`, `origin-uuid-exists`, `src-exists`.
- **Phase-3 failure semantics validated in the wild:** `memory-distractor × haiku` agentic judge ran 8 steps without a
  verdict → **fell back to the llm judge, no `error`** — exactly the designed agentic→llm fallback.

**Discrimination (the actual round-11 goal) FAILS on 3/4 cheap scenarios — see Issues.** This is the calibration sweep
doing its job: catching scenarios that don't separate frontier from budget. Implementation-correct, scenario-weak.

## Edge Cases & Exploratory Testing

- **Implementation exceeds the plan (positive):** `registry.ts validateDimensions` adds a round-11 **checks-XOR-judge**
  rejection plus an **efficiency exemption** (a dimension named `efficiency` may legitimately have neither checks nor judge).
  These are beyond the plan text and match the intended round-11 contract. Not a defect.
- **Phase 1 default-threshold routing:** `registry.ts` doesn't reference `DEFAULT_PASS_THRESHOLD` by symbol at the old
  `~268` site; it resolves the default via `normalizeOutcome` (`normalize-outcome.ts:33`) and consumes `normalized.passThreshold`
  at `registry.ts:395`. The invariant (no inlined `0.7`, single source) holds; only the literal line cite shifted.

## Evidence

### Logs & Output
```
tsc:check         → TSC_EXIT=0  (tsc --noEmit && tsc --noEmit -p ui)
bun test          → 391 pass, 1 skip, 0 fail | 2281 expect() | 392 tests / 30 files [518ms]
registry          → sql-audit, memory-distractor, bug-ladder, cross-worker-invent,
                    relay-pipeline, plan-implement-review, distributed-audit | REGISTRY_EXIT=0
lint (biome)      → Checked 985 files. No fixes applied.
ui:build (vite)   → 77 modules transformed | built in 608ms
```

### Verification fan-out
- 9 adversarial verifier agents, 131 tool uses, ~746k subagent tokens, 186s wall.
- Per-area verdicts: P1 pass(13/14), P2 pass(5/5), P3 pass-impl(8/9), P4 pass(6/6), P5 pass(5/5), P6 pass(6/6),
  P7 **partial(4/6)**, P8 pass(4/4), invariants pass(6/6).

### External Links
- Plan: `thoughts/taras/plans/2026-06-13-evals-v8-0-round11-outcomespec-v2-spec.md`
- PR: #737

## Issues Found

- [ ] **Phase 7 — ScenariosPage doesn't render the dimension/weight config** — severity: **minor** (UI visibility, no
  scoring impact). Backend `serializeScenario` (`registry.ts:396-402`) emits `gates` + `dimensions`, but
  `ui/src/types.ts ScenarioJson.outcome` (`~455-461`) omits both fields and `ScenariosPage.tsx` never reads them. The new
  scenario-level dimension config is invisible in the Scenarios page. The plan lists this file under Phase 7 "Files to change".
- [ ] **Phase 7 — AnalyticsPage has no dimension selector** — severity: **minor** (plan-sanctioned deferral). Option A
  (per-run RunDetails only) was taken and `ANALYTICS_SQL` is correctly unchanged. The plan's Phase 7 precondition explicitly
  permits deferring the AnalyticsPage selector when round-9 components aren't merged/stable — so this is within the sanctioned
  scope-down, but it is a deviation from the literal step list. The per-dimension data IS available in RunDetails.
- [ ] **Phase 3 — test gap: no v1-legacy parity test** — severity: **minor** (impl correct, coverage missing). Claim 9(e)
  ("a v1 checks-only spec yields identical pass/fail to the legacy binary path") has no asserting test. The legacy gates-only
  path itself is exercised (`scoring.test.ts:107-116`), but the round-trip equivalence isn't pinned.
- [ ] **Phase 3 — test gap: JudgeInfraError→`error` end-to-end mapping untested** — severity: **minor** (impl correct,
  coverage missing). `runner/scoring.test.ts:232-251` asserts `scoreDimension` THROWS `JudgeInfraError` (with `.dimension`,
  no persisted row), but no test asserts `runAttemptWithRetry` maps it to attempt status `error`. The mapping code
  (`runner/index.ts:1689,1720`) was read and is correct — only the behavioral assertion is absent.
- [ ] **Phase 1 — doc nit (not a defect)** — the plan's Phase-1 "Automated QA" attributes the `total-weight=0 rejected`
  assertion to `normalize-outcome.test.ts`; it actually lives in `registry.test.ts:453-461`, which is the architecturally
  correct home (rejection is `validateScenario`'s job, not the pure mapper's). Coverage exists; only the file cite is wrong.
- [ ] **Scenario under-discrimination — 3 of 4 cheap scenarios fail the ship gate** — severity: **major (calibration, not
  implementation)**. `memory-distractor` and `cross-worker-invent` score 1.00 for *every* model incl. haiku/deepseek
  (gap 0.00) — distractors/comms tasks aren't hard enough. `sql-audit` is the only clean pass (gap 0.256, driven by haiku's
  0.33 correctness; deepseek still 1.00). Per the plan, sub-gate scenarios "get reworked (stronger distractors / harder
  graded subgoals) and re-swept." They are NOT shippable as-is. (Caveat: single-attempt, opus-only frontier — but all-1.00
  saturation is a confident signal, not noise.)
- [ ] **Efficiency dimension inverts the frontier/budget spread** — severity: **major (design decision needed)**. On
  `bug-ladder`, frontier opus scores 0.93 vs budget models 1.00 *solely* because the efficiency dimension penalizes opus for
  exceeding `budgetUsd 0.5` ($0.826) while correctness is tied at 1.00. A folded-in efficiency dimension can make a
  more-correct frontier model rank BELOW a cheaper budget model that did equally-correct work — which works against
  "`attempt.score` as a continuous quality rank." Decision for Taras: lower efficiency weight, raise per-scenario budgets,
  or treat efficiency as a separate axis not summed into the quality aggregate. (The formula itself is correct; the question
  is whether it belongs in the quality score.)
- [ ] **Ship gate partially run** — severity: **blocking for ship, not for merge** — the full sweep (7 scenarios × 4 anchors
  × 3 attempts, both frontier anchors) has NOT run; this QA ran a scoped 1-attempt smoke (6 scenarios, opus-only frontier).
  Per-scenario spreads still need recording in `evals/docs/calibration.md` + scenario headers; `relay-pipeline` was not swept.
  Scenarios remain non-shippable until the full sweep clears the gate after the scenario/efficiency reworks above.

## Round-2: Fixes Applied + Re-sweep Validation (2026-06-14)

After the calibration findings, a 6-agent ultracode pass applied: (1) hardened graded-correctness on the 4 saturating
scenarios; (2) efficiency-inversion fix (`bug-ladder budgetUsd 0.5→1.5`; efficiency reframed as a waste-guard in
`calibration.md`); (3) Phase-7 UI gaps (ScenariosPage dimension/weight/gate rendering + RunDetailsPage per-dimension focus);
(4) the 2 missing Phase-3 tests (v1-legacy parity; `JudgeInfraError`→error, latter honestly partial). **All merge gates
green: `tsc:check` 0, `bun test` 396 pass/0 fail, lint clean (one Biome false-positive on a reset-on-change `useEffect`
suppressed with a scoped `biome-ignore`), registry, `ui:build`.**

Re-sweep `run-202606140010-c7d66c` (Turso, 4 hardened scenarios × {opus-4.8, deepseek-flash, haiku} × 1 attempt, $5.68):

| Scenario | gap before | gap after | result |
|---|---|---|---|
| bug-ladder | −0.07 | **0.000** | efficiency inversion FIXED (opus 1.00); correctness still 1.00 all models |
| memory-distractor | 0.00 | 0.054 | deepseek 0.89 (correctness 0.86), **haiku 1.00** |
| plan-implement-review | 0.03 | 0.075 | deepseek 0.85 (comms 0.30, citation 0.80), **haiku 1.00** |
| cross-worker-invent | 0.00 | 0.000 | budget models nailed all multi-hop derivations |

**Outcome — fixes correct, gate still not met (0/4 ≥0.2).** The efficiency inversion is resolved. The correctness
hardening *did* bite the genuinely-cheap model (`pi-deepseek-flash` cracked to 0.85–0.89 on 2/4), but **`claude-haiku`
(Haiku 4.5) is too capable to fail these tasks** — it scored 1.00 across all four, so the budget *mean* stays high. Even
opus-vs-deepseek-alone tops at 0.15. **Discriminating frontier from this budget cohort needs a calibration-design decision
(Taras's call), not more code:** either (a) swap the budget anchor to a genuinely weaker model (Haiku 4.5 isn't it), (b) push
task difficulty past Haiku's ceiling, and/or (c) run 3 attempts to de-noise the marginal deepseek signal. Single-attempt
noise is also a factor (deepseek scored 1.00 on the other 2).

## Verdict

**Status: PASS (implementation) / NOT-YET-SHIPPABLE (scenario calibration).** The v8.0 code is correct and now
**validated against real E2B runs**; the scenarios it grades are not yet calibrated to discriminate.

**Summary:** All five deterministic gates are green (typecheck, 391-test suite, registry, lint, ui:build); the adversarial
fan-out confirms the scoring core — Phases 1–6, 8, every back-compat invariant — is implemented faithfully (and slightly
exceeds the plan via the checks-XOR-judge contract); and a real scoped E2B calibration sweep (6 of 7 scenarios, $7.24)
**verified the scoring machinery end-to-end in production conditions** — weighted aggregation, gate-on-aggregate, the
efficiency formula, per-dimension persistence, the Phase-4 head+tail transcript + communication judge, and the
agentic→llm fallback all behaved exactly as specified. **No implementation defects found.** The genuine deviations are
non-blocking: two UI gaps (Phase-7 ScenariosPage config + AnalyticsPage selector — the latter plan-sanctioned) and two
Phase-3 test-coverage gaps (impl correct, unasserted). **The blocking item for shipping is calibration, not code:** only
2 of 6 swept scenarios clear the ≥0.2 discrimination gate (both marginal/single-attempt), and the efficiency dimension can
invert the frontier/budget spread (`bug-ladder`). Scenarios need harder graded-correctness checks and an efficiency-weighting
decision, then a full 3-attempt sweep, before they ship.

## Appendix

- **Plan:** `thoughts/taras/plans/2026-06-13-evals-v8-0-round11-outcomespec-v2-spec.md`
- **PR:** #737 (branch `feat/evals-subproject`)
- **Calibration runs:** `run-202606132111-9c9013` (cheap-4) + `run-202606132125-292247` (lead-2), fresh local DB
  `/tmp/evals-calibration.sqlite` (Turso replica neutralized — production data untouched).
- **Notes / follow-ups (priority order):**
  1. **Harden graded-correctness checks** on the 4 under-discriminating scenarios (`memory-distractor`,
     `cross-worker-invent`, `plan-implement-review`, and `bug-ladder`) so budget models can't tie at 1.00 — more/subtler
     answer-key sub-checks. This is the lever that actually moves the spread (proven by `sql-audit`/`distributed-audit`).
  2. **Decide efficiency weighting** — whether efficiency belongs in the quality aggregate at all (it inverted `bug-ladder`);
     options: lower weight, raise `budgetUsd`, or split it onto a separate axis.
  3. **Re-sweep at 3 attempts** with the full budget cohort (deepseek + haiku) on the lead scenarios + sweep `relay-pipeline`
     (not yet run); record per-scenario spreads in `evals/docs/calibration.md` and scenario headers.
  4. Phase-7 UI: surface ScenariosPage dimension config + (optionally) AnalyticsPage selector, or accept as scope-down.
  5. Add the two missing Phase-3 tests (v1-legacy parity; `JudgeInfraError`→`error` status mapping).
  - evals UI has no unit-test infra (compile-only gate per `merge-gate.yml`), so the Phase-7 gaps won't be caught by CI.
  - **DB-isolation gotcha (important):** `EVALS_DB_SYNC_URL` overrides `EVALS_DB_PATH` (`client.ts:29-52`); to run on a
    local DB you must pass `EVALS_DB_SYNC_URL='' EVALS_DB_AUTH_TOKEN=''` alongside `EVALS_DB_PATH`, or you write to the
    shared Turso primary.
