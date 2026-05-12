import { describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  findItem,
  mergeScanResult,
  newQueue,
  queueFilePath,
  readQueue,
  setItemStatus,
  writeQueue,
} from "../tools/mcp-servers/code-health/queue";
import type { QueueItem, ScannerResult } from "../tools/mcp-servers/code-health/types";

function tmpRepo(): string {
  return mkdtempSync(join(tmpdir(), "code-health-test-"));
}

function scanItem(
  overrides: Partial<
    Omit<QueueItem, "status" | "resolution" | "firstSeenAt" | "lastSeenAt" | "occurrenceCount">
  > = {},
): ScannerResult["items"][number] {
  return {
    id: "id-1",
    scanner: "knip",
    kind: "dead-export",
    severity: "medium",
    score: 0,
    title: "Unused export",
    file: "src/foo.ts",
    line: 1,
    symbol: "foo",
    ...overrides,
  };
}

describe("queueFilePath", () => {
  it("rejects relative paths", () => {
    expect(() => queueFilePath("relative/path")).toThrow();
  });

  it("returns <repoPath>/.code-health/queue.json", () => {
    const path = queueFilePath("/abs/path");
    expect(path).toBe("/abs/path/.code-health/queue.json");
  });
});

describe("read/writeQueue", () => {
  it("readQueue returns a fresh queue when no file exists", async () => {
    const dir = tmpRepo();
    try {
      const q = await readQueue(dir);
      expect(q.version).toBe(1);
      expect(q.items).toEqual([]);
      expect(q.lastScannedAt).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("write then read round-trips the queue", async () => {
    const dir = tmpRepo();
    try {
      const initial = newQueue();
      await writeQueue(dir, initial);
      const reloaded = await readQueue(dir);
      expect(reloaded).toEqual(initial);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("throws PARSE_FAILED on malformed JSON", async () => {
    const dir = tmpRepo();
    try {
      await Bun.write(queueFilePath(dir), "{not json");
      await expect(readQueue(dir)).rejects.toThrow(/JSON/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("mergeScanResult", () => {
  const now = new Date("2026-04-01T00:00:00.000Z");

  it("adds new items as open with occurrenceCount=1", () => {
    const result: ScannerResult = {
      scanner: "knip",
      items: [scanItem()],
      durationMs: 100,
    };
    const merged = mergeScanResult(newQueue(), result, { now });
    expect(merged.added).toBe(1);
    expect(merged.reseen).toBe(0);
    expect(merged.queue.items).toHaveLength(1);
    const it = merged.queue.items[0];
    expect(it?.status).toBe("open");
    expect(it?.occurrenceCount).toBe(1);
    expect(it?.firstSeenAt).toBe(now.toISOString());
  });

  it("re-seen open items increment occurrenceCount", () => {
    const result: ScannerResult = {
      scanner: "knip",
      items: [scanItem()],
      durationMs: 100,
    };
    const first = mergeScanResult(newQueue(), result, { now });
    const second = mergeScanResult(first.queue, result, {
      now: new Date("2026-04-02T00:00:00.000Z"),
    });
    expect(second.added).toBe(0);
    expect(second.reseen).toBe(1);
    expect(second.queue.items[0]?.occurrenceCount).toBe(2);
    expect(second.queue.items[0]?.firstSeenAt).toBe(now.toISOString());
  });

  it("does not increment occurrenceCount or revive resolved items", () => {
    const result: ScannerResult = {
      scanner: "knip",
      items: [scanItem()],
      durationMs: 100,
    };
    const first = mergeScanResult(newQueue(), result, { now });
    const id = first.queue.items[0]?.id ?? "";
    const resolved = setItemStatus(first.queue, id, "resolved", { note: "fixed" }, now);
    const second = mergeScanResult(resolved, result, {
      now: new Date("2026-04-02T00:00:00.000Z"),
    });
    const itemAfter = second.queue.items[0];
    expect(itemAfter?.status).toBe("resolved");
    expect(itemAfter?.occurrenceCount).toBe(1);
  });

  it("preserves items not seen in this scan (does not delete)", () => {
    const initial = mergeScanResult(
      newQueue(),
      { scanner: "knip", items: [scanItem({ id: "a" }), scanItem({ id: "b" })], durationMs: 1 },
      { now },
    );
    const second = mergeScanResult(
      initial.queue,
      { scanner: "knip", items: [scanItem({ id: "a" })], durationMs: 1 },
      { now: new Date("2026-04-02T00:00:00.000Z") },
    );
    expect(second.queue.items.map((it) => it.id).sort()).toEqual(["a", "b"]);
  });

  it("appends a scan record (newest first) and caps at 50", () => {
    let queue = newQueue();
    for (let i = 0; i < 55; i += 1) {
      const r = mergeScanResult(
        queue,
        { scanner: "knip", items: [], durationMs: i },
        { now: new Date(`2026-04-${String((i % 28) + 1).padStart(2, "0")}T00:00:00.000Z`) },
      );
      queue = r.queue;
    }
    expect(queue.scans.length).toBe(50);
  });
});

describe("findItem / setItemStatus", () => {
  it("findItem returns the item by id", () => {
    const merged = mergeScanResult(
      newQueue(),
      { scanner: "knip", items: [scanItem()], durationMs: 1 },
      { now: new Date() },
    );
    expect(findItem(merged.queue, "id-1")?.id).toBe("id-1");
    expect(findItem(merged.queue, "missing")).toBeUndefined();
  });

  it("setItemStatus records resolution metadata", () => {
    const merged = mergeScanResult(
      newQueue(),
      { scanner: "knip", items: [scanItem()], durationMs: 1 },
      { now: new Date() },
    );
    const at = new Date("2026-04-10T00:00:00.000Z");
    const updated = setItemStatus(
      merged.queue,
      "id-1",
      "resolved",
      { prUrl: "https://x/pr/1", note: "fixed" },
      at,
    );
    const it = findItem(updated, "id-1");
    expect(it?.status).toBe("resolved");
    expect(it?.resolution?.prUrl).toBe("https://x/pr/1");
    expect(it?.resolution?.note).toBe("fixed");
    expect(it?.resolution?.at).toBe(at.toISOString());
  });
});
