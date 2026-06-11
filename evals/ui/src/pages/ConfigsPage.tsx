import { type ReactNode, useMemo } from "react";
import { listConfigs, listRuns } from "../api.ts";
import { type Column, DataTable } from "../components/DataTable.tsx";
import { EntityLink } from "../components/EntityLink.tsx";
import { fmtCost, fmtScore } from "../components/format.ts";
import { HARNESS_LABELS, HarnessIcon } from "../components/HarnessIcon.tsx";
import { ModelChip } from "../components/ModelChip.tsx";
import { PrettyView } from "../components/PrettyView.tsx";
import { Spinner } from "../components/Spinner.tsx";
import { InfoTip, Tooltip } from "../components/Tooltip.tsx";
import { navigate, usePoll } from "../hooks.ts";
import type { ConfigJson, RunListItem } from "../types.ts";
import "./configs.css";

const configColumns: Column<ConfigJson>[] = [
  {
    key: "id",
    header: "Id",
    width: "190px",
    searchText: (c) => c.id,
    // Self-referential on this page — plain chip; the row click opens the detail.
    render: (c) => <span className="chip">{c.id}</span>,
  },
  {
    key: "label",
    header: "Label",
    searchText: (c) => c.label ?? "",
    render: (c) => c.label ?? <span className="dim">—</span>,
  },
  {
    key: "harness",
    header: "Harness",
    width: "130px",
    sortValue: (c) => c.provider,
    filterOptions: (rows) => [...new Set(rows.map((c) => c.provider))].sort(),
    filterValue: (c) => c.provider,
    filterRender: (option) => <HarnessIcon harness={option} showLabel />,
    titleText: (c) => HARNESS_LABELS[c.provider] ?? c.provider,
    render: (c) => <HarnessIcon harness={c.provider} showLabel />,
  },
  {
    key: "model",
    header: "Model",
    width: "190px",
    sortValue: (c) => c.model,
    searchText: (c) => c.model ?? "",
    titleText: (c) => c.model ?? "Harness default model",
    render: (c) => <ModelChip model={c.model} />,
  },
  {
    key: "tier",
    header: "Tier",
    width: "72px",
    sortValue: (c) => c.modelTier,
    render: (c) => c.modelTier ?? <span className="dim">—</span>,
  },
  {
    key: "envKeys",
    header: "Env Keys",
    headerTip: "Env values stay server-side — only key names are exposed",
    width: "80px",
    align: "right",
    sortValue: (c) => c.envKeys.length,
    render: (c) =>
      c.envKeys.length === 0 ? (
        <span className="dim">0</span>
      ) : (
        <Tooltip text={c.envKeys.join("\n")}>
          <span>{c.envKeys.length}</span>
        </Tooltip>
      ),
  },
  {
    key: "default",
    header: "Default",
    width: "72px",
    align: "center",
    sortValue: (c) => (c.isDefault ? 0 : 1),
    titleText: (c) =>
      c.isDefault ? "Default config — included when a run doesn't pick configs" : "Not a default",
    render: (c) =>
      c.isDefault ? (
        <span className="tone-green" role="img" aria-label="Default config">
          ✓
        </span>
      ) : (
        <span className="dim">—</span>
      ),
  },
];

function ConfigList(): ReactNode {
  const { data, error, loading } = usePoll(listConfigs, null, []);
  return (
    <div className="panel">
      <h3 className="panel-title">Configs{data ? ` · ${data.length}` : ""}</h3>
      {error ? <div className="cfg-error">{error}</div> : null}
      {loading && !data ? <Spinner label="Loading configs…" /> : null}
      {data ? (
        <DataTable
          rows={data}
          columns={configColumns}
          rowKey={(c) => c.id}
          onRowClick={(c) => navigate(`#/configs/${c.id}`)}
          defaultSort={{ key: "id", dir: "asc" }}
          searchPlaceholder="Search configs…"
          emptyText="No configs registered"
        />
      ) : null}
    </div>
  );
}

/** Per-scenario aggregate of every recorded run cell that used this config. */
interface ScenarioAgg {
  scenarioId: string;
  runs: number;
  passedRuns: number;
  attempts: number;
  bestScore: number | null;
  totalCostUsd: number | null;
}

function aggregateByScenario(runs: RunListItem[], configId: string): ScenarioAgg[] {
  const byScenario = new Map<string, ScenarioAgg>();
  for (const item of runs) {
    for (const cell of item.cells) {
      if (cell.configId !== configId) continue;
      let agg = byScenario.get(cell.scenarioId);
      if (!agg) {
        agg = {
          scenarioId: cell.scenarioId,
          runs: 0,
          passedRuns: 0,
          attempts: 0,
          bestScore: null,
          totalCostUsd: null,
        };
        byScenario.set(cell.scenarioId, agg);
      }
      agg.runs += 1;
      if (cell.passedAny) agg.passedRuns += 1;
      agg.attempts += cell.attempts;
      if (cell.bestScore !== null) {
        agg.bestScore =
          agg.bestScore === null ? cell.bestScore : Math.max(agg.bestScore, cell.bestScore);
      }
      if (cell.totalCostUsd !== null)
        agg.totalCostUsd = (agg.totalCostUsd ?? 0) + cell.totalCostUsd;
    }
  }
  return [...byScenario.values()];
}

