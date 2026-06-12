import { type ReactNode, useMemo, useState } from "react";
import { fmtCompact, niceTicks, useContainerWidth } from "./chart-utils.ts";
import "./charts.css";

/**
 * One dot of the scatter (v7 spec §C2 — FROZEN props). Callers resolve colors
 * (colorForGroup + HARNESS_COLORS/VENDOR_COLORS) and pre-filter null axes —
 * a point missing either coordinate is simply not passed in.
 */
export interface ScatterPoint {
  /** Stable id (model key / config id). */
  key: string;
  /** Hover title + optional inline dot label. */
  label: string;
  x: number;
  y: number;
  /** Resolved CSS color; default = var(--accent). */
  color?: string;
  /** Legend group ("claude", "anthropic", …); legend shows distinct groups. */
  group?: string;
  /** Dot radius in px (caller may scale by attempts). Default 5. */
  r?: number;
  /** Rich hover card; default = label + formatted x/y rows. */
  tip?: ReactNode;
}

/**
 * Shaded "most attractive quadrant" (à la artificialanalysis.ai): the corner
 * region past the MEDIAN split of the plotted points on both axes.
 */
export interface ScatterQuadrant {
  x: "low" | "high";
  y: "low" | "high";
  /** Corner caption. Default "most attractive quadrant". */
  label?: string;
}

const MARGIN = { top: 14, right: 16, bottom: 34, left: 52 };
const DEFAULT_HEIGHT = 280;

function median(sorted: number[]): number {
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? (sorted[mid] as number)
    : ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
}

/**
 * XY scatter chart (v7 spec §C2 — FROZEN props). Hand-rolled theme-aware SVG,
 * no deps: median-split quadrant shading, per-group legend, nearest-point
 * hover tooltip, optional inline dot labels for small datasets.
 */
