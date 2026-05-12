import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod";
import { createToolRegistrar } from "@/tools/utils";
import { readQueue } from "./queue";
import { compareForBacklog } from "./scoring";
import { ItemStatusSchema, type Queue, QueueItemSchema, ScannerSchema } from "./types";
import { queueErrorResult, validateRepoPath } from "./utils";

export const registerCodeHealthBacklogTool = (server: McpServer) => {
  createToolRegistrar(server)(
    "code-health-backlog",
    {
      title: "Code-Health Backlog",
      description:
        "List queue items, sorted by priority (highest first). Defaults to open items only — " +
        "pass `includeResolved=true` for a full audit view, or `status` to filter to a single " +
        "outcome. Designed for human/lead review of the slop backlog.",
      annotations: { readOnlyHint: true },
      inputSchema: z.object({
        repoPath: z.string().describe("Absolute path to the target repo's working tree."),
        limit: z
          .number()
          .int()
          .min(1)
          .max(500)
          .optional()
          .describe("Max items to return (default 50)."),
        scanner: ScannerSchema.optional().describe("Restrict to one scanner."),
        status: ItemStatusSchema.optional().describe(
          "Restrict to a single status. Default: only `open` items.",
        ),
        includeResolved: z
          .boolean()
          .optional()
          .describe(
            "If true, include all non-open statuses (resolved/deferred/wontfix). Ignored if `status` is set.",
          ),
      }),
      outputSchema: z.object({
        success: z.boolean(),
        reason: z.string().optional(),
        message: z.string().optional(),
        items: z.array(QueueItemSchema).optional(),
        totalOpen: z.number().int().optional(),
        totalItems: z.number().int().optional(),
        lastScannedAt: z.string().nullable().optional(),
      }),
    },
    async ({ repoPath, limit, scanner, status, includeResolved }) => {
      const pathError = validateRepoPath(repoPath);
      if (pathError) return pathError;

      let queue: Queue;
      try {
        queue = await readQueue(repoPath);
      } catch (err) {
        return queueErrorResult(err);
      }

      const effectiveLimit = limit ?? 50;
      const items = queue.items
        .filter((it) => {
          if (status) return it.status === status;
          if (includeResolved) return true;
          return it.status === "open";
        })
        .filter((it) => (scanner ? it.scanner === scanner : true))
        .sort(compareForBacklog)
        .slice(0, effectiveLimit);

      const totalOpen = queue.items.filter((it) => it.status === "open").length;

      const summary =
        items.length === 0
          ? "No matching items."
          : `Top ${items.length} item(s) (of ${totalOpen} open, ${queue.items.length} total):\n` +
            items
              .map(
                (it, i) =>
                  `${i + 1}. [${it.scanner}/${it.kind}] (score=${it.score}) ${it.title}${it.file ? ` — ${it.file}${it.line ? `:${it.line}` : ""}` : ""}`,
              )
              .join("\n");

      return {
        content: [{ type: "text" as const, text: summary }],
        structuredContent: {
          success: true,
          items,
          totalOpen,
          totalItems: queue.items.length,
          lastScannedAt: queue.lastScannedAt,
        },
      };
    },
  );
};