const aggColumns: Column<ScenarioAgg>[] = [
  {
    key: "scenario",
    header: "Scenario",
    searchText: (r) => r.scenarioId,
    render: (r) => <EntityLink kind="scenario" id={r.scenarioId} />,
  },
  {
    key: "runs",
    header: "Runs",
    width: "60px",
    align: "right",
    sortValue: (r) => r.runs,
    render: (r) => r.runs,
  },
  {
    key: "attempts",
    header: "Attempts",
    width: "78px",
    align: "right",
    sortValue: (r) => r.attempts,
    render: (r) => r.attempts,
  },
  {
    key: "passed",
    header: "Passed",
    headerTip: "Runs where at least one attempt of this cell passed",
    width: "72px",
    align: "right",
    sortValue: (r) => (r.runs === 0 ? null : r.passedRuns / r.runs),
    titleText: (r) => `${r.passedRuns} of ${r.runs} runs passed at least one attempt`,
    render: (r) => {
      const tone =
        r.passedRuns === r.runs ? "tone-green" : r.passedRuns === 0 ? "tone-red" : "tone-accent";
      return (
        <span className={`cfg-pass ${tone}`}>
          {r.passedRuns}/{r.runs}
        </span>
      );
    },
  },
  {
    key: "best",
    header: "Best Score",
    width: "84px",
    align: "right",
    sortValue: (r) => r.bestScore,
    render: (r) => fmtScore(r.bestScore),
  },
  {
    key: "cost",
    header: "Cost",
    width: "90px",
    align: "right",
    sortValue: (r) => r.totalCostUsd,
    render: (r) => fmtCost(r.totalCostUsd),
  },
];

function ConfigDetail(props: { configId: string }): ReactNode {
  const configs = usePoll(listConfigs, null, []);
  const runs = usePoll(listRuns, null, []);
  const config = configs.data?.find((c) => c.id === props.configId) ?? null;
  const aggs = useMemo(
    () => (runs.data ? aggregateByScenario(runs.data, props.configId) : []),
    [runs.data, props.configId],
  );

  if (!configs.data) {
    return (
      <div className="panel">
        <a className="entity-link" href="#/configs">
          ← Configs
        </a>
        {configs.loading ? (
          <div className="cfg-loading">
            <Spinner label="Loading config…" />
          </div>
        ) : null}
        {configs.error ? <div className="cfg-error">{configs.error}</div> : null}
      </div>
    );
  }

  return (
    <>
      <div className="panel cfg-header">
        <a className="entity-link" href="#/configs">
          ← Configs
        </a>
        <h2 className="cfg-title">
          <HarnessIcon harness={config?.provider ?? null} size={18} />
          {config?.label ?? props.configId}
        </h2>
        <span className="chip">{props.configId}</span>
        {config?.isDefault ? (
          <Tooltip text="Default config — included when a run doesn't pick configs">
            <span className="tone-green cfg-default" role="img" aria-label="Default config">
              ✓
            </span>
          </Tooltip>
        ) : null}
        {configs.error ? <span className="cfg-error">{configs.error}</span> : null}
      </div>
      {config ? (
        <div className="panel">
          <h3 className="panel-title">
            Definition <InfoTip text="Env values stay server-side — only key names are exposed" />
          </h3>
          <PrettyView
            value={config}
            rawLabel="config"
            labels={{ provider: "Harness", isDefault: "Default" }}
            renderers={{
              provider: (v) => <HarnessIcon harness={typeof v === "string" ? v : null} showLabel />,
              model: (v) => <ModelChip model={typeof v === "string" ? v : null} />,
            }}
          />
        </div>
      ) : (
        <div className="panel">
          <h3 className="panel-title">Definition</h3>
          <div className="dim">
            Config "{props.configId}" is not in the registry — it may have been removed. Recorded
            runs keep their results below.
          </div>
        </div>
      )}
      <div className="panel">
        <h3 className="panel-title">
          Results by Scenario{" "}
          <InfoTip text="Aggregated from recorded runs that include this config" />
        </h3>
        {runs.error ? <div className="cfg-error">{runs.error}</div> : null}
        {runs.loading && !runs.data ? <Spinner label="Loading runs…" /> : null}
        {runs.data ? (
          <DataTable
            rows={aggs}
            columns={aggColumns}
            rowKey={(r) => r.scenarioId}
            defaultSort={{ key: "scenario", dir: "asc" }}
            searchable={false}
            emptyText="No recorded runs include this config"
          />
        ) : null}
      </div>
    </>
  );
}

/**
 * Harness-configs page (item 12): list at #/configs, detail at #/configs/:id.
 * The props contract ({ configId: string | null }) is frozen by App.tsx routing.
 */
export default function ConfigsPage(props: { configId: string | null }): ReactNode {
  return props.configId === null ? <ConfigList /> : <ConfigDetail configId={props.configId} />;
}
