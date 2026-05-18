export const SDK_ALLOWLIST = [
  "memory_search",
  "memory_list",
  "memory_get",
  "memory_rate",
  "memory_create",
  "task_list",
  "task_get",
  "task_storeProgress",
  "event_create",
  "event_list",
  "event_batch",
  "event_counts",
  "kv_get",
  "kv_set",
  "kv_del",
  "kv_incr",
  "kv_list",
  "agent_list",
  "agent_get",
  "repo_list",
  "repo_get",
  "schedule_list",
  "schedule_get",
  "script_search",
  "script_run",
] as const;

export function isSdkToolAllowed(name: string): boolean {
  return (SDK_ALLOWLIST as readonly string[]).includes(name);
}
