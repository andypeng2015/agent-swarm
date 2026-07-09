import { Clock, History, Loader2, Pause, Radio, RotateCcw, ZoomIn, ZoomOut } from "lucide-react";
import type { WheelEvent } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "@/api/client";
import { useAgents } from "@/api/hooks/use-agents";
import { useTasks } from "@/api/hooks/use-tasks";
import type { AgentTask, AgentTaskStatus, AgentWithTasks } from "@/api/types";
import { EmptyState } from "@/components/shared/empty-state";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { formatCost } from "@/lib/cost-format";
import { formatDurationMs } from "@/lib/format-duration-ms";
import { formatTokens } from "@/lib/format-tokens";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 300;
const MIN_BAR_WIDTH = 10;
const LABEL_WIDTH = 196;
const LANE_HEIGHT = 42;
const HEADER_HEIGHT = 40;
const LIVE_PADDING_MS = 5 * 60 * 1000;
const MIN_VIEWPORT_WIDTH = 640;
const ZOOM_LEVELS = [
  { label: "1h", ms: 60 * 60 * 1000 },
  { label: "3h", ms: 3 * 60 * 60 * 1000 },
  { label: "8h", ms: 8 * 60 * 60 * 1000 },
  { label: "24h", ms: 24 * 60 * 60 * 1000 },
  { label: "3d", ms: 3 * 24 * 60 * 60 * 1000 },
  { label: "7d", ms: 7 * 24 * 60 * 60 * 1000 },
] as const;

type TimelineTask = AgentTask & { agentId: string | null };

interface Lane {
  id: string;
  name: string;
  role?: string;
  isLead: boolean;
  tasks: TimelineTask[];
}

function statusBarClass(status: AgentTaskStatus): string {
  switch (status) {
    case "completed":
      return "border-status-success bg-status-success/80 text-status-success-foreground";
    case "failed":
      return "border-status-error bg-status-error/80 text-status-error-foreground";
    case "in_progress":
      return "border-status-active bg-status-active/85 text-status-active-foreground";
    case "paused":
    case "reviewing":
      return "border-status-paused bg-status-paused/80 text-status-paused-foreground";
    case "pending":
      return "border-status-pending bg-status-pending/80 text-status-pending-foreground";
    case "offered":
      return "border-status-info bg-status-info/80 text-status-info-foreground";
    case "cancelled":
    case "backlog":
    case "unassigned":
      return "border-status-neutral bg-status-neutral/75 text-status-neutral-foreground";
    case "superseded":
      return "border-status-warning bg-status-warning/75 text-status-warning-foreground";
    default:
      return "border-status-neutral bg-status-neutral/75 text-status-neutral-foreground";
  }
}

function taskEndMs(task: TimelineTask, nowMs: number): number {
  if (task.finishedAt) return new Date(task.finishedAt).getTime();
  if (task.status === "in_progress" || task.status === "paused") return nowMs;
  return new Date(task.lastUpdatedAt || task.createdAt).getTime();
}

function taskTitle(task: TimelineTask): string {
  return task.task.replace(/\s+/g, " ").trim() || task.id;
}

function shortId(id: string): string {
  return id.slice(0, 8);
}

function formatTime(ms: number): string {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(ms));
}

function formatAxisLabel(ms: number, windowMs: number): string {
  const date = new Date(ms);
  if (windowMs <= 8 * 60 * 60 * 1000) {
    return new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" }).format(date);
  }
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
  }).format(date);
}

function buildTicks(startMs: number, endMs: number, windowMs: number): number[] {
  const targetTicks = 8;
  const rough = windowMs / targetTicks;
  const intervals = [
    15 * 60 * 1000,
    30 * 60 * 1000,
    60 * 60 * 1000,
    3 * 60 * 60 * 1000,
    6 * 60 * 60 * 1000,
    12 * 60 * 60 * 1000,
    24 * 60 * 60 * 1000,
  ];
  const interval = intervals.find((value) => value >= rough) ?? intervals[intervals.length - 1]!;
  const first = Math.ceil(startMs / interval) * interval;
  const ticks: number[] = [];
  for (let t = first; t <= endMs; t += interval) ticks.push(t);
  return ticks;
}

function mergeTasks(...groups: AgentTask[][]): TimelineTask[] {
  const byId = new Map<string, TimelineTask>();
  for (const group of groups) {
    for (const task of group) byId.set(task.id, task);
  }
  return [...byId.values()].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  );
}