export function ScatterChart(props: {
  points: ScatterPoint[];
  height?: number;
  xLabel?: string;
  yLabel?: string;
  xFormat?: (v: number) => string;
  yFormat?: (v: number) => string;
  quadrant?: ScatterQuadrant | null;
  /** Inline labels next to dots — readable up to ~20 points. */
  showLabels?: boolean;
  emptyText?: string;
}): ReactNode {
  const [ref, width] = useContainerWidth();
  const [hoverKey, setHoverKey] = useState<string | null>(null);
  const height = props.height ?? DEFAULT_HEIGHT;
  const xFormat = props.xFormat ?? fmtCompact;
  const yFormat = props.yFormat ?? fmtCompact;

  const layout = useMemo(() => {
    const pts = props.points.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
    if (pts.length === 0) return null;
    const pad = (lo: number, hi: number): [number, number] => {
      if (lo === hi) return [lo - (Math.abs(lo) || 1) * 0.2, hi + (Math.abs(hi) || 1) * 0.2];
      const d = (hi - lo) * 0.08;
      return [lo - d, hi + d];
    };
    const xs = pts.map((p) => p.x).sort((a, b) => a - b);
    const ys = pts.map((p) => p.y).sort((a, b) => a - b);
    const [x0, x1] = pad(Math.min(...xs), Math.max(...xs));
    const [y0raw, y1] = pad(Math.min(0, ...ys), Math.max(...ys));
    const y0 = Math.min(0, y0raw);
    return { pts, x0, x1, y0, y1, xMed: median(xs), yMed: median(ys) };
  }, [props.points]);

  if (width === 0 || layout === null) {
    return (
      <div className="chart" ref={ref}>
        <div className="chart-empty">{props.emptyText ?? "No data"}</div>
      </div>
    );
  }

  const { pts, x0, x1, y0, y1, xMed, yMed } = layout;
  const innerW = Math.max(40, width - MARGIN.left - MARGIN.right);
  const innerH = Math.max(40, height - MARGIN.top - MARGIN.bottom);
  const sx = (v: number) => MARGIN.left + ((v - x0) / (x1 - x0)) * innerW;
  const sy = (v: number) => MARGIN.top + innerH - ((v - y0) / (y1 - y0)) * innerH;

  // Quadrant rect: from the median split lines to the matching corner.
  const quadrant = props.quadrant ?? null;
  const quadRect =
    quadrant === null
      ? null
      : {
          x: quadrant.x === "low" ? MARGIN.left : sx(xMed),
          w: quadrant.x === "low" ? sx(xMed) - MARGIN.left : MARGIN.left + innerW - sx(xMed),
          y: quadrant.y === "high" ? MARGIN.top : sy(yMed),
          h: quadrant.y === "high" ? sy(yMed) - MARGIN.top : MARGIN.top + innerH - sy(yMed),
        };

  const groups: { name: string; color: string }[] = [];
  for (const p of pts) {
    if (p.group && !groups.some((g) => g.name === p.group)) {
      groups.push({ name: p.group, color: p.color ?? "var(--accent)" });
    }
  }

  const hovered = hoverKey === null ? null : (pts.find((p) => p.key === hoverKey) ?? null);

  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    let best: { key: string; d: number } | null = null;
    for (const p of pts) {
      const d = Math.hypot(sx(p.x) - mx, sy(p.y) - my);
      if (d <= 18 && (best === null || d < best.d)) best = { key: p.key, d };
    }
    setHoverKey(best?.key ?? null);
  };

  return (
    <div className="chart" ref={ref}>
      <svg
        width={width}
        height={height}
        role="img"
        aria-label="scatter chart"
        onMouseMove={onMove}
        onMouseLeave={() => setHoverKey(null)}
      >
        {quadRect !== null && quadRect.w > 0 && quadRect.h > 0 ? (
          <>
            <rect
              className="chart-quadrant"
              x={quadRect.x}
              y={quadRect.y}
              width={quadRect.w}
              height={quadRect.h}
            />
            <text
              className="chart-quadrant-label"
              x={quadRect.x + 6}
              y={quadRect.y + 12}
              textAnchor="start"
            >
              {quadrant?.label ?? "most attractive quadrant"}
            </text>
          </>
        ) : null}
        {niceTicks(y0, y1).map((t) => (
          <g key={`y${t}`}>
            <line
              className="chart-grid-line"
              x1={MARGIN.left}
              x2={MARGIN.left + innerW}
              y1={sy(t)}
              y2={sy(t)}
            />
            <text className="chart-tick" x={MARGIN.left - 6} y={sy(t) + 3} textAnchor="end">
              {yFormat(t)}
            </text>
          </g>
        ))}
        {niceTicks(x0, x1, 6).map((t) => (
          <text
            key={`x${t}`}
            className="chart-tick"
            x={sx(t)}
            y={MARGIN.top + innerH + 14}
            textAnchor="middle"
          >
            {xFormat(t)}
          </text>
        ))}
        <line
          className="chart-axis-line"
          x1={MARGIN.left}
          x2={MARGIN.left + innerW}
          y1={MARGIN.top + innerH}
          y2={MARGIN.top + innerH}
        />
        {props.xLabel ? (
          <text
            className="chart-axis-label"
            x={MARGIN.left + innerW / 2}
            y={height - 4}
            textAnchor="middle"
          >
            {props.xLabel}
          </text>
        ) : null}
        {props.yLabel ? (
          <text
            className="chart-axis-label"
            transform={`translate(10 ${MARGIN.top + innerH / 2}) rotate(-90)`}
            textAnchor="middle"
          >
            {props.yLabel}
          </text>
        ) : null}
        {pts.map((p) => (
          <g key={p.key}>
            <circle
              className={p.key === hoverKey ? "chart-scatter-dot hover" : "chart-scatter-dot"}
              cx={sx(p.x)}
              cy={sy(p.y)}
              r={p.r ?? 5}
              fill={p.color ?? "var(--accent)"}
            />
            {props.showLabels ? (
              <text className="chart-scatter-label" x={sx(p.x) + (p.r ?? 5) + 3} y={sy(p.y) + 3}>
                {p.label}
              </text>
            ) : null}
          </g>
        ))}
      </svg>
      {groups.length > 1 ? (
        <div className="chart-legend">
          {groups.map((g) => (
            <span className="chart-legend-item" key={g.name}>
              <span className="chart-dot" style={{ background: g.color }} />
              {g.name}
            </span>
          ))}
        </div>
      ) : null}
      {hovered !== null ? (
        <div
          className="chart-tip"
          style={{
            left: Math.min(sx(hovered.x) + 10, width - 160),
            top: Math.max(4, sy(hovered.y) - 14),
          }}
        >
          {hovered.tip ?? (
            <>
              <div className="chart-tip-title">{hovered.label}</div>
              <div className="chart-tip-row">
                <span>{props.xLabel ?? "x"}</span>
                <span className="chart-tip-value">{xFormat(hovered.x)}</span>
              </div>
              <div className="chart-tip-row">
                <span>{props.yLabel ?? "y"}</span>
                <span className="chart-tip-value">{yFormat(hovered.y)}</span>
              </div>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
