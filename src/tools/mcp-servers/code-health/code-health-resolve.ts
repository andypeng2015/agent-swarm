import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod";
import { createToolRegistrar } from "@/tools/utils";
import { findItem, readQueue, setItemStatus, writeQueue } from "./queue";
import { rescoreItem } from "./scoring";
import { ItemStatusSchema, type Queue, QueueItemSchema } from "./types";
import { queueErrorResult, validateRepoPath } from "./utils";

const ResolutionStatusSchema = ItemStatusSchema.exclude(["open"]);

export const registerCodeHealthResolveTool = (server: McpServer) => {
  createToolRegistrar(server)(
    "code-health-resolve",
    {
      title: "Code-Health Resolve",
      description:
        "Mark a queue item as resolved, deferred, or wontfix. `prUrl` and `note` are optional " +
        "but recommended — they record the human/agent decision for audit and `rescore`. " +
        "Resolving an item zeroes its score; it stays in the queue but drops out of `next`.",
      annotations: { destructiveHint: false },
      inputSchema: z.object({
        repoPath: z.string().describe("Absolute path to the target repo's working tree."),
        itemId: z.string().describe("Queue item ID (from `next` / `backlog`)."),
        status: ResolutionStatusSchema.describe(
          "Outcome — `resolved` (fixed), `deferred` (revisit later), or `wontfix`.",
        ),
        prUrl: z.string().optional().describe("PR URL that resolved this item, if any."),
        note: z.string().optional().describe("Human-readable rationale."),
      }),
      outputSchema: z.object({
        success: z.boolean(),
        reason: z.string().optional(),
        message: z.string().optional(),
        item: QueueItemSchema.optional(),
      }),
    },
    async ({ repoPath, itemId, status, prUrl, note }) => {
      const pathError = validateRepoPath(repoPath);
      if (pathError) return pathError;

      let queue: Queue;
      try {
        queue = await readQueue(repoPath);
      } catch (err) {
        return queueErrorResult(err);
      }

      if (!findItem(queue, itemId)) {
        return {
          content: [{ type: "text", text: `Item "${itemId}" not found in queue.` }],
          structuredContent: {
            success: false,
            reason: "not-found",
            message: `Item "${itemId}" not found in queue.`,
          },
          isError: true,
        };
      }

      const now = new Date();
      const updated = setItemStatus(
        queue,
        itemId,
        status,
        { prUrl: prUrl ?? null, note: note ?? null },
        now,
      );
      const rescored = {
        ...updated,
        items: updated.items.map((it) => (it.id === itemId ? rescoreItem(it, now) : it)),
      };

      try {
        await writeQueue(repoPath, rescored);
      } catch (err) {
        return queueErrorResult(err);
      }

      const item = findItem(rescored, itemId);
      return {
        content: [
          {
            type: "text" as const,
            text: `Marked ${itemId} as ${status}${prUrl ? ` (pr=${prUrl})` : ""}.`,
          },
        ],
        structuredContent: { success: true, item },
      };
    },
  );
};
