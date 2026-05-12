import { describe, expect, it } from "bun:test";
import {
  compareForBacklog,
  computeScore,
  rescoreItem,
} from "../tools/mcp-servers/code-health/scoring";
import type { QueueItem } from "../tools/mcp-servers/code-health/types";

const baseItem = (overrides: Partial<QueueItem> = {}): QueueItem => ({
  id: "abc",
  scanner: "knip",
  kind: "dead-export",
  severity: "medium",
  score: 0,
  title: "Unused export: foo",
  file: "src/foo.ts",
  line: 12,
  symbol: "foo",
  status: "open",
  resolution: null,
  firstSeenAt: "2026-04-01T00:00:00.000Z",
  lastSeenAt: "2026-04-01T00:00:00.000Z",
  occurrenceCount: 1,
  ...overrides,
});

describe("computeScore", () => {
  it("scores zero for resolved items", () => {
    expect(
      computeScore({
        scanner: "knip",
        severity: "critical",
        occurrenceCount: 1,
        firstSeenAt: "2026-04-01T00:00:00.000Z",
        status: "resolved",
        now: new Date("2026-04-01T00:00:00.000Z"),
      }),
    ).toBe(0);
  });

  it("knip critical > desloppify critical (primary metric weight)", () => {
    const now = new Date("2026-04-01T00:00:00.000Z");
    const knip = computeScore({
      scanner: "knip",
      severity: "critical",
      occurrenceCount: 1,
      firstSeenAt: "2026-04-01T00:00:00.000Z",
      status: "open",
      now,
    });
    const desl = computeScore({
      scanner: "desloppify",
      severity: "critical",
      occurrenceCount: 1,
      firstSeenAt: "2026-04-01T00:00:00.000Z",
      status: "open",
      now,
    });
    expect(knip).toBeGreaterThan(desl);
  });

  it("higher severity yields higher score", () => {
    const now = new Date("2026-04-01T00:00:00.000Z");
    const base = (severity: "low" | "medium" | "high" | "critical") =>
      computeScore({
        scanner: "knip",
        severity,
        occurrenceCount: 1,
        firstSeenAt: "2026-04-01T00:00:00.000Z",
        status: "open",
        now,
      });
    expect(base("critical")).toBeGreaterThan(base("high"));
    expect(base("high")).toBeGreaterThan(base("medium"));
    expect(base("medium")).toBeGreaterThan(base("low"));
  });

  it("recurrence boost caps after several scans", () => {
    const now = new Date("2026-04-01T00:00:00.000Z");
    const one = computeScore({
      scanner: "knip",
      severity: "medium",
      occurrenceCount: 1,
      firstSeenAt: "2026-04-01T00:00:00.000Z",
      status: "open",
      now,
    });
    const three = computeScore({
      scanner: "knip",
      severity: "medium",
      occurrenceCount: 3,
      firstSeenAt: "2026-04-01T00:00:00.000Z",
      status: "open",
      now,
    });
    const fifty = computeScore({
      scanner: "knip",
      severity: "medium",
      occurrenceCount: 50,
      firstSeenAt: "2026-04-01T00:00:00.000Z",
      status: "open",
      now,
    });
    expect(three).toBeGreaterThan(one);
    expect(fifty).toBeGreaterThan(three);
    // Cap means the marginal gain levels off
    expect(fifty - three).toBeLessThan(three - one + 25);
  });

  it("older items score higher (age bonus)", () => {
    const now = new Date("2026-04-10T00:00:00.000Z");
    const fresh = computeScore({
      scanner: "knip",
      severity: "medium",
      occurrenceCount: 1,
      firstSeenAt: "2026-04-09T00:00:00.000Z",
      status: "open",
      now,
    });
    const stale = computeScore({
      scanner: "knip",
      severity: "medium",
      occurrenceCount: 1,
      firstSeenAt: "2026-04-01T00:00:00.000Z",
      status: "open",
      now,
    });
    expect(stale).toBeGreaterThan(fresh);
  });
});

describe("rescoreItem", () => {
  it("recomputes score from current fields", () => {
    const now = new Date("2026-04-10T00:00:00.000Z");
    const rescored = rescoreItem(baseItem({ score: 0, occurrenceCount: 4 }), now);
    expect(rescored.score).toBeGreaterThan(0);
    expect(rescored.id).toBe("abc");
  });

  it("zeroes score for resolved items even if previously non-zero", () => {
    const rescored = rescoreItem(
      baseItem({
        score: 100,
        status: "resolved",
        resolution: { at: "x", prUrl: null, note: null },
      }),
    );
    expect(rescored.score).toBe(0);
  });
});

describe("compareForBacklog", () => {
  it("sorts open items before non-open", () => {
    const open = baseItem({ id: "a", score: 1 });
    const resolved = baseItem({
      id: "b",
      score: 100,
      status: "resolved",
      resolution: { at: "x", prUrl: null, note: null },
    });
    const sorted = [resolved, open].sort(compareForBacklog);
    expect(sorted[0]?.id).toBe("a");
  });

  it("sorts higher scores first within open items", () => {
    const low = baseItem({ id: "a", score: 10 });
    const high = baseItem({ id: "b", score: 100 });
    const sorted = [low, high].sort(compareForBacklog);
    expect(sorted[0]?.id).toBe("b");
  });
});
