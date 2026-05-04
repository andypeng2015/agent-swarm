import {
  cancelTask,
  getCompletedStepNodeIds,
  getTaskByWorkflowRunStepId,
  getWorkflow,
  getWorkflowRun,
  getWorkflowRunStep,
  getWorkflowRunStepsByRunId,
  resolveWaitState,
  updateWorkflowRun,
  updateWorkflowRunStep,
} from "../be/db";
import { checkpointStep } from "./checkpoint";
import { getSuccessors } from "./definition";
import { findReadyNodes, walkGraph } from "./engine";
import type { WorkflowEventBus } from "./event-bus";
import type { ExecutorRegistry } from "./executors/registry";
import { computeNextPort } from "./executors/wait";

interface TaskEvent {
  taskId: string;
  output?: string;
  agentId?: string;
  workflowRunId?: string;
  workflowRunStepId?: string;
  failureReason?: string;
}

interface ApprovalEvent {
  requestId: string;
  status: "approved" | "rejected" | "timeout";
  responses: Record<string, unknown> | null;
  workflowRunId?: string;
  workflowRunStepId?: string;
}

/**
 * Wire up event bus listeners for workflow resume on task lifecycle events.
 */
export function setupWorkflowResumeListener(
  eventBus: WorkflowEventBus,
  registry: ExecutorRegistry,
): void {
  eventBus.on("task.completed", async (data: unknown) => {
    const event = data as TaskEvent;
    if (!event.workflowRunId || !event.workflowRunStepId) return;
    try {
      await resumeFromTaskCompletion(event, registry);
    } catch (err) {
      console.error("[workflows] Resume from task completion failed:", err);
    }
  });

  eventBus.on("task.failed", async (data: unknown) => {
    const event = data as TaskEvent;
    if (!event.workflowRunId || !event.workflowRunStepId) return;
    try {
      await handleTaskFailure(event, event.failureReason ?? "Task failed", registry);
    } catch (err) {
      console.error("[workflows] Handle task failure error:", err);
    }
  });

  eventBus.on("task.cancelled", async (data: unknown) => {
    const event = data as TaskEvent;
    if (!event.workflowRunId || !event.workflowRunStepId) return;
    try {
      await handleTaskFailure(event, "Task was cancelled", registry);
    } catch (err) {
      console.error("[workflows] Handle task cancellation error:", err);
    }
  });

  eventBus.on("approval.resolved", async (data: unknown) => {
    const event = data as ApprovalEvent;
    if (!event.workflowRunId || !event.workflowRunStepId) return;
    try {
      await resumeFromApprovalResolution(event, registry);
    } catch (err) {
      console.error("[workflows] Resume from approval resolution failed:", err);
    }
  });
}

/**
 * Resume a workflow after a linked task completes.
 *
 * 1. Verify run and step are in "waiting" state
 * 2. Checkpoint step completion with task output
 * 3. Set run status to "running"
 * 4. Find successors and continue the graph walk
 */
async function resumeFromTaskCompletion(
  event: TaskEvent,
  registry: ExecutorRegistry,
): Promise<void> {
  const run = getWorkflowRun(event.workflowRunId!);
  if (!run || (run.status !== "waiting" && run.status !== "running")) return;

  const step = getWorkflowRunStep(event.workflowRunStepId!);
  if (!step || step.status !== "waiting") return;

  const workflow = getWorkflow(run.workflowId);
  if (!workflow) return;

  // Checkpoint: atomic step completion + context update
  const ctx = (run.context ?? {}) as Record<string, unknown>;

  // JSON-parse structured output so downstream nodes can access nested fields
  let taskOutput: unknown = event.output;
  if (event.output) {
    try {
      const parsed = JSON.parse(event.output);
      if (typeof parsed === "object" && parsed !== null) {
        taskOutput = parsed;
      }
    } catch {
      // Not JSON — keep as string (non-structured output tasks)
    }
  }
  const stepOutput = { taskId: event.taskId, taskOutput };

  checkpointStep(run.id, step.id, step.nodeId, { output: stepOutput }, ctx);

  // Set run back to running
  updateWorkflowRun(run.id, { status: "running" });

  // Use direct successor-based routing (same as resumeFromApprovalResolution).
  // findReadyNodes is NOT loop-aware — it excludes nodes with any completed step,
  // which breaks loop workflows where a node needs re-execution on a new iteration.
  // walkGraph handles convergence internally via activeEdges reconstruction.
  const successors = getSuccessors(workflow.definition, step.nodeId);

  if (successors.length > 0) {
    await walkGraph(workflow.definition, run.id, ctx, successors, registry, workflow.id);
  } else {
    finalizeOrWait(run.id);
  }
}

/**
 * If no nodes are ready and no steps are still waiting, finalize the run.
 * Otherwise set it back to waiting for the next task completion.
 */
