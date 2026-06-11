import { type ReactNode, useMemo, useState } from "react";
import {
  artifactUrl,
  cancelRun,
  getAttempt,
  getJudgeLive,
  getRun,
  listConfigs,
  resumeRun,
} from "../api.ts";
import { type Column, DataTable } from "../components/DataTable.tsx";
import { EntityLink } from "../components/EntityLink.tsx";
import {
  fmtAgo,
  fmtBytes,
  fmtCost,
  fmtDate,
  fmtDuration,
  humanizeKey,
} from "../components/format.ts";
import { HarnessIcon } from "../components/HarnessIcon.tsx";
import { Matrix } from "../components/Matrix.tsx";
import { ModelChip } from "../components/ModelChip.tsx";
import { PrettyView } from "../components/PrettyView.tsx";
import { Elapsed, Spinner } from "../components/Spinner.tsx";
import {
  CostBadge,
  StatusBadge,
  StatusScore,
  statusGlyphInfo,
} from "../components/StatusBadge.tsx";
import { InfoTip, Tooltip } from "../components/Tooltip.tsx";
import { navigate, usePoll } from "../hooks.ts";
import type {
  ArtifactMetaJson,
  AttemptDetail,
  AttemptJson,
  ConfigJson,
  JudgeLiveResponse,
  JudgeTraceJson,
  JudgmentJson,
  RunDetail,
  SandboxInfoJson,
} from "../types.ts";
import JudgeTrace from "./JudgeTrace.tsx";
import Transcript from "./Transcript.tsx";
import Waterfall from "./Waterfall.tsx";
import "./run-details.css";

type RdTab = "transcript" | "checks" | "timings" | "assets";

function isUnfinished(status: string | null): boolean {
  return status === "pending" || status === "running" || status === "judging";
}

/** First attempt of the first cell (scenario-major), falling back to the first attempt. */
function defaultAttemptId(run: RunDetail | null): string | null {
  if (!run || run.attempts.length === 0) return null;
  for (const scenarioId of run.run.scenarioIds) {
    for (const configId of run.run.configIds) {
      const cellAttempts = run.attempts
        .filter((a) => a.scenarioId === scenarioId && a.configId === configId)
        .sort((a, b) => a.attemptIndex - b.attemptIndex);
      if (cellAttempts.length > 0) return cellAttempts[0].id;
    }
  }
  return run.attempts[0].id;
}

function safeDelta(fromIso: string, toIso: string): number | null {
  const from = Date.parse(fromIso);
  const to = Date.parse(toIso);
  if (Number.isNaN(from) || Number.isNaN(to)) return null;
  return to - from;
}

// ---- assets tab (item 16: kind → glyph with hover info, names truncated) ----

const ASSET_KIND_GLYPHS: Record<string, string> = {
  "raw-session-logs": "≋",
  transcript: "☰",
  "harness-session": "⌂",
  meta: "ⓘ",
  "sandbox-log": "▤",
};

function assetKindGlyph(kind: string): string {
  return ASSET_KIND_GLYPHS[kind] ?? "▢";
}

