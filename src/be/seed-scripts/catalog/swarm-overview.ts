import { z } from "zod";

export const argsSchema = z.object({});

/** One-call swarm snapshot: every agent's name/role/status plus task counts grouped by status. */
export default async function swarmOverview(_args: any, ctx: any) {
  const s: any = await ctx.swarm.swarm_get({ includeFull: true });
  const agents: any[] = s?.data?.agents ?? s?.agents ?? [];
  const tl: any = await ctx.swarm.task_list({ limit: 100 });
  const tasks: any[] = tl?.data?.tasks ?? tl?.tasks ?? (Array.isArray(tl) ? tl : []);
  const tasksByStatus: Record<string, number> = {};
  for (const t of tasks) tasksByStatus[t.status] = (tasksByStatus[t.status] ?? 0) + 1;
  return {
    agents: agents.map((a: any) => ({
      name: a.name ?? null,
      role: a.isLead ? "lead" : (a.role ?? "worker"),
      status: a.status ?? null,
    })),
    tasksByStatus,
  };
}