export function finalizeOrWait(runId: string): void {
  const steps = getWorkflowRunStepsByRunId(runId);
  const hasWaiting = steps.some((s) => s.status === "waiting");
  if (hasWaiting) {
    updateWorkflowRun(runId, { status: "waiting" });
  } else {
    // All steps done (completed or failed) — finalize the run
    updateWorkflowRun(runId, {
      status: "completed",
      finishedAt: new Date().toISOString(),
    });
  }
}

/**
 * Handle task failure/cancellation — respects workflow's onNodeFailure config.
 * 'fail' (default): mark the entire run as failed.
 * 'continue': treat as completed with error output, let convergence proceed.
 */
async function handleTaskFailure(
  event: TaskEvent,
  reason: string,
  registry: ExecutorRegistry,
): Promise<void> {
  const run = getWorkflowRun(event.workflowRunId!);
  if (!run) return;

  const workflow = getWorkflow(run.workflowId);
  if (!workflow) return;

  const onFailure = workflow.definition.onNodeFailure ?? "fail";

  if (onFailure === "fail") {
    markRunFailed(event, reason);
    return;
  }

  // "continue": treat as completed with error output
  const step = getWorkflowRunStep(event.workflowRunStepId!);
  if (!step) return;

  const ctx = (run.context ?? {}) as Record<string, unknown>;
  const stepOutput = {
    taskId: event.taskId,
    taskOutput: `[FAILED: ${reason}] This node failed or was cancelled.`,
  };
  checkpointStep(run.id, step.id, step.nodeId, { output: stepOutput }, ctx);

  updateWorkflowRun(run.id, { status: "running" });

  // Use direct successor-based routing (loop-aware).
  const successors = getSuccessors(workflow.definition, step.nodeId);

  if (successors.length > 0) {
    await walkGraph(workflow.definition, run.id, ctx, successors, registry, workflow.id);
  } else {
    finalizeOrWait(run.id);
  }
}

/**
 * Mark a workflow run as failed when its linked task fails or is cancelled.
 */
function markRunFailed(event: TaskEvent, reason: string): void {
  const now = new Date().toISOString();
  updateWorkflowRunStep(event.workflowRunStepId!, {
    status: "failed",
    error: reason,
    finishedAt: now,
  });
  updateWorkflowRun(event.workflowRunId!, {
    status: "failed",
    error: reason,
    finishedAt: now,
  });
}

/**
 * Retry a failed workflow run from its failed step.
 */
export async function retryFailedRun(runId: string, registry: ExecutorRegistry): Promise<void> {
  const run = getWorkflowRun(runId);
  if (!run || run.status !== "failed") throw new Error("Run is not in failed state");

  const workflow = getWorkflow(run.workflowId);
  if (!workflow) throw new Error("Workflow not found");

  // Find the failed step
  const steps = getWorkflowRunStepsByRunId(runId);
  const failedStep = steps.find((s) => s.status === "failed");
  if (!failedStep) throw new Error("No failed step found");

  // Reset step and run
  updateWorkflowRunStep(failedStep.id, { status: "pending", error: undefined });
  const ctx = (run.context ?? {}) as Record<string, unknown>;
  updateWorkflowRun(runId, { status: "running", error: undefined, context: ctx });

  // Resume from the failed node — use findReadyNodes for convergence safety
  const completedNodeIds = new Set(getCompletedStepNodeIds(runId));
  const readyNodes = findReadyNodes(workflow.definition, completedNodeIds);
  const failedNode = workflow.definition.nodes.find((n) => n.id === failedStep.nodeId);
  if (!failedNode) throw new Error(`Node ${failedStep.nodeId} not found in workflow definition`);

  // Include the failed node if it's not already in ready nodes
  const nodesToRun = readyNodes.some((n) => n.id === failedNode.id)
    ? readyNodes
    : [failedNode, ...readyNodes];
  await walkGraph(workflow.definition, runId, ctx, nodesToRun, registry, workflow.id);
}

/**
 * Cancel a workflow run and all its non-terminal steps.
 * Also cancels any in-progress tasks spawned by waiting/running steps.
 */
export function cancelWorkflowRun(runId: string, reason?: string): void {
  const run = getWorkflowRun(runId);
  if (!run) throw new Error("Workflow run not found");

  const terminalStatuses = ["completed", "failed", "cancelled", "skipped"];
  if (terminalStatuses.includes(run.status)) {
    throw new Error(`Cannot cancel run in '${run.status}' state`);
  }

  const now = new Date().toISOString();
  const cancelReason = reason ?? "Cancelled by user";

  // Cancel non-terminal steps and their associated tasks
  const steps = getWorkflowRunStepsByRunId(runId);
  for (const step of steps) {
    if (terminalStatuses.includes(step.status)) continue;

    // Cancel any task linked to this step
    const task = getTaskByWorkflowRunStepId(step.id);
    if (task) {
      cancelTask(task.id, cancelReason);
    }

    updateWorkflowRunStep(step.id, {
      status: "cancelled",
      error: cancelReason,
      finishedAt: now,
    });
  }

  // Mark the run itself as cancelled
  updateWorkflowRun(runId, {
    status: "cancelled",
    error: cancelReason,
    finishedAt: now,
  });
}