function buildLanes(agents: AgentWithTasks[], tasks: TimelineTask[]): Lane[] {
  const agentById = new Map(agents.map((agent) => [agent.id, agent]));
  const taskBuckets = new Map<string, TimelineTask[]>();
  for (const task of tasks) {
    const laneId = task.agentId ?? "unassigned";
    const bucket = taskBuckets.get(laneId) ?? [];
    bucket.push(task);
    taskBuckets.set(laneId, bucket);
  }

  const lanes: Lane[] = agents.map((agent) => ({
    id: agent.id,
    name: agent.name,
    role: agent.role || agent.description,
    isLead: !!agent.isLead,
    tasks: taskBuckets.get(agent.id) ?? [],
  }));

  for (const [laneId, laneTasks] of taskBuckets) {
    if (laneId === "unassigned") {
      lanes.push({ id: laneId, name: "Unassigned", isLead: false, tasks: laneTasks });
      continue;
    }
    if (!agentById.has(laneId)) {
      lanes.push({ id: laneId, name: shortId(laneId), isLead: false, tasks: laneTasks });
    }
  }

  return lanes
    .filter((lane) => lane.tasks.length > 0 || lane.isLead)
    .sort((a, b) => {
      if (a.isLead !== b.isLead) return a.isLead ? -1 : 1;
      return b.tasks.length - a.tasks.length || a.name.localeCompare(b.name);
    });
}

function clampZoomIndex(index: number): number {
  return Math.max(0, Math.min(ZOOM_LEVELS.length - 1, index));
}