const ASSET_COLUMNS: Column<ArtifactMetaJson>[] = [
  {
    key: "kind",
    header: "Kind",
    width: "52px",
    align: "center",
    filterOptions: (rows) => Array.from(new Set(rows.map((r) => r.kind))).sort(),
    filterValue: (r) => r.kind,
    filterRender: (option) => (
      <>
        <span className="rd-kind-glyph">{assetKindGlyph(option)}</span> {humanizeKey(option)}
      </>
    ),
    searchText: (r) => r.kind,
    titleText: (r) => humanizeKey(r.kind),
    render: (r) => (
      <Tooltip text={humanizeKey(r.kind)}>
        <span className="rd-kind-glyph" role="img" aria-label={humanizeKey(r.kind)}>
          {assetKindGlyph(r.kind)}
        </span>
      </Tooltip>
    ),
  },
  {
    key: "name",
    header: "Name",
    searchText: (r) => r.name ?? r.id,
    render: (r) => <code className="rd-mono">{r.name ?? r.id}</code>,
  },
  {
    key: "size",
    header: "Size",
    width: "76px",
    align: "right",
    sortValue: (r) => r.size,
    searchText: (r) => fmtBytes(r.size),
    render: (r) => fmtBytes(r.size),
  },
  {
    key: "created",
    header: "Created",
    width: "92px",
    sortValue: (r) => r.createdAt,
    titleText: (r) => r.createdAt,
    render: (r) => fmtAgo(r.createdAt),
  },
  {
    key: "actions",
    header: "Actions",
    width: "130px",
    sortable: false,
    render: (r) => (
      <span className="rd-asset-actions">
        <a className="entity-link" href={artifactUrl(r.id)} target="_blank" rel="noreferrer">
          Open
        </a>
        <a className="entity-link" href={artifactUrl(r.id, { download: true })}>
          Download
        </a>
      </span>
    ),
  },
];

// ---- checks tab name (item 4: the tab label carries the verdicts) ----

function checksTabInfo(
  judgments: JudgmentJson[],
  judging: boolean,
): { node: ReactNode; title: string } {
  const checks = judgments.filter((j) => j.kind === "deterministic");
  const judges = judgments.filter((j) => j.kind !== "deterministic");
  if (judgments.length === 0 && !judging) {
    return { node: "Checks & Judgments", title: "Deterministic checks & judge verdicts" };
  }
  const passed = checks.filter((j) => j.pass).length;
  const checksText = checks.length > 0 ? `Checks ${passed}/${checks.length}` : "Checks";
  const titleParts = [
    checks.length > 0
      ? `${passed} of ${checks.length} checks passed`
      : "No deterministic checks yet",
  ];
  let judgeNode: ReactNode = null;
  if (judging) {
    judgeNode = (
      <>
        {" · Judge "}
        <Spinner />
      </>
    );
    titleParts.push("Judge running");
  } else if (judges.length > 0) {
    const allPass = judges.every((j) => j.pass);
    judgeNode = (
      <>
        {" · Judge "}
        <span className={allPass ? "tone-green" : "tone-red"}>{allPass ? "✓" : "✗"}</span>
      </>
    );
    titleParts.push(allPass ? "Judge passed" : "Judge failed");
  }
  return {
    node: (
      <>
        {checksText}
        {judgeNode}
      </>
    ),
    title: titleParts.join(" · "),
  };
}