/**
 * Resume a workflow after a linked approval request is resolved.
 *
 * 1. Verify run and step are in "waiting" state
 * 2. Checkpoint step completion with approval response data
 * 3. Route to the appropriate port (approved/rejected/timeout)
 * 4. Continue the graph walk
 */
async function resumeFromApprovalResolution(
  event: ApprovalEvent,
  registry: ExecutorRegistry,
): Promise<void> {
  const run = getWorkflowRun(event.workflowRunId!);
  if (!run || (run.status !== "waiting" && run.status !== "running")) return;

  const step = getWorkflowRunStep(event.workflowRunStepId!);
  if (!step || step.status !== "waiting") return;

  const workflow = getWorkflow(run.workflowId);
  if (!workflow) return;

  const ctx = (run.context ?? {}) as Record<string, unknown>;

  // Determine output port based on approval status
  const nextPort =
    event.status === "timeout" ? "timeout" : event.status === "rejected" ? "rejected" : "approved";

  const stepOutput = {
    requestId: event.requestId,
    status: event.status,
    responses: event.responses,
  };

  checkpointStep(run.id, step.id, step.nodeId, { output: stepOutput, nextPort }, ctx);
  updateWorkflowRun(run.id, { status: "running" });

  // Use port-based routing to determine the correct successors.
  // findReadyNodes without activeEdges would return ALL structural successors
  // (e.g. both "success" and "generate-question"), ignoring the port selection.
  // Instead, compute the port-specific successors and let walkGraph handle
  // convergence checks via its internal activeEdges reconstruction.
  const successors = getSuccessors(workflow.definition, step.nodeId, nextPort);

  if (successors.length > 0) {
    await walkGraph(workflow.definition, run.id, ctx, successors, registry, workflow.id);
  } else {
    finalizeOrWait(run.id);
  }
}

/**
 * Resume a paused `wait` node. Single entry-point shared by the wait poller
 * (Phase 2 — time mode + event-mode timeout) and, in Phase 3, the bus listener
 * for event-mode signal arrival.
 *
 * Flow:
 *   1. Atomically resolve the `wait_states` row (`pending → fired|timeout`).
 *      Race-safe: `resolveWaitState` returns `{updated: false}` when a
 *      concurrent caller already won — we bail without further side-effects.
 *   2. Reload the run + step. Bail if the step is no longer in `waiting`
 *      (cancelled, failed, or somehow already advanced).
 *   3. Compute the output port (time → `default`, event+fired → `event`,
 *      event+timeout → `timeout`).
 *   4. Checkpoint the step as completed with the wait output, set the run
 *      back to `running`, and walk the successors of the chosen port.
 *
 * NOTE: there are intentionally NO `wait.fired` / `wait.timeout` bus events.
 * Resumption is an internal function call — the poller invokes this directly,
 * and the Phase 3 bus listener will too.
 */
export async function resumeWaitState(
  waitId: string,
  status: "fired" | "timeout",
  payload: unknown,
  registry: ExecutorRegistry,
): Promise<void> {
  // 1. Atomic state transition. Only the first caller proceeds.
  const result = resolveWaitState(waitId, { status, firedPayload: payload });
  if (!result.updated || !result.row) return;

  const waitRow = result.row;

  // 2. Load the surrounding run + step. If anything has moved on (cancelled,
  // failed, retried, etc.), stay quiet.
  const run = getWorkflowRun(waitRow.workflowRunId);
  if (!run || (run.status !== "waiting" && run.status !== "running")) return;

  const step = getWorkflowRunStep(waitRow.workflowRunStepId);
  if (!step || step.status !== "waiting") return;

  const workflow = getWorkflow(run.workflowId);
  if (!workflow) return;

  // 3. Pick the output port.
  const nextPort = computeNextPort(waitRow.mode, status);

  // 4. Build step output, checkpoint, transition run, walk successors.
  const ctx = (run.context ?? {}) as Record<string, unknown>;
  const stepOutput = {
    waitId: waitRow.id,
    mode: waitRow.mode,
    firedAt: waitRow.resolvedAt,
    payload: payload === undefined ? undefined : payload,
  };

  checkpointStep(run.id, step.id, step.nodeId, { output: stepOutput, nextPort }, ctx);
  updateWorkflowRun(run.id, { status: "running" });

  const successors = getSuccessors(workflow.definition, step.nodeId, nextPort);
  if (successors.length > 0) {
    await walkGraph(workflow.definition, run.id, ctx, successors, registry, workflow.id);
  } else {
    finalizeOrWait(run.id);
  }
}
