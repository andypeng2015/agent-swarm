import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod";
import { createToolRegistrar } from "@/tools/utils";
import { readQueue } from "./queue";
import { compareForBacklog } from "./scoring";
import { type Queue, QueueItemSchema, ScannerSchema } from "./types";
import { queueErrorResult, validateRepoPath } from "./utils";

export const registerCodeHealthNextTool = (server: McpServer) => {
  createToolRegistrar(server)(
    "code-health-next",
    {
      title: "Code-Health Next",
      description:
        "Return the single highest-priority open item from the queue. Pass `scanner` or " +
        "`kindPrefix` to filter (e.g., scanner='knip' to bias toward dead-export work). " +
        "Returns `{ item: null }` when the queue is drained.",
      annotations: { readOnlyHint: true },
      inputSchema: z.object({
        repoPath: z.string().describe("Absolute path to the target repo's working tree."),
        scanner: ScannerSchema.optional().describe("Restrict to one scanner."),
        kindPrefix: z
          .string()
          .optional()
          .describe("Match items whose `kind` starts with this string (e.g. 'dead-')."),
      }),
      outputSchema: z.object({
        success: z.boolean(),
        reason: z.string().optional(),
        message: z.string().optional(),
        item: QueueItemSchema.nullable().optional(),
      }),
    },
    async ({ repoPath, scanner, kindPrefix }) => {
      const pathError = validateRepoPath(repoPath);
      if (pathError) return pathError;

      let queue: Queue;
      try {
        queue = await readQueue(repoPath);
      } catch (err) {
        return queueErrorResult(err);
      }

      const candidates = queue.items
        .filter((it) => it.status === "open")
        .filter((it) => (scanner ? it.scanner === scanner : true))
        .filter((it) => (kindPrefix ? it.kind.startsWith(kindPrefix) : true))
        .sort(compareForBacklog);

      const item = candidates[0] ?? null;
      const text = item
        ? `Next: [${item.scanner}/${item.kind}] ${item.title} (score=${item.score}, file=${item.file ?? "n/a"})`
        : "Queue drained — no matching open items.";

      return {
        content: [{ type: "text" as const, text }],
        structuredContent: { success: true, item },
      };
    },
  );
};
