import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { getTranscript } from "../api.ts";
import { HarnessIcon } from "../components/HarnessIcon.tsx";
import { JsonView } from "../components/JsonView.tsx";
import { Markdown } from "../components/Markdown.tsx";
import { Spinner } from "../components/Spinner.tsx";
import { CostBadge, StatusBadge } from "../components/StatusBadge.tsx";
import { Tooltip } from "../components/Tooltip.tsx";
import { usePoll } from "../hooks.ts";
import {
  itemsToParsedMessages,
  normalizeSessionLogs,
  type ParsedMessage,
  type ProviderMetaBlock,
  type SessionLogRecord,
  type ToolResultBlock,
  type ToolUseBlock,
} from "../logs-parser/index.ts";
import type { AttemptTaskJson } from "../types.ts";
import "./transcript.css";

const THINKING_COLLAPSE = 400;
/** Successful tool results clip earlier (item 8 — no walls of monospace). */
const RESULT_CLIP = 700;
const ERROR_RESULT_CLIP = 2_000;
const RAW_CLIP = 2_000;

interface MetaLine {
  key: string;
  block: ProviderMetaBlock;
}

type Entry =
  | { kind: "divider"; key: string; iteration: number }
  | { kind: "msg"; key: string; msg: ParsedMessage }
  | { kind: "metas"; key: string; lines: MetaLine[] }
  | { kind: "raw"; key: string; cli: string; content: string; iteration: number };

interface BuiltTranscript {
  entries: Entry[];
  messageCount: number;
  /** Rows that contributed nothing to a parsed message — rendered as raw fallbacks. */
  unparsedCount: number;
  resultById: Map<string, ToolResultBlock>;
  callIds: Set<string>;
}

/**
 * Item 15 — render ALL rows. Every source row either contributes to a parsed
 * message (text/tool/meta blocks) or renders in place as a `.t-raw` fallback;
 * nothing is silently dropped.
 */
function buildTranscript(rows: SessionLogRecord[]): BuiltTranscript {
  const result = normalizeSessionLogs(rows);

  // Rows that failed JSONL decode render as raw text, not buried meta lines.
  const rawRecIds = new Set<string>();
  const items = result.items.filter((item) => {
    if (item.kind !== "parse_error") return true;
    rawRecIds.add(item.recId);
    return false;
  });
  const messages = itemsToParsedMessages(items);

  // Coverage: source rows that produced at least one content block.
  const covered = new Set<string>();
  for (const item of items) {
    if (item.kind === "tool_call" && !item.tool) continue;
    if (item.kind === "tool_result" && !item.result) continue;
    covered.add(item.recId);
    for (const id of item.coveredRecIds ?? []) covered.add(id);
  }

  const messagesByRec = new Map<string, ParsedMessage[]>();
  for (const msg of messages) {
    const list = messagesByRec.get(msg.id);
    if (list) list.push(msg);
    else messagesByRec.set(msg.id, [msg]);
  }

  // Pair tool results to their calls across ALL messages by tool_use_id.
  const resultById = new Map<string, ToolResultBlock>();
  const callIds = new Set<string>();
  for (const msg of messages) {
    for (const block of msg.content) {
      if (block.type === "tool_result") resultById.set(block.tool_use_id, block);
      else if (block.type === "tool_use") callIds.add(block.id);
    }
  }

  // Interleave: messages render at their first source row; uncovered rows
  // become raw entries in their original position.
  type SeqNode =
    | { kind: "msg"; msg: ParsedMessage }
    | { kind: "raw"; key: string; cli: string; content: string; iteration: number };
  const sequence: SeqNode[] = [];
  const emitted = new Set<string>();
  let unparsedCount = 0;
  result.ordered.forEach((d, i) => {
    const rec = d.rec;
    if (!rawRecIds.has(rec.id)) {
      const msgs = messagesByRec.get(rec.id);
      if (msgs && !emitted.has(rec.id)) {
        emitted.add(rec.id);
        for (const msg of msgs) sequence.push({ kind: "msg", msg });
        return;
      }
      if (covered.has(rec.id)) return;
    }
    unparsedCount++;
    sequence.push({
      kind: "raw",
      key: `raw-${i}`,
      cli: rec.cli,
      content: rec.content,
      iteration: rec.iteration,
    });
  });

  // Iteration dividers + collapsing of consecutive meta-only messages.
  const entries: Entry[] = [];
  let prevIteration: number | null = null;
  sequence.forEach((node, i) => {
    const iteration = node.kind === "msg" ? node.msg.iteration : node.iteration;
    const crossed = prevIteration !== null && iteration !== prevIteration;
    if (crossed) entries.push({ kind: "divider", key: `div-${i}`, iteration });
    prevIteration = iteration;

    if (node.kind === "raw") {
      entries.push(node);
      return;
    }
    const msg = node.msg;
    const metas = msg.content.filter((b): b is ProviderMetaBlock => b.type === "provider_meta");
    if (metas.length > 0 && metas.length === msg.content.length) {
      // meta-only message — consecutive ones collapse into one group
      const lines = metas.map((block, j) => ({ key: `m-${i}-${j}`, block }));
      const last = entries[entries.length - 1];
      if (last && last.kind === "metas") last.lines.push(...lines);
      else entries.push({ kind: "metas", key: `metas-${i}`, lines });
    } else {
      entries.push({ kind: "msg", key: `msg-${i}`, msg });
    }
  });

  return { entries, messageCount: messages.length, unparsedCount, resultById, callIds };
}