export default function RunDetailsPage(props: {
  runId: string;
  attemptId: string | null;
}): ReactNode {
  const { runId } = props;

  // Poll cadence follows `active` from the response itself (3s live, 15s settled).
  const [active, setActive] = useState(false);
  const runPoll = usePoll(
    async () => {
      const result = await getRun(runId);
      setActive(result.active);
      return result;
    },
    active ? 3000 : 15_000,
    [runId],
  );
  const run = runPoll.data && runPoll.data.run.id === runId ? runPoll.data : null;
  const attempts = useMemo(() => run?.attempts ?? [], [run]);

  // Config catalog (one shot) — provider/harness + model fallback for the summary.
  const configsPoll = usePoll(() => listConfigs(), null, []);
  const configById = useMemo(
    () => new Map((configsPoll.data ?? []).map((c) => [c.id, c])),
    [configsPoll.data],
  );

  const selId = props.attemptId ?? defaultAttemptId(run);
  const runAttempt = selId ? (attempts.find((a) => a.id === selId) ?? null) : null;

  const attemptPoll = usePoll<AttemptDetail | null>(
    () => (selId ? getAttempt(selId) : Promise.resolve(null)),
    selId && isUnfinished(runAttempt?.status ?? null) ? 4000 : null,
    [selId],
  );
  const detail =
    attemptPoll.data && attemptPoll.data.attempt.id === selId ? attemptPoll.data : null;
  const attempt = detail?.attempt ?? runAttempt;
  const attemptUnfinished = attempt !== null && isUnfinished(attempt.status);

  // Live judge traces while the attempt is in its judging phase (v3 spec §8.2).
  const judging = attempt?.status === "judging";
  const judgeLivePoll = usePoll<JudgeLiveResponse | null>(
    () => (selId && judging ? getJudgeLive(selId) : Promise.resolve(null)),
    judging ? 2000 : null,
    [selId, judging],
  );
  const judgeLive = judging ? judgeLivePoll.data : null;

  const [tab, setTab] = useState<RdTab>("transcript");
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  if (!run) {
    return (
      <div className="panel">
        {runPoll.error ? (
          <span className="rd-load-error">Failed to load run: {runPoll.error}</span>
        ) : (
          <Spinner label="Loading run…" />
        )}
      </div>
    );
  }

  const r = run.run;
  const totals = run.totals;
  const canCancel = run.active;
  const canResume =
    !run.active && attempts.some((a) => isUnfinished(a.status) || a.status === "error");

  const act = (fn: () => Promise<void>) => {
    setBusy(true);
    setActionError(null);
    fn()
      .then(() => runPoll.refresh())
      .catch((e: unknown) => setActionError(e instanceof Error ? e.message : String(e)))
      .finally(() => setBusy(false));
  };

  const wallTime: ReactNode = r.finishedAt ? (
    fmtDuration(safeDelta(r.createdAt, r.finishedAt))
  ) : run.active ? (
    <Elapsed since={r.createdAt} />
  ) : (
    "—"
  );

  const cellAttempts = attempt
    ? attempts
        .filter((a) => a.scenarioId === attempt.scenarioId && a.configId === attempt.configId)
        .sort((a, b) => a.attemptIndex - b.attemptIndex)
    : [];

  const artifacts = detail?.artifacts ?? [];
  const judgments = detail?.judgments ?? [];
  const checksTab = checksTabInfo(judgments, judging);

  return (
    <>
      <div className="panel rd-top">
        <div className="rd-title-row">
          <a className="rd-back" href="#/runs">
            ← Runs
          </a>
          <h2 className="rd-name">{r.name ?? r.id}</h2>
          {r.name ? <span className="chip rd-mono">{r.id}</span> : null}
          <StatusBadge status={r.status} />
          {run.active ? <Spinner label="Live" /> : null}
          <span className="rd-spacer" />
          {canCancel ? (
            <button
              type="button"
              className="btn btn-danger"
              disabled={busy}
              onClick={() => {
                if (window.confirm("Cancel this run?")) act(() => cancelRun(runId));
              }}
            >
              Cancel
            </button>
          ) : null}
          {canResume ? (
            <button
              type="button"
              className="btn"
              disabled={busy}
              onClick={() => act(() => resumeRun(runId))}
            >
              Resume
            </button>
          ) : null}
        </div>
        {actionError ? <div className="rd-load-error">{actionError}</div> : null}
        <div className="meta-grid">
          <Meta label="Created" title={r.createdAt}>
            {fmtDate(r.createdAt)} · {fmtAgo(r.createdAt)}
          </Meta>
          <Meta label="Finished" title={r.finishedAt ?? undefined}>
            {fmtDate(r.finishedAt)}
          </Meta>
          <Meta label="Wall Time">{wallTime}</Meta>
          <Meta label="Total Cost">
            <CostBadge costUsd={totals.totalCostUsd} source={null} />
            {totals.unpricedAttempts > 0 ? (
              <InfoTip text={`${totals.unpricedAttempts} unpriced attempt(s) not included`} />
            ) : null}
          </Meta>
          <Meta label="Judge Cost">
            <span className={totals.judgeCostUsd === null ? "cost-badge dim" : "cost-badge"}>
              {fmtCost(totals.judgeCostUsd)}
            </span>{" "}
            <InfoTip text="Judge LLM cost — not included in Total Cost" />
          </Meta>
          <Meta label="Attempts">
            {totals.finished}/{totals.attempts} · {totals.passedAttempts} Passed ·{" "}
            {totals.errorAttempts} Errors
          </Meta>
          <Meta label={`Best@${r.attemptsPerCell}`}>
            {totals.passedCells}/{totals.totalCells} Cells
          </Meta>
          <Meta label="Concurrency">{r.concurrency}</Meta>
          <Meta label="Judge Model">
            {r.judgeModel ? (
              <ModelChip model={r.judgeModel} />
            ) : (
              <span className="dim">Default</span>
            )}
          </Meta>
          <Meta label="Matrix">
            {r.scenarioIds.length} Scenarios × {r.configIds.length} Configs
          </Meta>
        </div>
      </div>

      <div className="layout-30-70 rd-body">
        <div className="rd-left scroll-col">
          <div className="panel">
            <div className="panel-title">Matrix</div>
            <div className="rd-matrix-wrap">
              <Matrix
                scenarioIds={r.scenarioIds}
                configIds={r.configIds}
                cells={run.cells}
                attempts={attempts}
                cellHref={(scenarioId, configId) =>
                  `#/runs/${runId}/attempts/${runId}_${scenarioId}_${configId}_0`
                }
                selected={
                  attempt ? { scenarioId: attempt.scenarioId, configId: attempt.configId } : null
                }
              />
            </div>
            {cellAttempts.length > 1 ? (
              <div className="rd-attempt-picker">
                {cellAttempts.map((a) => {
                  const info = statusGlyphInfo(a.status);
                  return (
                    <button
                      type="button"
                      key={a.id}
                      className={a.id === selId ? "btn rd-att-btn selected" : "btn rd-att-btn"}
                      title={`Attempt #${a.attemptIndex} · ${info.label}`}
                      onClick={() => navigate(`#/runs/${runId}/attempts/${a.id}`)}
                    >
                      <span className={`rd-dot ${info.tone}`} />#{a.attemptIndex}
                    </button>
                  );
                })}
              </div>
            ) : null}
          </div>

          <AttemptSummary
            attempt={attempt}
            selId={selId}
            error={attemptPoll.error}
            config={attempt ? (configById.get(attempt.configId) ?? null) : null}
          />
          <SandboxPanel attempt={attempt} />
        </div>

        <div className="rd-right panel scroll-col">
          <div className="tabs rd-tabs">
            <button
              type="button"
              className={tab === "transcript" ? "tab active" : "tab"}
              onClick={() => setTab("transcript")}
            >
              Transcript
            </button>
            <button
              type="button"
              className={tab === "checks" ? "tab active" : "tab"}
              title={checksTab.title}
              onClick={() => setTab("checks")}
            >
              {checksTab.node}
            </button>
            <button
              type="button"
              className={tab === "timings" ? "tab active" : "tab"}
              onClick={() => setTab("timings")}
            >
              Timings
            </button>
            <button
              type="button"
              className={tab === "assets" ? "tab active" : "tab"}
              onClick={() => setTab("assets")}
            >
              Assets
            </button>
          </div>
          {tab === "transcript" ? (
            selId ? (
              <Transcript key={selId} attemptId={selId} live={attemptUnfinished} />
            ) : (
              <div className="dim">No attempt selected</div>
            )
          ) : tab === "checks" ? (
            <ChecksTab attempt={attempt} judgments={judgments} live={judgeLive} />
          ) : tab === "timings" ? (
            <TimingsTab attempt={attempt} />
          ) : (
            <>
              <DataTable
                rows={artifacts}
                columns={ASSET_COLUMNS}
                rowKey={(row) => row.id}
                emptyText="No artifacts yet"
                searchPlaceholder="Search artifacts…"
              />
              {artifacts.length === 0 && attemptUnfinished ? (
                <div className="rd-stage">
                  <Spinner label="Artifacts land as the attempt progresses…" />
                </div>
              ) : null}
            </>
          )}
        </div>
      </div>
    </>
  );
}

