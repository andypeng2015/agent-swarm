import { mkdir } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import {
  type ItemStatus,
  QUEUE_DIR,
  QUEUE_FILE,
  type Queue,
  type QueueItem,
  QueueSchema,
  type Resolution,
  type ScannerResult,
  type ScanRecord,
} from "./types";

export class CodeHealthQueueError extends Error {
  constructor(
    message: string,
    public readonly code: "INVALID_PATH" | "READ_FAILED" | "WRITE_FAILED" | "PARSE_FAILED",
  ) {
    super(message);
    this.name = "CodeHealthQueueError";
  }
}

export function queueFilePath(repoPath: string): string {
  if (!isAbsolute(repoPath)) {
    throw new CodeHealthQueueError(
      `repoPath must be an absolute path, got "${repoPath}"`,
      "INVALID_PATH",
    );
  }
  return join(resolve(repoPath), QUEUE_DIR, QUEUE_FILE);
}

export function newQueue(): Queue {
  return { version: 1, lastScannedAt: null, scans: [], items: [] };
}

/** Reads the queue from disk; returns a fresh queue if the file doesn't exist. */
export async function readQueue(repoPath: string): Promise<Queue> {
  const path = queueFilePath(repoPath);
  const file = Bun.file(path);
  if (!(await file.exists())) return newQueue();

  let raw: string;
  try {
    raw = await file.text();
  } catch (err) {
    throw new CodeHealthQueueError(
      `Failed to read queue at ${path}: ${(err as Error).message}`,
      "READ_FAILED",
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new CodeHealthQueueError(
      `Queue file at ${path} is not valid JSON: ${(err as Error).message}`,
      "PARSE_FAILED",
    );
  }

  const result = QueueSchema.safeParse(parsed);
  if (!result.success) {
    throw new CodeHealthQueueError(
      `Queue file at ${path} does not match schema: ${result.error.message}`,
      "PARSE_FAILED",
    );
  }
  return result.data;
}

export async function writeQueue(repoPath: string, queue: Queue): Promise<void> {
  const path = queueFilePath(repoPath);
  try {
    await mkdir(join(resolve(repoPath), QUEUE_DIR), { recursive: true });
    await Bun.write(path, `${JSON.stringify(queue, null, 2)}\n`);
  } catch (err) {
    throw new CodeHealthQueueError(
      `Failed to write queue at ${path}: ${(err as Error).message}`,
      "WRITE_FAILED",
    );
  }
}

interface MergeOptions {
  now?: Date;
}

/**
 * Merge scanner results into the queue:
 * - New items (by id) are added with status "open" and occurrenceCount 1.
 * - Existing items have lastSeenAt updated and occurrenceCount incremented if
 *   currently "open". Resolved/deferred/wontfix items are left alone so we
 *   don't resurrect human decisions on every scan.
 * - Items the scan didn't produce are NOT removed — they may simply not have
 *   been re-detected (e.g., excluded path). `rescore` can age them out later.
 *
 * Returns the updated queue and counts for the scan summary.
 */
export function mergeScanResult(
  queue: Queue,
  result: ScannerResult,
  options: MergeOptions = {},
): { queue: Queue; added: number; reseen: number } {
  const now = options.now ?? new Date();
  const nowIso = now.toISOString();
  const existingById = new Map(queue.items.map((it) => [it.id, it]));

  let added = 0;
  let reseen = 0;
  const updated: QueueItem[] = [...queue.items];

  for (const incoming of result.items) {
    const prior = existingById.get(incoming.id);
    if (!prior) {
      updated.push({
        ...incoming,
        status: "open",
        resolution: null,
        firstSeenAt: nowIso,
        lastSeenAt: nowIso,
        occurrenceCount: 1,
        score: 0, // computed by rescore caller
      });
      added += 1;
      continue;
    }

    const idx = updated.findIndex((it) => it.id === incoming.id);
    if (idx === -1) continue;

    const isOpen = prior.status === "open";
    updated[idx] = {
      ...prior,
      // Refresh metadata (titles/lines can shift) but never overwrite a human
      // decision (status, resolution).
      kind: incoming.kind,
      severity: incoming.severity,
      title: incoming.title,
      file: incoming.file,
      line: incoming.line,
      symbol: incoming.symbol,
      details: incoming.details,
      lastSeenAt: nowIso,
      occurrenceCount: isOpen ? prior.occurrenceCount + 1 : prior.occurrenceCount,
    };
    reseen += 1;
  }

  const scanRecord: ScanRecord = {
    scanner: result.scanner,
    at: nowIso,
    itemsFound: result.items.length,
    durationMs: result.durationMs,
  };

  return {
    queue: {
      ...queue,
      lastScannedAt: nowIso,
      scans: [scanRecord, ...queue.scans].slice(0, 50),
      items: updated,
    },
    added,
    reseen,
  };
}

export function findItem(queue: Queue, itemId: string): QueueItem | undefined {
  return queue.items.find((it) => it.id === itemId);
}

export function setItemStatus(
  queue: Queue,
  itemId: string,
  status: Exclude<ItemStatus, "open">,
  resolution: Partial<Resolution> = {},
  now: Date = new Date(),
): Queue {
  return {
    ...queue,
    items: queue.items.map((it) =>
      it.id === itemId
        ? {
            ...it,
            status,
            resolution: {
              at: now.toISOString(),
              prUrl: resolution.prUrl ?? null,
              note: resolution.note ?? null,
            },
          }
        : it,
    ),
  };
}