/** Per-task status/skip info for the §1 sub-tab glyphs (from tasks.json). */
export interface TranscriptTaskStatus {
  status: string | null;
  skipped: boolean;
}

export default function Transcript(props: {
  attemptId: string;
  live?: boolean;
  /** v7 §1: attempt.taskIds in creation order — fixes sub-tab order + labels. */
  taskIds?: string[];
  /** v7 §1: taskId → display title (from the tasks.json artifact when loaded). */
  taskTitles?: Record<string, string>;
  /** v7 §1: taskId → status/skip info — drives the sub-tab status glyphs. */
  taskStatuses?: Record<string, TranscriptTaskStatus>;
  /**
   * v7.5 items 2/6: taskId → full per-task record (GET /api/attempts/:id/tasks)
   * — drives the selected sub-tab's header (status chip, outcome/error clamp,
   * per-task cost). Optional/additive: absent ⇒ no header (pre-v7.5 behavior).
   */
  taskRecords?: Record<string, AttemptTaskJson> | null;
  /** v7 §10.3: Workers-panel task chips focus a sub-tab (nonce re-triggers). */
  focusTask?: { taskId: string; nonce: number } | null;
}): ReactNode {
  const live = props.live === true;
  const { data, error } = usePoll(
    () => getTranscript(props.attemptId, { live }),
    live ? 5000 : null,
    [props.attemptId, live],
  );

  const rows = data?.source === "raw-session-logs" ? (data.rows ?? null) : null;

  // §1 frozen rule: sub-tabs render only when the rows span > 1 distinct
  // non-empty taskId. Tab set = props.taskIds ∪ row taskIds (tasks without any
  // rows — e.g. skipped dependents — keep a visible tab); order = props.taskIds
  // first, then first appearance in rows.
  const taskTabs = useMemo<string[] | null>(() => {
    if (rows === null) return null;
    const inRows: string[] = [];
    const seen = new Set<string>();
    for (const r of rows) {
      if (r.taskId !== "" && !seen.has(r.taskId)) {
        seen.add(r.taskId);
        inRows.push(r.taskId);
      }
    }
    if (seen.size < 2) return null;
    const ordered: string[] = [];
    for (const id of [...(props.taskIds ?? []), ...inRows]) {
      if (id !== "" && !ordered.includes(id)) ordered.push(id);
    }
    return ordered;
  }, [rows, props.taskIds]);

  // null = "All" (default). A selection whose tab disappears falls back to All;
  // the selection itself persists across live polls (component state).
  const [selectedTask, setSelectedTask] = useState<string | null>(null);
  const activeTask =
    selectedTask !== null && taskTabs !== null && taskTabs.includes(selectedTask)
      ? selectedTask
      : null;

  // v7.5 items 2/6: the full record behind the selected sub-tab — drives the
  // header below the sticky bar. Absent records (taskRecords null/undefined,
  // e.g. older servers or v1-era attempts) ⇒ no header (pre-v7.5 behavior).
  const activeRecord = activeTask !== null ? (props.taskRecords?.[activeTask] ?? null) : null;

  // Focus requests from the Workers panel — each nonce applies at most once
  // (the page scopes focusTask to the current attempt, so 0 is a safe baseline).
  const appliedFocus = useRef(0);
  useEffect(() => {
    const f = props.focusTask;
    if (!f || f.nonce === appliedFocus.current) return;
    if (taskTabs?.includes(f.taskId) === true) {
      appliedFocus.current = f.nonce;
      setSelectedTask(f.taskId);
    }
  }, [props.focusTask, taskTabs]);

  // §1: filtering is client-side and reapplied on every poll; rows with an
  // empty taskId (synthesized fallback rows) appear ONLY under All.
  const visibleRows = useMemo(
    () =>
      rows !== null && activeTask !== null ? rows.filter((r) => r.taskId === activeTask) : rows,
    [rows, activeTask],
  );

  const built = useMemo(
    () => (visibleRows !== null ? buildTranscript(visibleRows) : null),
    [visibleRows],
  );

  if (!data) {
    return (
      <div className="transcript">
        {error ? (
          <div className="t-empty dim">Transcript failed to load: {error}</div>
        ) : (
          <div className="t-empty">
            <Spinner label="Loading transcript…" />
          </div>
        )}
      </div>
    );
  }

  if (data.source === null) {
    return (
      <div className="transcript">
        <div className="t-empty dim">No transcript captured</div>
        {live ? <Footer /> : null}
      </div>
    );
  }

  if (data.source === "transcript") {
    return (
      <div className="transcript">
        <Caption harness={data.harness} live={false}>
          <span className="t-caption-sep">·</span>
          <span>Legacy flat transcript (older run)</span>
        </Caption>
        <pre className="t-flat">{data.text ?? ""}</pre>
        {live ? <Footer /> : null}
      </div>
    );
  }

  const rowCount = visibleRows?.length ?? 0;
  return (
    <div className="transcript">
      {/* v7.5 item 4: caption (Live pulse) + tab row pin to the top of the
          .rd-tab-content scrollport while the transcript scrolls. */}
      <div className="tr-stickybar">
        <Caption harness={data.harness} live={data.live === true}>
          <span className="t-caption-sep">·</span>
          <span>{rowCount.toLocaleString()} Events</span>
          <span className="t-caption-sep">·</span>
          <span>{(built?.messageCount ?? 0).toLocaleString()} Messages</span>
          {built && built.unparsedCount > 0 ? (
            <>
              <span className="t-caption-sep">·</span>
              <Tooltip text="Rows the parser could not decode — rendered below as raw text">
                <span className="t-unparsed">{built.unparsedCount.toLocaleString()} Unparsed</span>
              </Tooltip>
            </>
          ) : null}
        </Caption>
        {taskTabs !== null ? (
          <TaskTabs
            tabs={taskTabs}
            active={activeTask}
            titles={props.taskTitles}
            statuses={props.taskStatuses}
            records={props.taskRecords}
            onSelect={setSelectedTask}
          />
        ) : null}
      </div>
      {activeRecord !== null ? <TaskTabHeader rec={activeRecord} /> : null}
      {rowCount === 0 ? (
        <div className="t-empty dim">
          {activeTask === null
            ? "No events yet"
            : resolveTaskStatus(activeTask, props.taskRecords, props.taskStatuses)?.skipped === true
              ? "No events for this task — it was skipped (failed dependency)"
              : "No events for this task"}
        </div>
      ) : null}
      {built?.entries.map((entry) => {
        switch (entry.kind) {
          case "divider": {
            return (
              <div className="t-divider" key={entry.key}>
                — Iteration {entry.iteration} —
              </div>
            );
          }
          case "metas": {
            return <MetaGroup lines={entry.lines} key={entry.key} />;
          }
          case "raw": {
            return <RawRow cli={entry.cli} content={entry.content} key={entry.key} />;
          }
          default: {
            return (
              <MessageCard
                msg={entry.msg}
                resultById={built.resultById}
                callIds={built.callIds}
                key={entry.key}
              />
            );
          }
        }
      })}
      {live ? <Footer /> : null}
    </div>
  );
}

