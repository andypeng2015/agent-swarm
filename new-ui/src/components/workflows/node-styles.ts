import type { WorkflowRunStepStatus } from "@/api/types";

export const statusBorderColor: Record<WorkflowRunStepStatus, string> = {
  pending: "border-status-neutral/50",
  running: "border-amber-500",
  waiting: "border-yellow-500",
  completed: "border-emerald-500",
  failed: "border-red-500",
  skipped: "border-status-neutral/40",
};
