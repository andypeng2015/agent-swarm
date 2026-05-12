import type { QueueItem, Scanner, Severity } from "./types";

const SEVERITY_BASE: Record<Severity, number> = {
  critical: 100,
  high: 70,
  medium: 40,
  low: 15,
};

// knip dead-export is the primary MVP metric → slight boost over desloppify
const SCANNER_WEIGHT: Record<Scanner, number> = {
  knip: 1.3,
  desloppify: 1.0,
};

const RECURRENCE_BONUS_PER_OCCURRENCE = 5;
const RECURRENCE_BONUS_CAP = 25;

const AGE_BONUS_PER_DAY = 1;
const AGE_BONUS_CAP = 30;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export interface ScoreInput {
  scanner: Scanner;
  severity: Severity;
  occurrenceCount: number;
  firstSeenAt: string;
  status: QueueItem["status"];
  now?: Date;
}

/**
 * Compute the priority score for a queue item.
 *
 * Higher = more urgent. Resolved/deferred/wontfix items get a 0 score so they
 * stay out of `next()` and the top of `backlog()` even if rescored.
 *
 * Formula = severityBase * scannerWeight + recurrenceBonus + ageBonus
 * - severityBase: 15..100
 * - scannerWeight: knip 1.3, desloppify 1.0 (knip dead-export is the primary MVP metric)
 * - recurrenceBonus: 5 per occurrence beyond the first, capped at 25
 * - ageBonus: 1 per day since firstSeenAt, capped at 30 (older = more urgent)
 *
 * Documented as replaceable: post-merge the Code-Health Agent will call
 * `rescore()` which feeds this function — adjust weights here, not at callers.
 */
export function computeScore(input: ScoreInput): number {
  if (input.status !== "open") return 0;

  const base = SEVERITY_BASE[input.severity];
  const weight = SCANNER_WEIGHT[input.scanner];

  const occurrenceBonus = Math.min(
    Math.max(0, input.occurrenceCount - 1) * RECURRENCE_BONUS_PER_OCCURRENCE,
    RECURRENCE_BONUS_CAP,
  );

  const now = input.now ?? new Date();
  const ageMs = now.getTime() - new Date(input.firstSeenAt).getTime();
  const ageDays = Math.max(0, Math.floor(ageMs / MS_PER_DAY));
  const ageBonus = Math.min(ageDays * AGE_BONUS_PER_DAY, AGE_BONUS_CAP);

  return Math.round(base * weight + occurrenceBonus + ageBonus);
}

/** Returns a new QueueItem with `.score` recomputed from current fields. */
export function rescoreItem(item: QueueItem, now: Date = new Date()): QueueItem {
  return {
    ...item,
    score: computeScore({
      scanner: item.scanner,
      severity: item.severity,
      occurrenceCount: item.occurrenceCount,
      firstSeenAt: item.firstSeenAt,
      status: item.status,
      now,
    }),
  };
}

/** Sorts open items by score (desc), then by firstSeenAt (asc — older first). */
export function compareForBacklog(a: QueueItem, b: QueueItem): number {
  if (a.status === "open" && b.status !== "open") return -1;
  if (b.status === "open" && a.status !== "open") return 1;
  if (b.score !== a.score) return b.score - a.score;
  return a.firstSeenAt.localeCompare(b.firstSeenAt);
}