function Caption(props: {
  harness: string | null;
  live: boolean;
  children?: ReactNode;
}): ReactNode {
  return (
    <div className="t-caption">
      {props.live ? (
        <Tooltip text="Streaming from the attempt's sandbox — refreshes every 5s">
          <span className="t-live pulse">● Live</span>
        </Tooltip>
      ) : null}
      {props.harness ? (
        <HarnessIcon harness={props.harness} size={13} showLabel />
      ) : (
        <span className="dim">Unknown harness</span>
      )}
      {props.children}
    </div>
  );
}

function Footer(): ReactNode {
  return (
    <div className="t-footer">
      <Spinner label="Streaming…" />
    </div>
  );
}

// ---- per-task sub-tabs (v7 §1) ----

const TASK_TITLE_CLIP = 32;

function clipTitle(s: string): string {
  return s.length > TASK_TITLE_CLIP ? `${s.slice(0, TASK_TITLE_CLIP - 1)}…` : s;
}

interface TrTabGlyph {
  glyph: string;
  tone: string;
  label: string;
}

/**
 * v7.5 item 4: per-tab status source. The frozen task payload (GET
 * /api/attempts/:id/tasks via the `taskRecords` prop) wins; the round-7
 * tasks.json-derived `taskStatuses` map is the fallback. `undefined` means no
 * record at all (e.g. v1-era attempts) — callers render NO indicator then.
 */
