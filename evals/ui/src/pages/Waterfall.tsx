import type { ReactNode } from "react";
import { fmtDuration } from "../components/format.ts";
import { Tooltip } from "../components/Tooltip.tsx";
import type { PhaseTimingsJson } from "../types.ts";

interface PhaseDef {
  key: Exclude<keyof PhaseTimingsJson, "perTask">;
  label: string;
  color: string;
}

const PHASES: PhaseDef[] = [
  { key: "bootMs", label: "Boot", color: "var(--blue)" },
  { key: "seedMs", label: "Seed", color: "var(--blue)" },
  { key: "tasksMs", label: "Tasks", color: "var(--accent)" },
  { key: "logCaptureMs", label: "Log Capture", color: "var(--dim)" },
  { key: "costMs", label: "Cost Wait", color: "var(--dim)" },
  { key: "checksMs", label: "Checks", color: "var(--green)" },
  { key: "llmJudgeMs", label: "LLM Judge", color: "var(--orange)" },
  { key: "agenticJudgeMs", label: "Agentic Judge", color: "var(--orange)" },
  { key: "artifactsMs", label: "Artifacts", color: "var(--green)" },
];

interface WfRow {
  key: string;
  label: string;
  ms: number | null;
  startMs: number;
  color: string;
  sub: boolean;
}

/** Phases laid out sequentially: each bar starts where the previous measured one ended. */
function buildRows(timings: PhaseTimingsJson): { rows: WfRow[]; total: number } {
  const rows: WfRow[] = [];
  let cursor = 0;
  for (const phase of PHASES) {
    const ms = timings[phase.key] ?? null;
    rows.push({
      key: phase.key,
      label: phase.label,
      ms,
      startMs: cursor,
      color: phase.color,
      sub: false,
    });
    if (phase.key === "tasksMs") {
      const perTask = Array.isArray(timings.perTask) ? timings.perTask : [];
      let taskCursor = cursor;
      for (const t of perTask) {
        rows.push({
          key: `task-${t.taskId}`,
          label: `Task ${t.taskId}`,
          ms: t.ms,
          startMs: taskCursor,
          color: phase.color,
          sub: true,
        });
        taskCursor += t.ms;
      }
    }
    if (ms !== null) cursor += ms;
  }
  return { rows, total: cursor };
}

function fmtPct(ratio: number): string {
  const pct = ratio * 100;
  return pct < 0.1 ? "<0.1%" : `${pct.toFixed(1)}%`;
}

/**
 * Waterfall diagram of attempt phase timings (item 7): one horizontal bar per
 * phase on a shared time axis, offset by cumulative start; hovering highlights
 * the bar and shows name + duration + share of total + start offset.
 */
export default function Waterfall(props: {
  timings: PhaseTimingsJson;
  totalMs: number | null;
}): ReactNode {
  const { rows, total } = buildRows(props.timings);
  const axis = Math.max(total, props.totalMs ?? 0);
  if (axis <= 0) {
    return <div className="dim rd-not-captured">No phase durations recorded</div>;
  }
  return (
    <div className="wf">
      <div className="wf-axis">
        <span>0s</span>
        <span>{fmtDuration(axis)}</span>
      </div>
      {rows.map((row) => (
        <WaterfallRow key={row.key} row={row} axis={axis} />
      ))}
      <div className="wf-foot dim">
        Measured phases: {fmtDuration(total)}
        {props.totalMs !== null ? ` · Attempt duration: ${fmtDuration(props.totalMs)}` : ""}
      </div>
    </div>
  );
}

function WaterfallRow(props: { row: WfRow; axis: number }): ReactNode {
  const { row, axis } = props;
  const rowClass = row.sub ? "wf-row sub" : "wf-row";
  if (row.ms === null) {
    return (
      <div className={rowClass}>
        <div className="wf-label" title={row.label}>
          {row.label}
        </div>
        <div className="wf-na">Not measured</div>
        <div className="wf-dur">—</div>
      </div>
    );
  }
  const left = Math.min((row.startMs / axis) * 100, 99);
  const width = Math.min((row.ms / axis) * 100, 100 - left);
  const tip = [
    row.label,
    `${fmtDuration(row.ms)} · ${fmtPct(row.ms / axis)} of total`,
    `Starts at +${fmtDuration(row.startMs)}`,
  ].join("\n");
  return (
    <div className={rowClass}>
      <div className="wf-label" title={row.label}>
        {row.label}
      </div>
      <Tooltip text={tip}>
        <span className="wf-track">
          <span
            className="wf-bar"
            style={{ left: `${left}%`, width: `${width}%`, background: row.color }}
          />
        </span>
      </Tooltip>
      <div className="wf-dur">{fmtDuration(row.ms)}</div>
    </div>
  );
}
