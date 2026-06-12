---
date: 2026-06-12T00:00:00+02:00
author: Taras
topic: "Evals scenario catalog redesign for score discrimination"
tags: [brainstorm, evals, scoring, scenarios, judges]
status: in-progress
exploration_type: problem
last_updated: 2026-06-12
last_updated_by: Claude
---

# Evals scenario catalog redesign for score discrimination — Brainstorm

## Context

**Problem:** The evals matrix (`evals/` — scenario × harness-config on E2B) can't discriminate between frontier and budget models. The 7 registered scenarios (`evals/scenarios/index.ts`) nearly all score binary 1.00 — capable harnesses "just work", so the matrix tells us pass-rate, not quality ranking.

**Why scores are binary today** (from `evals/src/runner/index.ts:1072–1223`):
- 6/7 scenarios are deterministic-checks-only; `CheckResult` is `{ pass: boolean }` — no partial credit.
- Final aggregation is all-AND: `passed = checksPass && llmPass && agenticPass`; when no judge runs, `score = passed ? 1 : 0`.
- Judges (llm/agentic) do emit continuous `score ∈ [0,1]` gated by `passThreshold` (default 0.7), but only `memory-pipeline` uses one.
- No weights, dimensions, or rubric-per-dimension anywhere in `OutcomeSpec` (`evals/src/types.ts:123–131`).

**Storage / back-compat surface:**
- `attempts.score REAL`, `attempts.passed INTEGER`; `judgments` rows are `kind IN ('llm','deterministic')`, `pass` required, `score` nullable. 100+ stored attempts must keep rendering in the UI.

**Adjacent work (must not conflict):**
- Round 9 (2026-06-12 spec) is UI/analytics only — quadrant quartile bands, config presets, transcript UX. No OutcomeSpec changes there; this redesign lands as its own round after round 9.
- v6 spec §13.2 backlog: `sql-audit-history`, `memory-distractor`, `cross-worker-invent` (blocked: agentic judge is worker-0-bound), `chain-depth-3`, `tier-ladder` run recipe.
- WorkerSpec rosters + lead landed in v7; judge model default is DeepSeek V4 Pro.

**Goals to explore:**
1. Scenarios with genuine partial credit (difficulty ladders, graded subgoals, distractors, chained dependencies).
2. Multi-dimension grading (correctness, completeness, efficiency/cost discipline, instruction-following, communication) with per-dimension weights → weighted attempt score; composition with checks + llmJudge/agenticJudge + passThreshold.
3. OutcomeSpec schema changes with back-compat for stored judgments.
4. First batch: 5–8 scenario designs easy→hard with expected score spreads, multi-worker/lead variants, per-scenario cost ceilings.

**Constraints:**
- Judge cost proportionate — deterministic checks preferred; judge only where judgment is genuinely needed.
- Scenarios self-contained in E2B sandboxes.
- Existing stored attempts keep rendering.
- End state: written proposal reviewable via file-review → converts into an implementation round.

## Exploration

### Q: Where should score discrimination primarily come from — graded deterministic subgoal checks (scenario-content lever) or judge dimension rubrics (grading-machinery lever)?
Tiered grading across the board: not only making the AI judge non-binary, but making **all** the checks of a scenario tiered/graded as well.

**Insights:** This generalizes beyond "deterministic-first vs judge-led" — the whole grading pipeline becomes graded. `CheckResult` needs to carry partial scores (or tier membership), not just `pass: boolean`, and aggregation must move from all-AND to a tiered/weighted composition. "Tiered" may also imply difficulty tiers within a scenario (ladder semantics) — to clarify in aggregation question.

## Synthesis

### Key Decisions
- [Filled after exploration]

### Open Questions
- [Filled after exploration]

### Constraints Identified
- [Filled after exploration]

### Core Requirements
- [Filled after exploration]

## Next Steps

- [Handoff decision: research, plan, or parked]
