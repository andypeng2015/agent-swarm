import * as z from "zod";

export const SCANNERS = ["desloppify", "knip"] as const;
export type Scanner = (typeof SCANNERS)[number];
export const ScannerSchema = z.enum(SCANNERS);

export const ITEM_STATUSES = ["open", "resolved", "deferred", "wontfix"] as const;
export type ItemStatus = (typeof ITEM_STATUSES)[number];
export const ItemStatusSchema = z.enum(ITEM_STATUSES);

export const SEVERITIES = ["low", "medium", "high", "critical"] as const;
export type Severity = (typeof SEVERITIES)[number];
export const SeveritySchema = z.enum(SEVERITIES);

export const ResolutionSchema = z.object({
  at: z.string(),
  prUrl: z.string().nullable(),
  note: z.string().nullable(),
});
export type Resolution = z.infer<typeof ResolutionSchema>;

export const QueueItemSchema = z.object({
  id: z.string(),
  scanner: ScannerSchema,
  kind: z.string(),
  severity: SeveritySchema,
  score: z.number(),
  title: z.string(),
  file: z.string().nullable(),
  line: z.number().nullable(),
  symbol: z.string().nullable(),
  status: ItemStatusSchema,
  resolution: ResolutionSchema.nullable(),
  firstSeenAt: z.string(),
  lastSeenAt: z.string(),
  occurrenceCount: z.number().int().min(1),
  details: z.record(z.string(), z.unknown()).optional(),
});
export type QueueItem = z.infer<typeof QueueItemSchema>;

export const ScanRecordSchema = z.object({
  scanner: ScannerSchema,
  at: z.string(),
  itemsFound: z.number().int().min(0),
  durationMs: z.number().int().min(0),
});
export type ScanRecord = z.infer<typeof ScanRecordSchema>;

export const QueueSchema = z.object({
  version: z.literal(1),
  lastScannedAt: z.string().nullable(),
  scans: z.array(ScanRecordSchema),
  items: z.array(QueueItemSchema),
});
export type Queue = z.infer<typeof QueueSchema>;

export const QUEUE_DIR = ".code-health";
export const QUEUE_FILE = "queue.json";

export interface ScannerResult {
  scanner: Scanner;
  items: Array<
    Omit<
      QueueItem,
      "status" | "resolution" | "firstSeenAt" | "lastSeenAt" | "occurrenceCount" | "score"
    >
  >;
  durationMs: number;
}
