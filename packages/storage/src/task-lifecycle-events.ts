import type { AgentTask } from "@swarm/types";

/**
 * Minimal in-process task-lifecycle event emitter.
 *
 * This exists to invert a layering dependency: the data layer (`be/db`) used to
 * import a GitHub integration (`github/task-reactions`) so it could add an 👀
 * reaction when a task started. Instead, `be/db` now emits a `task-started`
 * event and the GitHub integration subscribes at API-server boot. The data layer
 * no longer depends on any integration.
 *
 * Handlers run synchronously in registration order. Each is wrapped in try/catch
 * so a throwing handler never breaks task processing. Handlers may return a
 * promise; it is ignored (fire-and-forget), but any async rejection is swallowed
 * so it never surfaces as an unhandled rejection. This preserves the original
 * `addEyesReactionOnTaskStart(result).catch(() => {})` semantics exactly.
 */

type TaskStartedHandler = (task: AgentTask) => void | Promise<void>;
export type TaskLifecycleEvent = { event: string; data: unknown };
export type TaskLifecycleEventHandler = (entry: TaskLifecycleEvent) => void | Promise<void>;

const taskStartedHandlers: TaskStartedHandler[] = [];
const taskLifecycleEventHandlers = new Set<TaskLifecycleEventHandler>();

function runFireAndForget<T>(handler: (value: T) => void | Promise<void>, value: T): void {
  try {
    const result = handler(value);
    // Fire-and-forget: ignore the returned promise but swallow async
    // rejections so a failing handler never crashes the process.
    if (result && typeof (result as Promise<void>).catch === "function") {
      (result as Promise<void>).catch(() => {});
    }
  } catch {
    // A throwing handler must never break task processing.
  }
}

/** Register a handler invoked whenever a task transitions to `in_progress`. */
export function onTaskStarted(handler: TaskStartedHandler): void {
  taskStartedHandlers.push(handler);
}

/** Register a generic storage-originated task workflow event handler. */
export function onTaskLifecycleEvent(handler: TaskLifecycleEventHandler): void {
  taskLifecycleEventHandlers.add(handler);
}

/** Remove a generic task workflow event handler. */
export function offTaskLifecycleEvent(handler: TaskLifecycleEventHandler): void {
  taskLifecycleEventHandlers.delete(handler);
}

/** Emit the task-started event. Never throws. */
export function emitTaskStarted(task: AgentTask): void {
  for (const handler of taskStartedHandlers) {
    runFireAndForget(handler, task);
  }
}

/** Emit a storage-originated task workflow event. Never throws. */
export function emitTaskLifecycleEvent(event: string, data: unknown): void {
  for (const handler of taskLifecycleEventHandlers) {
    runFireAndForget(handler, { event, data });
  }
}
