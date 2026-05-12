import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod";
import { createToolRegistrar } from "@/tools/utils";
import { mergeScanResult, readQueue, writeQueue } from "./queue";
import { runScanner } from "./scanners";
import { compareForBacklog, rescoreItem } from "./scoring";
import { type Queue, SCANNERS, ScannerSchema } from "./types";
import { queueErrorResult, scannerErrorResult, validateRepoPath } from "./utils";

export const registerCodeHealthScanTool = (server: McpServer) => {
  createToolRegistrar(server)(
    "code-health-scan",
    {
      title: "Code-Health Scan",
      description:
        "Run a code-health scanner against a repo and merge results into the on-disk queue " +
        "at <repoPath>/.code-health/queue.json. Pass `scanner` to run a single scanner " +
        "(knip or desloppify), or omit to run all scanners sequentially. Returns a summary " +
        "(items added, re-seen, total open). The repo's queue is the source of truth — the " +
        "MCP itself is stateless.",
      annotations: { destructiveHint: false },
      inputSchema: z.object({
        repoPath: z.string().describe("Absolute path to the target repo's working tree."),
        scanner: ScannerSchema.optional().describe(
          "Optional single scanner to run. If omitted, runs all scanners.",
        ),
      }),
      outputSchema: z.object({
        success: z.boolean(),
        reason: z.string().optional(),
        message: z.string().optional(),
        scans: z
          .array(
            z.object({
              scanner: ScannerSchema,
              added: z.number().int(),
              reseen: z.number().int(),
              itemsFound: z.number().int(),
              durationMs: z.number().int(),
            }),
          )
          .optional(),
        totalOpen: z.number().int().optional(),
        totalItems: z.number().int().optional(),
      }),
    },
    async ({ repoPath, scanner }) => {
      const pathError = validateRepoPath(repoPath);
      if (pathError) return pathError;

      let queue: Queue;
      try {
        queue = await readQueue(repoPath);
      } catch (err) {
        return queueErrorResult(err);
      }

      const scannersToRun = scanner ? [scanner] : [...SCANNERS];
      const scans: Array<{
        scanner: (typeof SCANNERS)[number];
        added: number;
        reseen: number;
        itemsFound: number;
        durationMs: number;
      }> = [];

      const now = new Date();
      for (const sc of scannersToRun) {
        try {
          const result = await runScanner(sc, repoPath);
          const merged = mergeScanResult(queue, result, { now });
          queue = merged.queue;
          scans.push({
            scanner: sc,
            added: merged.added,
            reseen: merged.reseen,
            itemsFound: result.items.length,
            durationMs: result.durationMs,
          });
        } catch (err) {
          return scannerErrorResult(sc, err);
        }
      }

      // Rescore so new items get a non-zero score before the queue is persisted.
      queue = { ...queue, items: queue.items.map((it) => rescoreItem(it, now)) };
      queue.items.sort(compareForBacklog);

      try {
        await writeQueue(repoPath, queue);
      } catch (err) {
        return queueErrorResult(err);
      }

      const totalOpen = queue.items.filter((it) => it.status === "open").length;
      const lines = [
        `Scanned ${scannersToRun.join(", ")}.`,
        ...scans.map(
          (s) =>
            `- ${s.scanner}: ${s.itemsFound} found (${s.added} new, ${s.reseen} re-seen) in ${s.durationMs}ms`,
        ),
        `Queue: ${totalOpen} open / ${queue.items.length} total items.`,
      ];

      return {
        content: [{ type: "text" as const, text: lines.join("\n") }],
        structuredContent: {
          success: true,
          scans,
          totalOpen,
          totalItems: queue.items.length,
        },
      };
    },
  );
};
