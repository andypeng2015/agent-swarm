# `gsc-topic-miner` workflow

Production sibling of `gsc-runtime-smoke`. Bi-weekly content-topic-mining workflow that combines GSC cusp queries with HN / GitHub / newsletter discovery, classifies and scores candidates with a Sonnet LLM, proposes topics for three downstream content workflows with an Opus LLM, and gates the proposal set through a two-stage litmus check before dispatch. Built for DES-373.

Workflow ID is per-deployment — look it up via `list-workflows` by name (`gsc-topic-miner`).

## DAG shape

```
pull-gsc ─┬─ pull-newsletter ─┐
         ├─ pull-hn          ├─ classify-and-merge ─ propose-topics ─ litmus-proposals
         └─ pull-github      ┘                                            │
                                                                          ├── pass ─ dispatch ─ notify-slack
                                                                          └── fail ─ propose-topics-retry
                                                                                       │
                                                                                       └─ litmus-final
                                                                                            │
                                                                                            ├── pass ─ dispatch ─ notify-slack
                                                                                            └── fail ─ notify-slack
```

## Sources

| Source | Node | Lookback | Filter | Cap |
|---|---|---|---|---|
| GSC cusp queries (`desplega.ai`) | `pull-gsc` | last 28d (`-31d` to `-3d`) | position 11–25, impressions ≥ 50 | 50 rows |
| Curated newsletter list | `pull-newsletter` | n/a | each `-`/`*` bullet → 1 candidate | 20 |
| Hacker News (Algolia) | `pull-hn` | last 7d | 10 keywords (testing, QA, Playwright, etc.) | 30 by points, deduped by `hn_id` |
| GitHub search API | `pull-github` | pushed in last 14d | 8 query terms × 3 languages | 30 by stars, deduped by `full_name` |

Each source writes a per-run artefact to agent-fs at `gsc-miner/{YYYY-MM-DD}/sources/{source}.json` on the shared org drive (`648a5f3c-35c8-4f11-8673-b89de52cd6bd`).

## Two-stage litmus retry

The workflow has **two** litmus nodes wired in series — one before retry, one after. This produces a clean "one-shot retry" semantic without an infinite loop:

1. `litmus-proposals` (sonnet, strict thresholds) → pass routes to `dispatch`, fail routes to `propose-topics-retry`.
2. `propose-topics-retry` (opus) receives the first litmus's `rejection_feedback` via `inputs.litmusProposals` and re-proposes with the failure pattern visible.
3. `litmus-final` (sonnet, slightly more lenient instructions) → pass routes to `dispatch`, fail routes directly to `notify-slack` (empty proposal set + Slack notify Eze).

Validation uses `property-match` on `litmus-{node}.result` containing `"approved": true` (with-and-without-space variants matched via `mode: "any"`).

## Defensive dispatch

`dispatch` queries `${MCP_BASE_URL}/api/workflows` for `competitor-page-generator` and `how-to-generator-with-schema` by name. If a target workflow is not yet deployed (returns no ID), the dispatch logs `status: skipped-workflow-not-found` for that proposal and continues — it never fails the run. Each downstream workflow is capped at 2 dispatches per cycle.

Blog proposals append to a rolling cusp pool at agent-fs `gsc-miner/cusp-pool-current.json` (read-merge-write).

## Native 13-day cooldown

`workflow.cooldown.hours = 312` (13 days) — set at workflow creation. The cooldown is enforced by the trigger pipeline before a run is created; calls within the window return `skipped: true` instead of creating a no-op run. No KV cursor is needed.

A weekly cron schedule (`0 9 * * 1` UTC) is wired as the workflow's only trigger. Mondays in the cooldown window get `skipped`; the practical cadence is once every two weeks.

## Inputs / secrets

