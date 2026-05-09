/**
 * Sessions surface (Phase 4 ≥1.76.0) — `/sessions` route.
 *
 * Layout:
 *   - Left sidebar: SessionsSidebar listing recent sessions (`useSessions()`).
 *   - Right pane: empty-state placeholder. The actual session detail lives at
 *     `/sessions/:rootTaskId` (separate route). Selecting a sidebar entry
 *     navigates there.
 *
 * Soft-degrade: when `useFeatureGate("1.76.0").supported === false`, this
 * page renders the generic <UpgradeRequired /> page instead.
 */

import { ChevronRight, MessageSquare } from "lucide-react";
import { Link } from "react-router-dom";
import { useFeatureGate } from "@/api/hooks/use-feature-gate";
import { useSessions } from "@/api/hooks/use-sessions";
import type { SessionListItem } from "@/api/types";
import { UpgradeRequired } from "@/components/feature-gate/upgrade-required";
import { EmptyState } from "@/components/shared/empty-state";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { cn, formatRelativeTime } from "@/lib/utils";

export function SessionsSidebar({
  sessions,
  isLoading,
  activeRootTaskId,
}: {
  sessions: SessionListItem[] | undefined;
  isLoading: boolean;
  activeRootTaskId?: string;
}) {
  if (isLoading) {
    return (
      <div className="flex flex-col gap-2 p-3">
        {Array.from({ length: 6 }).map((_, idx) => (
          <Skeleton key={`skeleton-${idx}`} className="h-16 w-full" />
        ))}
      </div>
    );
  }

  if (!sessions || sessions.length === 0) {
    return (
      <div className="p-3">
        <EmptyState
          icon={MessageSquare}
          title="No sessions yet"
          description="Tasks created via the API, MCP, or Slack with no parent will appear here."
        />
      </div>
    );
  }

  return (
    <ul className="flex flex-col gap-1 p-2">
      {sessions.map((s) => {
        const isActive = activeRootTaskId === s.root.id;
        return (
          <li key={s.root.id}>
            <Link
              to={`/sessions/${s.root.id}`}
              className={cn(
                "flex flex-col gap-1 rounded-md border border-transparent p-2.5 text-left transition-colors",
                "hover:bg-muted/50",
                isActive && "border-border bg-muted",
              )}
            >
              <div className="flex items-start justify-between gap-2 min-w-0">
                <span className="text-sm font-medium truncate min-w-0">{s.root.task}</span>
                <Badge variant="outline" size="tag" className="shrink-0">
                  {s.chainTaskCount}
                </Badge>
              </div>
              <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                <span className="truncate">{formatRelativeTime(s.lastActivityAt)}</span>
                <span className="font-mono uppercase tracking-wider text-[9px]">
                  {s.latestStatus.replace(/_/g, " ")}
                </span>
              </div>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

export default function SessionsPage() {
  const gate = useFeatureGate("1.76.0");
  const { data: sessions, isLoading } = useSessions({ limit: 50 });

  if (!gate.supported) {
    return (
      <UpgradeRequired
        feature="Sessions"
        requiredVersion={gate.requiredVersion}
        currentVersion={gate.currentVersion}
      />
    );
  }

  return (
    <div className="flex-1 min-h-0 flex flex-col gap-4 p-1">
      <PageHeader
        title="Sessions"
        icon={MessageSquare}
        description="Chronological task chains — each session = a root task and its descendants."
      />
      <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-4 border border-border rounded-md overflow-hidden">
        <aside className="border-r border-border min-h-0 overflow-auto bg-card">
          <SessionsSidebar sessions={sessions} isLoading={isLoading} />
        </aside>
        <section className="flex flex-col min-h-0 overflow-auto">
          <EmptyState
            icon={ChevronRight}
            title="Pick a session"
            description="Select a session from the sidebar to see the full timeline."
          />
        </section>
      </div>
    </div>
  );
}