function resolveTaskStatus(
  taskId: string,
  records: Record<string, AttemptTaskJson> | null | undefined,
  statuses: Record<string, TranscriptTaskStatus> | undefined,
): TranscriptTaskStatus | undefined {
  const rec = records?.[taskId];
  if (rec !== undefined) return { status: rec.status, skipped: rec.skipped };
  return statuses?.[taskId];
}

/** Static status glyph per sub-tab (no spinners — single-animation rule). */
function taskTabGlyph(st: TranscriptTaskStatus): TrTabGlyph {
  if (st.skipped) return { glyph: "⊘", tone: "dim", label: "Skipped (failed dependency)" };
  const s = (st.status ?? "").toLowerCase();
  if (s === "completed" || s === "done") return { glyph: "✓", tone: "green", label: "Completed" };
  if (s === "failed" || s === "error") return { glyph: "✗", tone: "red", label: "Failed" };
  if (s === "in_progress" || s === "running") {
    return { glyph: "◔", tone: "accent", label: "In Progress" };
  }
  if (s === "pending" || s === "created" || s === "assigned") {
    return { glyph: "○", tone: "dim", label: "Pending" };
  }
  if (s === "") return { glyph: "•", tone: "neutral", label: "Status unknown" };
  return { glyph: "•", tone: "neutral", label: s };
}

/** Severity rank for the All-tab aggregate — higher is worse. */
function statusRank(st: TranscriptTaskStatus): number {
  if (st.skipped) return 2;
  const s = (st.status ?? "").toLowerCase();
  if (s === "failed" || s === "error") return 5;
  if (s === "in_progress" || s === "running") return 4;
  if (s === "pending" || s === "created" || s === "assigned") return 3;
  if (s === "completed" || s === "done") return 0;
  return 1; // unknown status string — worse than completed, better than pending
}

/**
 * v7.5 item 4 convention: the All tab shows the WORST known task status
 * (failed > in-progress > pending > skipped > unknown > completed); when no
 * task has a known status (records absent — v1-era) it shows no indicator.
 */
function aggregateTabGlyph(
  tabs: string[],
  resolve: (taskId: string) => TranscriptTaskStatus | undefined,
): TrTabGlyph | null {
  let worst: TranscriptTaskStatus | null = null;
  let worstRank = -1;
  for (const taskId of tabs) {
    const st = resolve(taskId);
    if (st === undefined) continue;
    const rank = statusRank(st);
    if (rank > worstRank) {
      worstRank = rank;
      worst = st;
    }
  }
  return worst === null ? null : taskTabGlyph(worst);
}

