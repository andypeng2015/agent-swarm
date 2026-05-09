/**
 * Sessions surface — chronological timeline of a session's task chain.
 *
 * Visual model:
 *   1. Tasks created by a human (root prompt + composer follow-ups carry
 *      `requestedByUserId`) split into two parts: a chat-style user-side
 *      bubble (<UserPromptBubble>) followed by an agent-side row
 *      (<TaskCard hideTaskText />) that shows the agent's response.
 *   2. Tasks NOT initiated by a human render as a single agent-side row
 *      with the task text as the body.
 *   3. Sibling tasks sharing a `parentTaskId` collapse into a
 *      <ParallelGroup> with a visible left rail and "N in parallel" header.
 */

import { MessageSquarePlus } from "lucide-react";
import { useMemo } from "react";
import type { AgentTask } from "@/api/types";
import { EmptyState } from "@/components/shared/empty-state";
import { cn } from "@/lib/utils";
import { ParallelGroup, TaskCard } from "./task-card";
import { UserPromptBubble } from "./user-prompt-bubble";

export interface SessionTimelineProps {
  rootTaskId: string;
  chain: AgentTask[];
  className?: string;
}

interface TimelineTree {
  root: AgentTask | null;
  childrenByParent: Map<string, AgentTask[]>;
  orphans: AgentTask[];
}

function buildTimelineTree(rootTaskId: string, chain: AgentTask[]): TimelineTree {
  const childrenByParent = new Map<string, AgentTask[]>();
  let root: AgentTask | null = null;
  const orphans: AgentTask[] = [];

  for (const task of chain) {
    if (task.parentTaskId == null) {
      if (task.id === rootTaskId) {
        root = task;
      } else {
        orphans.push(task);
      }
      continue;
    }
    const list = childrenByParent.get(task.parentTaskId);
    if (list) {
      list.push(task);
    } else {
      childrenByParent.set(task.parentTaskId, [task]);
    }
  }

  for (const list of childrenByParent.values()) {
    list.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  return { root, childrenByParent, orphans };
}

/**
 * Renders a single task as either:
 *   - A user-bubble + agent-row pair (when the task originated from a human
 *     typing into the UI composer — `source === "ui"`), or
 *   - A single agent-row showing the task text as the body (everything
 *     else: Lead-spawned children, slack threads, scheduled jobs, etc.).
 *
 * `requestedByUserId` propagates to children via spawn-task, so it isn't a
 * reliable signal of "this came from a human"; `source` is.
 */
function TaskTurn({
  task,
  parentAgentId,
  insideParallelGroup,
}: {
  task: AgentTask;
  /** Agent who owned the parent task — used to render "via X" delegation hint. */
  parentAgentId?: string | null;
  insideParallelGroup?: boolean;
}) {
  const isUserTyped = task.source === "ui";
  return (
    <>
      {isUserTyped ? (
        <UserPromptBubble
          text={task.task}
          requestedByUserId={task.requestedByUserId}
          createdAt={task.createdAt}
        />
      ) : null}
      <TaskCard
        task={task}
        hideTaskText={isUserTyped}
        insideParallelGroup={insideParallelGroup}
        parentAgentId={parentAgentId}
      />
    </>
  );
}

interface SubtreeProps {
  task: AgentTask;
  childrenByParent: Map<string, AgentTask[]>;
}

function ChildrenChain({ task, childrenByParent }: SubtreeProps) {
  const children = childrenByParent.get(task.id) ?? [];
  if (children.length === 0) return null;
  const parentAgentId = task.agentId;

  if (children.length === 1) {
    const child = children[0];
    return (
      <>
        <TaskTurn task={child} parentAgentId={parentAgentId} />
        <ChildrenChain task={child} childrenByParent={childrenByParent} />
      </>
    );
  }

  return (
    <>
      <ParallelGroup count={children.length}>
        {children.map((child) => (
          <TaskTurn key={child.id} task={child} parentAgentId={parentAgentId} insideParallelGroup />
        ))}
      </ParallelGroup>
      {children.map((child) => (
        <ChildrenChain key={child.id} task={child} childrenByParent={childrenByParent} />
      ))}
    </>
  );
}

export function SessionTimeline({ rootTaskId, chain, className }: SessionTimelineProps) {
  const tree = useMemo(() => buildTimelineTree(rootTaskId, chain), [rootTaskId, chain]);

  if (tree.orphans.length > 0) {
    console.warn(
      `[SessionTimeline] received ${tree.orphans.length} orphan root tasks not matching rootTaskId=${rootTaskId}; rendering them in the orphan footer.`,
    );
  }

  if (!tree.root) {
    return (
      <div className={className}>
        <EmptyState
          icon={MessageSquarePlus}
          title="No messages yet"
          description="Start typing below to send the first message in this session."
        />
      </div>
    );
  }

  const root = tree.root;
  const hasChildren = (tree.childrenByParent.get(root.id)?.length ?? 0) > 0;

  return (
    <div className={cn("max-w-3xl mx-auto w-full", className)}>
      {/* Single timeline column — agent rows draw their own spine fragments
          (so user bubbles don't sit on a stray line). Adjacent rows touch
          via padding-bottom on each row, forming a continuous spine. */}
      <div className="flex flex-col">
        <TaskTurn task={root} />
        <ChildrenChain task={root} childrenByParent={tree.childrenByParent} />

        {!hasChildren && root.status === "completed" ? (
          <p className="text-xs text-muted-foreground italic pl-12">
            Reply below to continue the session.
          </p>
        ) : null}

        {tree.orphans.length > 0 && (
          <section
            aria-label="Orphan tasks"
            className="mt-4 border-t border-border pt-3 flex flex-col"
          >
            <h4 className="font-mono font-bold text-[10px] uppercase tracking-[0.08em] text-muted-foreground mb-2">
              Orphan tasks ({tree.orphans.length})
            </h4>
            <p className="text-xs text-muted-foreground mb-3">
              These tasks have no parent and don't match the session root — likely a chain-fetch
              bug. Rendering for visibility.
            </p>
            {tree.orphans.map((o) => (
              <TaskCard key={o.id} task={o} />
            ))}
          </section>
        )}
      </div>
    </div>
  );
}