| Key | Type | Source |
|---|---|---|
| `GSC_SERVICE_ACCOUNT_BASE64` | secret | `secret.GSC_SERVICE_ACCOUNT_BASE64` |
| `TURSO_DB_TOKEN` | secret | `secret.TURSO_DB_TOKEN` |
| `AGENT_FS_API_URL` | url | literal `https://agent-fs-taras.fly.dev` |
| `AGENT_FS_API_KEY` | secret | `secret.AGENT_FS_API_KEY` |
| `MCP_BASE_URL` | env | `${MCP_BASE_URL}` |
| `SWARM_API_KEY` | env | `${API_KEY}` |

## Curated newsletter list location

The newsletter source list lives in agent-fs at `references/newsletter-list.md` on the shared org drive (`648a5f3c-35c8-4f11-8673-b89de52cd6bd`). If the file is missing or empty the workflow logs `status: empty-newsletter-list-file-missing-or-empty` and continues with the other 3 sources.

To edit:

```bash
agent-fs --org 648a5f3c-35c8-4f11-8673-b89de52cd6bd cat references/newsletter-list.md
agent-fs --org 648a5f3c-35c8-4f11-8673-b89de52cd6bd write references/newsletter-list.md --content "..." -m "<reason>"
```

## Authoring gotchas (codified from DES-373 smoke)

1. **jq variable names — avoid grammar keywords.** Production jq treats `$start`, `$end`, `$label` as reserved (slice/label parser tokens) and refuses to bind them via `--arg`. Use `$startDate`, `$endDate`, `$lblStr`, `$statusStr`, etc. Other names to avoid: anything that matches `as`, `def`, `if`, `then`, `else`, `elif`, `end`, `and`, `or`, `not`, `reduce`, `foreach`, `try`, `catch`, `label`, `import`, `include`, `start`. The error has the form `syntax error, unexpected end/label, expecting IDENT or __loc__` with the "Unix shell quoting issues?" hint (misleading — the issue is variable-name collision).

2. **Default raw-llm timeout is 30 s.** Set `config.timeoutMs` explicitly on every LLM node — `300000` (5 min) for Sonnet, `360000` (6 min) for Opus with long prompts.

3. **`--argjson` on shell vars is brittle.** If the var isn't valid JSON, jq errors are confusing. Prefer writing to a temp file and reading via stdin (`< "$FILE"`) with `.` in the filter.

4. **`onNodeFailure: "continue"`** means failed nodes don't fail the whole run — useful when downstream nodes can handle partial output (e.g. `notify-slack` running off both `dispatch` and `litmus-final`).

5. **Workflow `triggers` array** takes `{type: "schedule", scheduleId: ...}`. Set via `update-workflow` after creating the schedule via `create-schedule`. The 13-day cooldown is what enforces bi-weekly cadence on top of the weekly cron.

## Smoke testing

Two smoke workflows for DES-373:

- **`gsc-topic-miner`** itself — once created, can be smoke-tested via `trigger-workflow` with arbitrary `triggerData`. Subsequent triggers are skipped until the 13-day cooldown elapses (use `update-workflow` with `cooldown: { hours: 0 }` for re-runs during dev, then restore).
- **`gsc-topic-miner-litmus-smoke`** — sibling workflow that runs only the litmus check against `{{trigger.proposals}}` and routes to `ack-pass` / `ack-fail` based on the validator. Use the deliberately-bad fixture below to confirm the reject path fires.

### Bad-proposals fixture (verified rejects)

```json
{
  "expected": "rejected",
  "proposals": {
    "proposals_for_competitor_page_generator": [],
    "proposals_for_how_to_generator": [
      {"topic": "testing best practices", "cluster": "general", "source_phrase": "...", "source": "hn", "score": 3},
      {"topic": "QA strategy guide",      "cluster": "general", "source_phrase": "...", "source": "hn", "score": 3},
      {"topic": "testing best practices", "cluster": "general", "source_phrase": "...dup", "source": "github", "score": 3},
      {"topic": "ai agent guide",         "cluster": "general", "source_phrase": "...", "source": "hn", "score": 3}
    ],
    "proposals_for_unified_daily_blog_context": []
  }
}
```

Triggers all four litmus rubric failures: coverage (only HN), diversity (all in one bucket), quality (every phrase is generic), dedup (two `testing best practices`).