function Meta(props: { label: string; title?: string; children: ReactNode }): ReactNode {
  return (
    <div>
      <div className="meta-label">{props.label}</div>
      <div className="meta-value" title={props.title}>
        {props.children}
      </div>
    </div>
  );
}

function AttemptSummary(props: {
  attempt: AttemptJson | null;
  selId: string | null;
  error: string | null;
  config: ConfigJson | null;
}): ReactNode {
  const { attempt, config } = props;
  if (!attempt) {
    return (
      <div className="panel">
        <div className="panel-title">Attempt</div>
        {props.selId && props.error ? (
          <div className="rd-load-error">Failed to load attempt: {props.error}</div>
        ) : (
          <div className="dim">No attempts yet</div>
        )}
      </div>
    );
  }
  const live = attempt.status === "running" || attempt.status === "judging";
  return (
    <div className="panel">
      <div className="panel-title">
        Attempt #{attempt.attemptIndex}
        <span className="dim rd-attempt-id"> {attempt.id}</span>
      </div>
      {attempt.status === "pending" ? (
        <div className="rd-stage">
          <Spinner label="Waiting for a pool slot…" />
        </div>
      ) : null}
      {attempt.status === "running" && !attempt.sandbox ? (
        <div className="rd-stage">
          <Spinner label="Booting sandboxes…" />
        </div>
      ) : null}
      <div className="meta-grid">
        <Meta label="Status">
          <StatusScore status={attempt.status} score={attempt.score} />
        </Meta>
        <Meta label="Cost">
          <CostBadge costUsd={attempt.costUsd} source={attempt.costSource} />
        </Meta>
        <Meta label="Judge Cost">
          <span className={attempt.judgeCostUsd === null ? "cost-badge dim" : "cost-badge"}>
            {fmtCost(attempt.judgeCostUsd)}
          </span>{" "}
          <InfoTip text="Judge LLM cost — not included in Total Cost" />
        </Meta>
        <Meta label="Duration">
          {live ? <Elapsed since={attempt.startedAt} /> : fmtDuration(attempt.durationMs)}
        </Meta>
        <Meta label="Retries">{attempt.retries}</Meta>
        <Meta label="Started" title={attempt.startedAt ?? undefined}>
          {fmtDate(attempt.startedAt)}
        </Meta>
        <Meta label="Finished" title={attempt.finishedAt ?? undefined}>
          {fmtDate(attempt.finishedAt)}
        </Meta>
        <Meta label="Model">
          <ModelChip model={attempt.tokens?.model ?? config?.model ?? null} />
        </Meta>
        <Meta label="Scenario">
          <EntityLink kind="scenario" id={attempt.scenarioId} />
        </Meta>
        <Meta label="Config">
          <span className="rd-config-ref">
            <HarnessIcon harness={config?.provider ?? null} />
            <EntityLink kind="config" id={attempt.configId} />
          </span>
        </Meta>
      </div>
      {attempt.taskIds.length > 0 ? (
        <div className="rd-tasks">
          <span className="meta-label">Tasks</span>
          {attempt.taskIds.map((taskId) => (
            <code className="chip rd-mono" key={taskId}>
              {taskId}
            </code>
          ))}
        </div>
      ) : null}
      {attempt.error ? <div className="rd-attempt-error">{attempt.error}</div> : null}
    </div>
  );
}

