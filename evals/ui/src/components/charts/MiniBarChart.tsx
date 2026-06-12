import { type ReactNode, useMemo } from "react";
import { fmtCompact, useContainerWidth } from "./chart-utils.ts";
import "./charts.css";

/**
 * One bar of a highlights mini chart (v7 spec §C3 — FROZEN props). Callers
 * resolve colors (colorForGroup) and pre-filter nulls; bars render in the
 * given order (caller sorts).
 */
export interface MiniBar {
  key: string;
  label: string;
  value: number;
  /** Resolved CSS color; default = var(--accent). */
  color?: string;
}

const MARGIN = { top: 16, bottom: 34 };
const DEFAULT_HEIGHT = 170;
const MAX_LABEL_CHARS = 14;

/**
 * Vertical mini bar chart for the analytics highlights row (à la the
 * artificialanalysis.ai Intelligence/Speed/Price cards): one colored bar per
 * entry, value label on top, slanted name labels underneath. Theme-aware
 * hand-rolled SVG, no deps.
 */
export function MiniBarChart(props: {
  bars: MiniBar[];
  height?: number;
  /** Value-label format; default fmtCompact. */
  format?: (v: number) => string;
  emptyText?: string;
}): ReactNode {
  const [ref, width] = useContainerWidth();
  const height = props.height ?? DEFAULT_HEIGHT;
  const format = props.format ?? fmtCompact;

  const max = useMemo(() => {
    const values = props.bars.map((b) => b.value).filter((v) => Number.isFinite(v));
    return values.length > 0 ? Math.max(...values, 0) : null;
  }, [props.bars]);

  if (width === 0 || max === null || props.bars.length === 0) {
    return (
      <div className="chart" ref={ref}>
        <div className="chart-empty">{props.emptyText ?? "No data"}</div>
      </div>
    );
  }

  const innerH = Math.max(20, height - MARGIN.top - MARGIN.bottom);
  const scaleMax = max > 0 ? max : 1;
  const slot = width / props.bars.length;
  const barW = Math.max(6, Math.min(34, slot * 0.62));

  return (
    <div className="chart" ref={ref}>
      <svg width={width} height={height} role="img" aria-label="mini bar chart">
        {props.bars.map((b, i) => {
          const h = Math.max(1, (Math.max(0, b.value) / scaleMax) * innerH);
          const cx = slot * i + slot / 2;
          const y = MARGIN.top + innerH - h;
          const label =
            b.label.length > MAX_LABEL_CHARS
              ? `${b.label.slice(0, MAX_LABEL_CHARS - 1)}…`
              : b.label;
          return (
            <g key={b.key}>
              <title>{`${b.label}: ${format(b.value)}`}</title>
              <rect
                className="chart-minibar"
                x={cx - barW / 2}
                y={y}
                width={barW}
                height={h}
                rx={2}
                fill={b.color ?? "var(--accent)"}
              />
              <text className="chart-minibar-value" x={cx} y={y - 4} textAnchor="middle">
                {format(b.value)}
              </text>
              <text
                className="chart-minibar-label"
                transform={`translate(${cx} ${MARGIN.top + innerH + 10}) rotate(-28)`}
                textAnchor="end"
              >
                {label}
              </text>
            </g>
          );
        })}
        <line
          className="chart-axis-line"
          x1={0}
          x2={width}
          y1={MARGIN.top + innerH}
          y2={MARGIN.top + innerH}
        />
      </svg>
    </div>
  );
}
