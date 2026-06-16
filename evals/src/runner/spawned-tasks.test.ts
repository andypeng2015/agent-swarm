import { describe, expect, it } from "bun:test";
import { SwarmClient } from "../swarm/client.ts";
import type { SwarmTask } from "../types.ts";

/**
 * Automated QA for Plan A §Phase 1 runtime-spawned-task enumeration. The merge
 * itself is inline in runner/index.ts (after the upfront-task await loop); this
 * test exercises the SAME algorithm against a synthetic full-task list so we can
 * assert the behavior without booting an E2B stack:
 *
 *   - 1 upfront LEAD task (the scenario's `worker:"lead"` task)
 *   - 2 child tasks delegated by the lead (creatorAgentId=lead, parentTaskId=lead task)
 *   - 2 auto follow-ups (taskType="follow-up", source="system")
 *
 * Expectation: all 5 land in ctx.tasks (the upfront set was just the 1 lead task).
 */

const LEAD_AGENT = "agent-lead";
const WORKER_A = "agent-worker-a";
const WORKER_B = "agent-worker-b";
const LEAD_TASK_ID = "task-lead-0";

/** The full /api/tasks?fields=full set the fresh-DB attempt would return. */
function fixtureFullTaskList(): SwarmTask[] {
  return [
    {
      id: LEAD_TASK_ID,
      title: "Audit the task history",
      description: "Delegate to your two researchers and merge their reports.",
      status: "completed",
      agentId: LEAD_AGENT,
    },
    {
      id: "task-child-a",
      title: "Research shard A",
      description: "Count completed tasks.",
      status: "completed",
      agentId: WORKER_A,
      creatorAgentId: LEAD_AGENT,
      parentTaskId: LEAD_TASK_ID,
    },
    {
      id: "task-child-b",
      title: "Research shard B",
      description: "Count failed tasks.",
      status: "completed",
      agentId: WORKER_B,
      creatorAgentId: LEAD_AGENT,
      parentTaskId: LEAD_TASK_ID,
    },
    {
      id: "task-followup-a",
      title: "Follow-up on shard A",
      description: "Worker A completed — review.",
      status: "completed",
      agentId: LEAD_AGENT,
      taskType: "follow-up",
      source: "system",
      parentTaskId: "task-child-a",
    },
    {
      id: "task-followup-b",
      title: "Follow-up on shard B",
      description: "Worker B completed — review.",
      status: "completed",
      agentId: LEAD_AGENT,
      taskType: "follow-up",
      source: "system",
      parentTaskId: "task-child-b",
    },
  ];
}

/**
 * Replicate the runner's inline merge (runner/index.ts): start from the upfront
 * `tasks`, fetch the full list via `client.listAllTasks()`, append every task
 * not already tracked by id.
 */
async function mergeSpawnedTasks(
  upfront: SwarmTask[],
  client: Pick<SwarmClient, "listAllTasks">,
): Promise<SwarmTask[]> {
  const ctxTasks: SwarmTask[] = [...upfront];
  const knownIds = new Set(upfront.map((t) => t.id));
  const allTasks = await client.listAllTasks();
  const spawned = allTasks.filter((t) => t.id && !knownIds.has(t.id));
  ctxTasks.push(...spawned);
  return ctxTasks;
}

describe("runtime-spawned-task enumeration (Plan A §Phase 1)", () => {
  it("merges lead-delegated children + follow-ups into ctx.tasks (1 upfront → 5 total)", async () => {
    const upfront: SwarmTask[] = [
      {
        id: LEAD_TASK_ID,
        title: "Audit the task history",
        description: "Delegate to your two researchers and merge their reports.",
        status: "completed",
        agentId: LEAD_AGENT,
      },
    ];

    // Stub a SwarmClient whose listAllTasks returns the fresh-DB full set.
    const client = new SwarmClient("http://stub", "key");
    client.listAllTasks = async () => fixtureFullTaskList();

    const ctxTasks = await mergeSpawnedTasks(upfront, client);

    expect(ctxTasks).toHaveLength(5);
    const ids = ctxTasks.map((t) => t.id).sort();
    expect(ids).toEqual(
      ["task-child-a", "task-child-b", "task-followup-a", "task-followup-b", LEAD_TASK_ID].sort(),
    );

    // The delegation artifacts are now visible to scoring with their fields intact.
    const children = ctxTasks.filter(
      (t) => t.creatorAgentId === LEAD_AGENT && t.parentTaskId === LEAD_TASK_ID,
    );
    expect(children).toHaveLength(2);

    const followUps = ctxTasks.filter((t) => t.taskType === "follow-up" && t.source === "system");
    expect(followUps).toHaveLength(2);
  });

  it("dedupes by id so an upfront task already present in the list isn't doubled", async () => {
    const upfront = fixtureFullTaskList().slice(0, 1); // lead task already in the full list
    const client = new SwarmClient("http://stub", "key");
    client.listAllTasks = async () => fixtureFullTaskList();

    const ctxTasks = await mergeSpawnedTasks(upfront, client);
    expect(ctxTasks).toHaveLength(5);
    expect(ctxTasks.filter((t) => t.id === LEAD_TASK_ID)).toHaveLength(1);
  });
});
