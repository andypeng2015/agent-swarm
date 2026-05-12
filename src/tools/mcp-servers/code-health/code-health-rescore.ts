import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod";
import { createToolRegistrar } from "@/tools/utils";
import { readQueue, writeQueue } from "./queue";
import { compareForBacklog, rescoreItem } from "./scoring";
import type { Queue } from "./types";
import { queueErrorResult, validateRepoPath } from "./utils";

export const registerCodeHealthRescoreTool = (server: McpServer) => {
  createToolRegistrar(server)(
    "code-health-rescore",
    {
      title: "Code-Health Rescore",
      description:
        "Recompute priority scores on all existing queue items without re-running scanners. " +
        "Designed to be called by the (future) Code-Health Agent after a PR merges, so the " +
        "queue re-orders without a full scan. Cheap: pure function over the existing queue.",
      annotations: { destructiveHint: false },
      inputSchema: z.object({
        repoPath: z.string().describe("Absolute path to the target repo's working tree."),
      }),
      outputSchema: z.object({
        success: z.boolean(),
        reason: z.string().optional(),
        message: z.string().optional(),
        rescored: z.number().int().optional(),
        totalOpen: z.number().int().optional(),
        topItemId: z.string().nullable().optional(),
      }),
    },
    async ({ repoPath }) => {
      const pathError = validateRepoPath(repoPath);
      if (pathError) return pathError;

      let queue: Queue;
      try {
        queue = await readQueue(repoPath);
      } catch (err) {
        return queueErrorResult(err);
      }

      const now = new Date();
      const rescored = {
        ...queue,
        items: queue.items.map((it) => rescoreItem(it, now)).sort(compareForBacklog),
      };

      try {
        await writeQueue(repoPath, rescored);
      } catch (err) {
        return queueErrorResult(err);
      }

      const openItems = rescored.items.filter((it) => it.status === "open");
      const top = openItems[0] ?? null;

      return {
        content: [
          {
            type: "text" as const,
            text: `Rescored ${rescored.items.length} item(s). ${openItems.length} open. Top: ${top ? `${top.id} (score=${top.score})` : "queue drained"}.`,
          },
        ],
        structuredContent: {
          success: true,
          rescored: rescored.items.length,
          totalOpen: openItems.length,
          topItemId: top?.id ?? null,
        },
      };
    },
  );
};