export function AgentActivityTimeline() {
  const navigate = useNavigate();
  const [nowMs, setNowMs] = useState(Date.now());
  const [zoomIndex, setZoomIndex] = useState(2);
  const [live, setLive] = useState(true);
  const [historyTasks, setHistoryTasks] = useState<AgentTask[]>([]);
  const [historyCursor, setHistoryCursor] = useState<string | null>(null);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [hasMoreHistory, setHasMoreHistory] = useState(true);
  const [viewportWidth, setViewportWidth] = useState(MIN_VIEWPORT_WIDTH);
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const timelineRef = useRef<HTMLDivElement | null>(null);

  const windowMs = ZOOM_LEVELS[zoomIndex].ms;
  const liveLookbackMs = Math.max(windowMs, 24 * 60 * 60 * 1000);
  const createdAfter = useMemo(() => {
    const minuteNow = Math.floor(nowMs / 60_000) * 60_000;
    return new Date(minuteNow - liveLookbackMs).toISOString();
  }, [liveLookbackMs, nowMs]);

  const agentsQ = useAgents(false);
  const liveTasksQ = useTasks({
    createdAfter,
    limit: 1200,
    orderBy: "createdAt",
  });

  useEffect(() => {
    const interval = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    const node = scrollerRef.current;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setViewportWidth(Math.max(MIN_VIEWPORT_WIDTH, entry.contentRect.width));
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const liveTasks = liveTasksQ.data?.tasks ?? [];
  const allTasks = useMemo(() => mergeTasks(historyTasks, liveTasks), [historyTasks, liveTasks]);
  const agents = (agentsQ.data ?? []) as AgentWithTasks[];
  const lanes = useMemo(() => buildLanes(agents, allTasks), [agents, allTasks]);

  useEffect(() => {
    if (allTasks.length === 0) return;
    const oldest = allTasks[0]?.createdAt;
    if (oldest && !historyCursor) setHistoryCursor(oldest);
  }, [allTasks, historyCursor]);

  const minTaskMs = allTasks[0]
    ? new Date(allTasks[0].createdAt).getTime()
    : nowMs - liveLookbackMs;
  const timelineStartMs = Math.min(minTaskMs, nowMs - windowMs);
  const timelineEndMs = Math.max(
    nowMs + LIVE_PADDING_MS,
    ...allTasks.map((task) => taskEndMs(task, nowMs) + LIVE_PADDING_MS),
  );
  const pxPerMs = viewportWidth / windowMs;
  const timelineWidth = Math.max(viewportWidth, (timelineEndMs - timelineStartMs) * pxPerMs);
  const contentHeight = Math.max(160, HEADER_HEIGHT + lanes.length * LANE_HEIGHT);
  const ticks = useMemo(
    () => buildTicks(timelineStartMs, timelineEndMs, windowMs),
    [timelineStartMs, timelineEndMs, windowMs],
  );

  const loadOlder = useCallback(async () => {
    if (isLoadingHistory || !hasMoreHistory || !historyCursor) return;
    setIsLoadingHistory(true);
    try {
      const result = await api.fetchTasks({
        createdBefore: historyCursor,
        orderBy: "createdAt",
        limit: PAGE_SIZE,
      });
      setHistoryTasks((prev) => mergeTasks(prev, result.tasks));
      if (result.tasks.length > 0) {
        const oldest = result.tasks.reduce((min, task) =>
          task.createdAt < min.createdAt ? task : min,
        );
        setHistoryCursor(oldest.createdAt);
      }
      if (result.tasks.length < PAGE_SIZE) setHasMoreHistory(false);
    } finally {
      setIsLoadingHistory(false);
    }
  }, [hasMoreHistory, historyCursor, isLoadingHistory]);

  useEffect(() => {
    const node = scrollerRef.current;
    if (!node || !live) return;
    node.scrollLeft = node.scrollWidth;
  });

  const handleScroll = useCallback(() => {
    const node = scrollerRef.current;
    if (!node) return;
    if (node.scrollLeft < 180) void loadOlder();
    const distanceFromRight = node.scrollWidth - node.clientWidth - node.scrollLeft;
    if (distanceFromRight > 120 && live) setLive(false);
  }, [live, loadOlder]);

  const handleWheel = useCallback((event: WheelEvent<HTMLDivElement>) => {
    if (!event.ctrlKey && !event.metaKey) return;
    event.preventDefault();
    setLive(false);
    setZoomIndex((current) => clampZoomIndex(current + (event.deltaY > 0 ? 1 : -1)));
  }, []);

  const backToLive = useCallback(() => {
    setLive(true);
    requestAnimationFrame(() => {
      const node = scrollerRef.current;
      if (node) node.scrollLeft = node.scrollWidth;
    });
  }, []);

  if (agentsQ.isLoading || liveTasksQ.isLoading) {
    return (
      <div className="h-[clamp(320px,48vh,560px)] rounded-lg border bg-card flex items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (allTasks.length === 0) {
    return (
      <div className="h-[clamp(320px,48vh,560px)] rounded-lg border bg-card flex items-center justify-center">
        <EmptyState
          icon={Clock}
          title="No task activity yet"
          description="New swarm tasks will appear here as a live activity timeline."
        />
      </div>
    );
  }

  return (
    <section className="rounded-lg border bg-card overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b px-3 py-2">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold">Swarm activity timeline</h2>
          <p className="text-xs text-muted-foreground">
            {allTasks.length.toLocaleString()} tasks · visible window {ZOOM_LEVELS[zoomIndex].label}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Button
            type="button"
            variant={live ? "secondary" : "outline"}
            size="sm"
            onClick={live ? () => setLive(false) : backToLive}
            className="h-8"
          >
            {live ? <Pause className="h-3.5 w-3.5" /> : <Radio className="h-3.5 w-3.5" />}
            {live ? "Pause" : "Back to live"}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="h-8 w-8"
            onClick={() => {
              setLive(false);
              setZoomIndex((current) => clampZoomIndex(current - 1));
            }}
            aria-label="Zoom in"
          >
            <ZoomIn className="h-3.5 w-3.5" />
          </Button>
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="h-8 w-8"
            onClick={() => {
              setLive(false);
              setZoomIndex((current) => clampZoomIndex(current + 1));
            }}
            aria-label="Zoom out"
          >
            <ZoomOut className="h-3.5 w-3.5" />
          </Button>
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="h-8 w-8"
            onClick={() => void loadOlder()}
            disabled={isLoadingHistory || !hasMoreHistory}
            aria-label="Load older activity"
          >
            {isLoadingHistory ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : hasMoreHistory ? (
              <History className="h-3.5 w-3.5" />
            ) : (
              <RotateCcw className="h-3.5 w-3.5" />
            )}
          </Button>
        </div>
      </div>

      <div className="flex h-[clamp(320px,48vh,560px)] min-h-0">
        <div
          className="shrink-0 border-r bg-muted/35"
          style={{ width: LABEL_WIDTH, paddingTop: HEADER_HEIGHT }}
        >
          {lanes.map((lane) => (
            <div key={lane.id} className="flex h-[42px] min-w-0 items-center gap-2 border-b px-3">
              <div
                className={cn(
                  "h-2.5 w-2.5 rounded-full shrink-0",
                  lane.isLead ? "bg-primary" : "bg-status-info",
                )}
              />
              <div className="min-w-0">
                <div className="truncate text-xs font-medium">{lane.name}</div>
                <div className="truncate text-[10px] text-muted-foreground">
                  {lane.isLead ? "Lead" : lane.role || `${lane.tasks.length} tasks`}
                </div>
              </div>
            </div>
          ))}
        </div>

        <div
          ref={scrollerRef}
          className="min-w-0 flex-1 overflow-auto"
          onScroll={handleScroll}
          onWheel={handleWheel}
        >
          <div
            ref={timelineRef}
            className="relative"
            style={{ width: timelineWidth, height: contentHeight }}
          >
            <div className="sticky top-0 z-20 h-10 border-b bg-card/95 backdrop-blur">
              {ticks.map((tick) => {
                const x = (tick - timelineStartMs) * pxPerMs;
                return (
                  <div
                    key={tick}
                    className="absolute top-0 h-full border-l border-border/80 pl-2 pt-2 text-[10px] text-muted-foreground"
                    style={{ left: x }}
                  >
                    {formatAxisLabel(tick, windowMs)}
                  </div>
                );
              })}
              <div
                className="absolute top-0 h-full border-l border-primary"
                style={{ left: (nowMs - timelineStartMs) * pxPerMs }}
              >
                <div className="ml-1 mt-1 rounded bg-primary px-1.5 py-0.5 text-[10px] font-medium text-primary-foreground">
                  now
                </div>
              </div>
            </div>

            {lanes.map((lane, laneIndex) => {
              const top = HEADER_HEIGHT + laneIndex * LANE_HEIGHT;
              return (
                <div
                  key={lane.id}
                  className="absolute left-0 right-0 border-b bg-background"
                  style={{ top, height: LANE_HEIGHT }}
                >
                  {ticks.map((tick) => (
                    <div
                      key={`${lane.id}-${tick}`}
                      className="absolute top-0 h-full border-l border-border/50"
                      style={{ left: (tick - timelineStartMs) * pxPerMs }}
                    />
                  ))}
                  {lane.tasks.map((task) => {
                    const start = new Date(task.createdAt).getTime();
                    const end = Math.max(start + 1000, taskEndMs(task, nowMs));
                    const left = Math.max(0, (start - timelineStartMs) * pxPerMs);
                    const width = Math.max(MIN_BAR_WIDTH, (end - start) * pxPerMs);
                    const duration = formatDurationMs(end - start);
                    return (
                      <Tooltip key={task.id} delayDuration={120}>
                        <TooltipTrigger asChild>
                          <button
                            type="button"
                            className={cn(
                              "absolute top-2 h-6 rounded border px-2 text-left text-[10px] font-medium shadow-sm transition-opacity hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-ring",
                              statusBarClass(task.status),
                            )}
                            style={{ left, width }}
                            onClick={() => navigate(`/tasks/${task.id}`)}
                          >
                            <span className="block truncate">{taskTitle(task)}</span>
                          </button>
                        </TooltipTrigger>
                        <TooltipContent side="top" align="start" className="max-w-80">
                          <div className="space-y-2">
                            <div className="space-y-1">
                              <div className="line-clamp-3 text-xs font-medium">
                                {taskTitle(task)}
                              </div>
                              <div className="flex items-center gap-1.5">
                                <StatusBadge status={task.status} />
                                <span className="text-[10px] text-muted-foreground">
                                  {duration}
                                </span>
                              </div>
                            </div>
                            <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[10px] text-muted-foreground">
                              <span>Started</span>
                              <span className="text-right text-foreground">
                                {formatTime(start)}
                              </span>
                              <span>Ended</span>
                              <span className="text-right text-foreground">
                                {task.finishedAt ? formatTime(end) : "Live"}
                              </span>
                              <span>Tokens</span>
                              <span className="text-right text-foreground">
                                {task.peakContextTokens
                                  ? formatTokens(task.peakContextTokens)
                                  : "—"}
                              </span>
                              <span>Cost</span>
                              <span className="text-right text-foreground">
                                {formatCost(task.totalCostUsd, { precision: "compact" })}
                              </span>
                            </div>
                          </div>
                        </TooltipContent>
                      </Tooltip>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}
