---
date: 2026-07-06
author: Claude
topic: "Memory Usefulness panel polish — tooltips + chart formatting QA"
tags: [qa, ui, memory, usefulness]
branch: feat/memory-usefulness-panel-polish
---

# Usefulness panel polish — QA

Taras's feedback on the prod panel: the cards needed explanations, and the chart
axes/formatting were rough (0.00–1.00 ticks every 0.10; counts axis ticked every
2000; no legend; snake_case labels).

## Changes verified

- **InfoTip on every card** (new `components/ui/info-tip.tsx`, wired through
  `StatPanel`'s new `info` prop + both chart headers): hoverable muted Info icon
  with one-sentence plain-language copy for Retrievals, Citation rate,
  Posteriors moved, Above-threshold, and both charts.
- **Rate chart**: y-axis fixed 0–100% with 5 ticks (`maxValue=1`,
  `yTickCount=5`, percent formatter), narrower bars (`padding=0.45`),
  humanized source labels (`task_completion` → "task completion").
- **Arm chart**: legend row (retrievals / cited) above the plot, compact count
  ticks (`formatCompactCount` — 24000 → "24k"), 5 ticks, grouped bars with
  inner padding.
- `SharedBarChart` extended with `axisFormatter` / `maxValue` / `yTickCount` /
  `showLegend` / `padding` props (backwards-compatible defaults); legend text
  themed via CSS vars.

## Evidence (seeded local stack, fresh DB)

Seed: 1 agent, 1 task, 4 memories (one per source), 4 searches with
`X-Source-Task-ID`, 4 implicit-citation ratings (task_completion negative),
posterior movement on 2 memories → endpoint returned 75% arm citation rate and
per-source rates {manual 1, file_index 1, session_summary 1, task_completion 0}.

- `01-panel-overview.png` — full panel: tiles with info icons, both charts with
  new axes/legend.
- `02-tooltip-citation-rate.png` — Citation-rate tile tooltip open.
- `03-tooltip-arm-chart.png` — Retrievals-by-arm chart tooltip open.

## Verification

- `cd apps/ui && bun run lint && bunx tsc -b && bun run check:tokens` — all pass.
- Root `bun run tsc:check` — pass.

## Notes

- A zero-rate source (task_completion at 0%) renders as no bar — correct, the
  axis baseline shows it.
- QA run recovered from a stalled sub-agent: two first-run modals (connection
  naming + identity picker) must be dismissed before the panel is visible in a
  fresh browser profile.