// ---- timings tab (item 7) ----

function TimingsTab(props: { attempt: AttemptJson | null }): ReactNode {
  const { attempt } = props;
  if (!attempt) return <div className="dim">No attempt selected</div>;
  if (attempt.timings) {
    return <Waterfall timings={attempt.timings} totalMs={attempt.durationMs} />;
  }
  if (isUnfinished(attempt.status)) {
    return <div className="dim rd-not-captured">Timings land when the attempt finishes</div>;
  }
  return <div className="dim rd-not-captured">Timings not captured (older run)</div>;
}

// ---- sandbox panel (item 14: PrettyView with Raw JSON toggle) ----

const SANDBOX_LABELS: Record<string, string> = {
  swarmKey: "Swarm API Key",
  apiSandboxId: "API Sandbox",
  workerSandboxId: "Worker Sandbox",
  workerAgentId: "Worker Agent",
};

function monoRenderer(value: unknown): ReactNode {
  return <code className="rd-mono">{String(value)}</code>;
}

function SandboxPanel(props: { attempt: AttemptJson | null }): ReactNode {
  const sandbox = props.attempt?.sandbox ?? null;
  return (
    <div className="panel">
      <div className="panel-title">Sandbox</div>
      {sandbox ? (
        <SandboxView sandbox={sandbox} />
      ) : props.attempt && isUnfinished(props.attempt.status) ? (
        <div className="dim rd-not-captured">Sandbox not booted yet</div>
      ) : (
        <div className="dim rd-not-captured">Sandbox info not captured (older run)</div>
      )}
    </div>
  );
}

