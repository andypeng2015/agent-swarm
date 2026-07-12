import { z } from "zod";

export const argsSchema = z.object({
  parentTaskId: z.string().describe("Parent task id whose children to collect"),
});

/** List all child tasks of a parent with their status and output; returns {children, allDone} for fan-out aggregation. */
export default async function getChildOutputs(args: any, ctx: any) {
  const parsed = argsSchema.safeParse(args);
  if (!parsed.success) return { error: "invalid args: " + parsed.error.message };
  const { parentTaskId } = parsed.data;

  const res: any = await ctx.swarm.task_list({ limit: 100 });
  const all: any[] = res?.data?.tasks ?? res?.tasks ?? (Array.isArray(res) ? res : []);
  const children = all.filter((t: any) => t.parentTaskId === parentTaskId);
  return {
    children: children.map((t: any) => ({
      id: t.id,
      status: t.status,
      agentId: t.agentId ?? null,
      output: t.output ?? null,
    })),
    allDone:
      children.length > 0 &&
      children.every((t: any) => ["completed", "failed", "cancelled"].includes(t.status)),
  };
}
