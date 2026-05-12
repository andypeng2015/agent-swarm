import { isAbsolute } from "node:path";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { CodeHealthQueueError } from "./queue";

export function invalidPathResult(repoPath: string): CallToolResult {
  return {
    content: [
      {
        type: "text",
        text: `repoPath must be an absolute path on disk (got "${repoPath}").`,
      },
    ],
    structuredContent: {
      success: false,
      reason: "invalid-path",
      message: `repoPath must be an absolute path on disk (got "${repoPath}").`,
    },
    isError: true,
  };
}

export function validateRepoPath(repoPath: string): CallToolResult | null {
  return isAbsolute(repoPath) ? null : invalidPathResult(repoPath);
}

export function queueErrorResult(err: unknown): CallToolResult {
  const message =
    err instanceof CodeHealthQueueError
      ? err.message
      : err instanceof Error
        ? err.message
        : "Unknown error";
  const code = err instanceof CodeHealthQueueError ? err.code : "UNKNOWN";
  return {
    content: [{ type: "text", text: `Queue error (${code}): ${message}` }],
    structuredContent: { success: false, reason: "queue-error", message },
    isError: true,
  };
}

export function scannerErrorResult(scanner: string, err: unknown): CallToolResult {
  const message = err instanceof Error ? err.message : "Unknown error";
  return {
    content: [{ type: "text", text: `Scanner "${scanner}" failed: ${message}` }],
    structuredContent: { success: false, reason: "scanner-failed", scanner, message },
    isError: true,
  };
}