function SandboxView(props: { sandbox: SandboxInfoJson }): ReactNode {
  return (
    <PrettyView
      value={props.sandbox}
      rawLabel="Sandbox"
      labels={SANDBOX_LABELS}
      renderers={{
        swarmKey: (v) => <CopyCode text={String(v)} />,
        apiSandboxId: monoRenderer,
        workerSandboxId: monoRenderer,
        workerAgentId: monoRenderer,
        apiUrl: (v) => (
          <>
            <a className="entity-link" href={String(v)} target="_blank" rel="noreferrer">
              {String(v)}
            </a>{" "}
            <InfoTip text="Dead after sandbox teardown" />
          </>
        ),
      }}
    />
  );
}

function CopyCode(props: { text: string }): ReactNode {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="rd-copy"
      title="Click to copy"
      onClick={() => {
        void navigator.clipboard.writeText(props.text);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1200);
      }}
    >
      <code>{props.text}</code>
      {copied ? <span className="accent"> Copied</span> : null}
    </button>
  );
}

// ---- checks & judgments tab (item 4 + v3 judge traces) ----

function ChecksTab(props: {
  attempt: AttemptJson | null;
  judgments: JudgmentJson[];
  live: JudgeLiveResponse | null;
}): ReactNode {
  const { attempt, judgments, live } = props;
  const judging = attempt?.status === "judging";
  // While judging with live traces available, the live stream IS the view — the
  // deterministic trace covers the checks (no double-display of persisted rows).
  if (judging && live && live.traces.length > 0) {
    return (
      <div className="rd-checks">
        {live.traces.map((t, i) => (
          <JudgeTrace trace={t} live key={`${t.judge}-${t.startedAt}-${String(i)}`} />
        ))}
      </div>
    );
  }
  return (
    <div className="rd-checks">
      {judging ? (
        <div className="rd-stage">
          <Spinner label="Judging…" />
        </div>
      ) : null}
      {judgments.length === 0 && !judging ? (
        <div className="dim">
          {attempt && isUnfinished(attempt.status) ? "No judgments yet" : "No judgments"}
        </div>
      ) : null}
      {judgments.map((j) => (
        <JudgmentBlock judgment={j} key={j.id} />
      ))}
    </div>
  );
}

/** Judgment kind as a glyph (item 2): deterministic ≡, llm/agentic ✶ — tooltip carries the word. */
function judgmentKindInfo(kind: string): { glyph: string; label: string } {
  if (kind === "deterministic") return { glyph: "≡", label: "Deterministic Check" };
  if (kind === "agentic") return { glyph: "✶", label: "Agentic Judge" };
  if (kind === "llm") return { glyph: "✶", label: "LLM Judge" };
  return { glyph: "✶", label: humanizeKey(kind) };
}