function TaskTabs(props: {
  tabs: string[];
  active: string | null;
  titles?: Record<string, string>;
  statuses?: Record<string, TranscriptTaskStatus>;
  /** v7.5: frozen per-task records — preferred status source (see resolveTaskStatus). */
  records?: Record<string, AttemptTaskJson> | null;
  onSelect: (taskId: string | null) => void;
}): ReactNode {
  const resolve = (taskId: string): TranscriptTaskStatus | undefined =>
    resolveTaskStatus(taskId, props.records, props.statuses);
  const allGlyph = aggregateTabGlyph(props.tabs, resolve);
  return (
    <div className="t-tasktabs">
      <button
        type="button"
        className={props.active === null ? "t-tasktab selected" : "t-tasktab"}
        title={`All events, including rows without a task id${
          allGlyph ? `\nWorst task status: ${allGlyph.label}` : ""
        }`}
        onClick={() => props.onSelect(null)}
      >
        {allGlyph !== null ? (
          <span className={`t-tasktab-glyph tone-${allGlyph.tone}`} aria-hidden="true">
            {allGlyph.glyph}
          </span>
        ) : null}
        All
      </button>
      {props.tabs.map((taskId, i) => {
        const st = resolve(taskId);
        const glyph = st !== undefined ? taskTabGlyph(st) : null;
        const title = props.titles?.[taskId];
        return (
          <button
            type="button"
            key={taskId}
            className={props.active === taskId ? "t-tasktab selected" : "t-tasktab"}
            title={glyph !== null ? `${taskId}\n${glyph.label}` : taskId}
            onClick={() => props.onSelect(taskId)}
          >
            {glyph !== null ? (
              <span className={`t-tasktab-glyph tone-${glyph.tone}`} aria-hidden="true">
                {glyph.glyph}
              </span>
            ) : null}
            Task {i + 1}
            {title !== undefined ? (
              <span className="t-tasktab-title"> · {clipTitle(title)}</span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

/**
 * v7.5 items 2/6: header for the SELECTED sub-tab — StatusBadge-style status
 * chip, outcome/error clamped + expandable (cascade-skipped reads distinctly
 * from a real error, v6 §9 semantics) and the per-task CostBadge. Every field
 * degrades to absent/"—" on all-null records ("task-ids" source, v1-era rows).
 */
function TaskTabHeader(props: { rec: AttemptTaskJson }): ReactNode {
  const rec = props.rec;
  const info = taskTabGlyph({ status: rec.status, skipped: rec.skipped });
  const statusTip = [rec.id, info.label, rec.agentId !== null ? `Agent ${rec.agentId}` : null]
    .filter((line): line is string => line !== null)
    .join("\n");
  return (
    <div className="t-taskhead">
      <div className="t-taskhead-row">
        <Tooltip text={statusTip}>
          <span className={`t-taskhead-status tone-${info.tone}`}>
            <span className="t-tasktab-glyph" aria-hidden="true">
              {info.glyph}
            </span>
            {info.label}
          </span>
        </Tooltip>
        {/* Same labeling as the round-7 member cost: harness-reported Σ. */}
        <Tooltip text="Harness-reported Σ session cost for this task — a recomputed attempt cost may differ">
          <span className="t-taskhead-cost">
            <CostBadge costUsd={rec.costUsd} source={null} />
          </span>
        </Tooltip>
      </div>
      {rec.error !== null ? (
        <div className={rec.skipped ? "t-taskhead-detail skip" : "t-taskhead-detail error"}>
          <div className="t-result-head">
            {rec.skipped ? "⊘ Skipped (failed dependency)" : "↳ Error"}
          </div>
          <ClippedText text={rec.error} clip={ERROR_RESULT_CLIP} />
        </div>
      ) : null}
      {rec.outcome !== null ? (
        <div className="t-taskhead-detail">
          <div className="t-result-head">↳ Outcome</div>
          <ClippedText text={rec.outcome} clip={RESULT_CLIP} />
        </div>
      ) : null}
    </div>
  );
}

// ---- per-event-type components (item 15; polish item 8) ----

const ROLE_GLYPHS: Record<ParsedMessage["role"], string> = {
  assistant: "✦",
  user: "◆",
  system: "○",
};

function fmtTime(iso: string): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleTimeString(undefined, { hour12: false });
}

function MessageCard(props: {
  msg: ParsedMessage;
  resultById: Map<string, ToolResultBlock>;
  callIds: Set<string>;
}): ReactNode {
  const { msg, resultById, callIds } = props;
  const rendered: ReactNode[] = [];
  // blocks never reorder within a parsed message — positional keys are stable
  let pos = 0;
  for (const block of msg.content) {
    const key = `b${pos++}`;
    switch (block.type) {
      case "text": {
        if (block.text) {
          rendered.push(<TextView text={block.text} role={msg.role} key={key} />);
        }
        break;
      }
      case "thinking": {
        rendered.push(<Thinking text={block.thinking} key={key} />);
        break;
      }
      case "tool_use": {
        rendered.push(
          <ToolCard call={block} result={resultById.get(block.id) ?? null} key={key} />,
        );
        break;
      }
      case "tool_result": {
        // paired results render inline under their call; only orphans render standalone
        if (!callIds.has(block.tool_use_id)) {
          rendered.push(<OrphanResult result={block} key={key} />);
        }
        break;
      }
      case "provider_meta": {
        rendered.push(<MetaLineView block={block} key={key} />);
        break;
      }
    }
  }
  if (rendered.length === 0) {
    const onlyPairedResults = msg.content.every(
      (b) => b.type === "tool_result" && callIds.has(b.tool_use_id),
    );
    if (onlyPairedResults) return null; // those rows render under their tool calls
    rendered.push(
      <div className="t-text dim" key="empty">
        (Empty message)
      </div>,
    );
  }
  const time = fmtTime(msg.timestamp);
  return (
    <div className={`t-msg t-${msg.role}`}>
      <div className="t-head">
        <span className={`t-glyph t-glyph-${msg.role}`} aria-hidden="true">
          {ROLE_GLYPHS[msg.role]}
        </span>
        <span className="t-role">{msg.role}</span>
        {time ? <span className="t-time">{time}</span> : null}
      </div>
      {rendered}
    </div>
  );
}

/** Assistant prose renders as markdown (item 8); other roles stay plain pre-wrap text. */
function TextView(props: { text: string; role: ParsedMessage["role"] }): ReactNode {
  if (props.role === "assistant") {
    return (
      <div className="t-text">
        <Markdown text={props.text} />
      </div>
    );
  }
  return <div className="t-text t-text-plain">{props.text}</div>;
}

function Thinking(props: { text: string }): ReactNode {
  const collapsible = props.text.length > THINKING_COLLAPSE;
  const [open, setOpen] = useState(!collapsible);
  if (!open) {
    return (
      <button type="button" className="t-toggle" onClick={() => setOpen(true)}>
        ▸ Thinking ({props.text.length.toLocaleString()} chars)
      </button>
    );
  }
  return (
    <div className="t-thinking-wrap">
      {collapsible ? (
        <button type="button" className="t-toggle" onClick={() => setOpen(false)}>
          ▾ Thinking ({props.text.length.toLocaleString()} chars)
        </button>
      ) : null}
      <div className="t-thinking">{props.text}</div>
    </div>
  );
}

/** Result state as a shared status glyph (item 8) — ✓ / ✗ / ○ with hover info. */
function ToolStatus(props: { result: ToolResultBlock | null }): ReactNode {
  const { result } = props;
  if (result === null) return <StatusBadge status="pending" tip="No result captured" />;
  if (result.isError) return <StatusBadge status="failed" tip="Tool returned an error" />;
  return <StatusBadge status="passed" tip="Tool succeeded" />;
}

/** Keys most likely to be the human-meaningful argument, in preference order. */
const PREVIEW_KEYS = ["command", "file_path", "path", "url", "pattern"];

function plainRecord(value: unknown): Record<string, unknown> | null {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

function squash(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

/** Single-line dim preview of the first meaningful string argument (item 8). */
function argPreview(input: unknown): string | null {
  if (typeof input === "string" && input.trim().length > 0) return squash(input);
  const rec = plainRecord(input);
  if (!rec) return null;
  for (const key of PREVIEW_KEYS) {
    const v = rec[key];
    if (typeof v === "string" && v.trim().length > 0) return squash(v);
  }
  for (const v of Object.values(rec)) {
    if (typeof v === "string" && v.trim().length > 0) return squash(v);
  }
  return null;
}

function ToolCard(props: { call: ToolUseBlock; result: ToolResultBlock | null }): ReactNode {
  const { call, result } = props;
  const [argsOpen, setArgsOpen] = useState(false);
  const preview = argPreview(call.input);
  const keyCount = Object.keys(plainRecord(call.input) ?? {}).length;
  const hasInput = call.input !== undefined && call.input !== null;
  const collapseArgs = hasInput && keyCount > 1;
  return (
    <div className={`t-tool${result?.isError ? " t-tool-error" : ""}`}>
      <div className="t-tool-head">
        <span className="t-tool-name">⚙ {call.name}</span>
        {preview ? <span className="t-tool-preview">{preview}</span> : null}
        <ToolStatus result={result} />
      </div>
      {collapseArgs ? (
        <div className="t-tool-args">
          <button type="button" className="t-toggle" onClick={() => setArgsOpen(!argsOpen)}>
            {argsOpen ? "▾" : "▸"} Args ({keyCount})
          </button>
          {argsOpen ? <JsonView value={call.input} collapseDepth={1} /> : null}
        </div>
      ) : null}
      {hasInput && !collapseArgs ? <JsonView value={call.input} collapseDepth={1} /> : null}
      {result ? <ResultBody result={result} /> : null}
    </div>
  );
}

function OrphanResult(props: { result: ToolResultBlock }): ReactNode {
  return (
    <div className={`t-tool${props.result.isError ? " t-tool-error" : ""}`}>
      <div className="t-tool-head">
        <span className="t-tool-name">
          ⚙ Tool Result <span className="dim">{props.result.tool_use_id}</span>
        </span>
        <ToolStatus result={props.result} />
      </div>
      <ResultBody result={props.result} />
    </div>
  );
}

function ClippedText(props: { text: string; clip?: number }): ReactNode {
  const clip = props.clip ?? RESULT_CLIP;
  const [full, setFull] = useState(false);
  const clippable = props.text.length > clip;
  const clipped = !full && clippable;
  return (
    <>
      <pre>{clipped ? `${props.text.slice(0, clip)}…` : props.text}</pre>
      {clippable ? (
        <button type="button" className="t-toggle" onClick={() => setFull(!full)}>
          {full ? "Show Less" : `Show All (${props.text.length.toLocaleString()} chars)`}
        </button>
      ) : null}
    </>
  );
}

function ResultBody(props: { result: ToolResultBlock }): ReactNode {
  const { result } = props;
  if (!result.content) {
    return <div className="t-tool-result dim">(Empty result)</div>;
  }
  return (
    <div className={`t-tool-result${result.isError ? " error" : ""}`}>
      <div className="t-result-head">↳ {result.isError ? "Error" : "Result"}</div>
      <ClippedText text={result.content} clip={result.isError ? ERROR_RESULT_CLIP : RESULT_CLIP} />
    </div>
  );
}

const META_KIND_LABELS: Record<ProviderMetaBlock["kind"], string> = {
  status: "Status",
  structured_output: "Structured Output",
  internal: "Internal",
  helper: "Helper",
  lifecycle: "Lifecycle",
  result: "Result",
  file_change: "File Change",
  parse_error: "Parse Error",
  unknown: "Unknown",
};

function MetaLineView(props: { block: ProviderMetaBlock }): ReactNode {
  const { block } = props;
  const [open, setOpen] = useState(false);
  const dataType = typeof block.data.type === "string" ? block.data.type : "";
  return (
    <div className="t-meta">
      <button type="button" className="t-toggle" onClick={() => setOpen(!open)}>
        {open ? "▾" : "▸"} · {META_KIND_LABELS[block.kind]}
        {dataType ? `: ${dataType}` : ""}
      </button>
      {open ? <JsonView value={block.data} collapseDepth={1} /> : null}
    </div>
  );
}

function MetaGroup(props: { lines: MetaLine[] }): ReactNode {
  const [open, setOpen] = useState(false);
  if (props.lines.length === 1) return <MetaLineView block={props.lines[0].block} />;
  return (
    <div className="t-meta-group">
      <button type="button" className="t-toggle" onClick={() => setOpen(!open)}>
        {open ? "▾" : "▸"} · {props.lines.length} Internal Events
      </button>
      {open ? props.lines.map((l) => <MetaLineView block={l.block} key={l.key} />) : null}
    </div>
  );
}

/** Raw fallback for rows the parser could not decode (item 15 — nothing dropped). */
function RawRow(props: { cli: string; content: string }): ReactNode {
  return (
    <div className="t-raw">
      <div className="t-raw-head">Unparsed · {props.cli}</div>
      <ClippedText text={props.content} clip={RAW_CLIP} />
    </div>
  );
}