/** Judge model id from the raw payload (`{ model, object }`) — fallback for old rows. */
function rawJudgeModel(raw: string | null): string | null {
  if (raw === null) return null;
  try {
    const parsed = JSON.parse(raw) as { model?: unknown };
    return typeof parsed.model === "string" ? parsed.model : null;
  } catch {
    return null;
  }
}

/** Persisted judgment → trace shape for the JudgeTrace showcase (v3 spec §8.2, frozen). */
function judgmentToTrace(j: JudgmentJson): JudgeTraceJson {
  return {
    judge: j.name.startsWith("agentic") ? "agentic" : "llm",
    model: j.tokens?.model ?? null,
    startedAt: j.createdAt,
    finishedAt: j.createdAt,
    durationMs: j.durationMs,
    costUsd: j.costUsd,
    tokens: j.tokens,
    error: null,
    steps: j.steps ?? [],
  };
}

function JudgmentBlock(props: { judgment: JudgmentJson }): ReactNode {
  const j = props.judgment;
  const kind = judgmentKindInfo(j.kind);
  const isLlmKind = j.kind !== "deterministic";
  const model = useMemo(
    () => (isLlmKind ? (j.tokens?.model ?? rawJudgeModel(j.raw)) : null),
    [isLlmKind, j.tokens, j.raw],
  );
  const hasTrace = j.steps !== null;
  const [showRaw, setShowRaw] = useState(false);
  return (
    <div className={`rd-judgment ${j.pass ? "pass" : "fail"}`}>
      <div className="rd-judgment-head">
        <span className="rd-judgment-name">{j.name}</span>
        <Tooltip text={kind.label}>
          <span className="rd-judgment-kind" role="img" aria-label={kind.label}>
            {kind.glyph}
          </span>
        </Tooltip>
        <StatusScore status={j.pass ? "pass" : "fail"} score={j.score} />
        {model !== null ? <ModelChip model={model} /> : null}
        <span className="rd-judgment-spacer" />
        {isLlmKind ? (
          <Tooltip text="Judge LLM cost — not included in attempt cost">
            <span className={j.costUsd === null ? "cost-badge dim" : "cost-badge"}>
              {fmtCost(j.costUsd)}
            </span>
          </Tooltip>
        ) : null}
        <Tooltip text={isLlmKind ? "Judge duration" : "Check elapsed"}>
          <span className={j.durationMs === null ? "rd-judgment-ms dim" : "rd-judgment-ms"}>
            {fmtDuration(j.durationMs)}
          </span>
        </Tooltip>
        <span className="dim" title={j.createdAt}>
          {fmtAgo(j.createdAt)}
        </span>
      </div>
      {j.reasoning ? <div className="rd-judgment-reason">{j.reasoning}</div> : null}
      {hasTrace ? (
        <>
          <div className="rd-judgment-trace">
            <JudgeTrace trace={judgmentToTrace(j)} />
          </div>
          {j.raw !== null ? (
            <div className="rd-judgment-raw-toggle">
              <button type="button" className="pv-toggle" onClick={() => setShowRaw((r) => !r)}>
                {showRaw ? "▾ Hide Raw" : "▸ Raw"}
              </button>
              {showRaw ? <JudgmentRaw raw={j.raw} /> : null}
            </div>
          ) : null}
        </>
      ) : (
        <>
          {j.raw !== null ? <JudgmentRaw raw={j.raw} /> : null}
          {isLlmKind ? (
            <div className="dim rd-not-captured">Trace not captured (older run)</div>
          ) : null}
        </>
      )}
    </div>
  );
}

function JudgmentRaw(props: { raw: string }): ReactNode {
  const parsed = useMemo<{ ok: true; value: unknown } | { ok: false }>(() => {
    try {
      return { ok: true, value: JSON.parse(props.raw) as unknown };
    } catch {
      return { ok: false };
    }
  }, [props.raw]);
  if (!parsed.ok) return <pre className="rd-raw">{props.raw}</pre>;
  return (
    <div className="rd-judgment-raw">
      <PrettyView value={parsed.value} rawLabel="Raw" />
    </div>
  );
}
