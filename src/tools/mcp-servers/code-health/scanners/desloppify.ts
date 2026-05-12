import { createHash } from "node:crypto";
import { isAbsolute } from "node:path";
import type { ScannerResult, Severity } from "../types";

interface DesloppifyRawItem {
  // desloppify's exact JSON schema isn't documented; we parse defensively
  // and accept any of these common field names.
  id?: string;
  identifier?: string;
  type?: string;
  kind?: string;
  category?: string;
  dimension?: string;
  title?: string;
  summary?: string;
  message?: string;
  file?: string;
  path?: string;
  related_files?: string[];
  files?: string[];
  line?: number;
  severity?: string;
  level?: string;
  priority?: string | number;
  score?: number;
  confidence?: string;
  status?: string;
  [key: string]: unknown;
}

function stableId(parts: Array<string | number | null | undefined>): string {
  const joined = parts.map((p) => (p == null ? "" : String(p))).join("|");
  return createHash("sha1").update(joined).digest("hex").slice(0, 16);
}

const SEVERITY_TOKENS: Record<string, Severity> = {
  critical: "critical",
  blocker: "critical",
  fatal: "critical",
  high: "high",
  error: "high",
  major: "high",
  medium: "medium",
  warning: "medium",
  warn: "medium",
  minor: "medium",
  moderate: "medium",
  low: "low",
  info: "low",
  hint: "low",
  trivial: "low",
};

function normalizeSeverity(raw: DesloppifyRawItem): Severity {
  const candidates = [raw.severity, raw.level, raw.priority, raw.confidence]
    .filter((v): v is string => typeof v === "string")
    .map((v) => v.toLowerCase());

  for (const c of candidates) {
    if (SEVERITY_TOKENS[c]) return SEVERITY_TOKENS[c];
  }

  // Numeric priority/score: heuristic mapping
  const numeric = typeof raw.priority === "number" ? raw.priority : raw.score;
  if (typeof numeric === "number") {
    if (numeric >= 80) return "critical";
    if (numeric >= 60) return "high";
    if (numeric >= 30) return "medium";
    return "low";
  }

  return "medium";
}

function deriveKind(raw: DesloppifyRawItem): string {
  // desloppify identifiers look like "unused_import::src/foo.py::3" — type prefix.
  if (typeof raw.identifier === "string" && raw.identifier.includes("::")) {
    const [head] = raw.identifier.split("::");
    if (head) return head;
  }
  return raw.type ?? raw.kind ?? raw.category ?? raw.dimension ?? "issue";
}

function deriveFile(raw: DesloppifyRawItem): string | null {
  if (typeof raw.file === "string") return raw.file;
  if (typeof raw.path === "string") return raw.path;
  if (Array.isArray(raw.related_files) && raw.related_files.length > 0) {
    return raw.related_files[0] ?? null;
  }
  if (Array.isArray(raw.files) && raw.files.length > 0) {
    return raw.files[0] ?? null;
  }
  // identifier-encoded file: "unused_import::src/foo.py::3"
  if (typeof raw.identifier === "string" && raw.identifier.includes("::")) {
    const parts = raw.identifier.split("::");
    if (parts.length >= 2 && parts[1]) return parts[1];
  }
  return null;
}

function deriveLine(raw: DesloppifyRawItem): number | null {
  if (typeof raw.line === "number" && Number.isFinite(raw.line)) return raw.line;
  if (typeof raw.identifier === "string" && raw.identifier.includes("::")) {
    const parts = raw.identifier.split("::");
    const last = parts[parts.length - 1];
    if (last) {
      const n = Number(last);
      if (Number.isFinite(n)) return n;
    }
  }
  return null;
}

function deriveTitle(raw: DesloppifyRawItem, kind: string, file: string | null): string {
  return raw.title ?? raw.summary ?? raw.message ?? `${kind}${file ? ` in ${file}` : ""}`;
}

/**
 * Parse desloppify's JSON output into scanner items. The exact JSON schema
 * isn't formally specified, so we accept either:
 *   - { items: [...] }  (work-queue shape)
 *   - { findings: [...] }  (review shape)
 *   - [...]  (bare array)
 *
 * Each entry is mapped defensively — unknown fields are dropped into details.
 * Pure function — exposed for tests.
 */
export function parseDesloppifyOutput(parsed: unknown): ScannerResult["items"] {
  const candidates: DesloppifyRawItem[] = [];

  if (Array.isArray(parsed)) {
    candidates.push(...(parsed as DesloppifyRawItem[]));
  } else if (parsed && typeof parsed === "object") {
    const obj = parsed as Record<string, unknown>;
    for (const key of ["items", "findings", "issues", "queue", "results"]) {
      if (Array.isArray(obj[key])) {
        candidates.push(...(obj[key] as DesloppifyRawItem[]));
        break;
      }
    }
  }

  const items: ScannerResult["items"] = [];
  for (const raw of candidates) {
    // Skip already-resolved items so we don't import them back as open.
    if (typeof raw.status === "string" && raw.status !== "open" && raw.status !== "queued") {
      continue;
    }

    const kind = deriveKind(raw);
    const file = deriveFile(raw);
    const line = deriveLine(raw);
    const severity = normalizeSeverity(raw);
    const title = deriveTitle(raw, kind, file);
    const explicitId = raw.id ?? raw.identifier;

    const id =
      typeof explicitId === "string" && explicitId.length > 0
        ? stableId(["desloppify", explicitId])
        : stableId(["desloppify", kind, file, line]);

    items.push({
      id,
      scanner: "desloppify",
      kind,
      severity,
      title,
      file,
      line,
      symbol: null,
      details: { source: raw },
    });
  }

  return items;
}

export interface DesloppifyRunner {
  scan(repoPath: string): Promise<{ exitCode: number; durationMs: number; stderr: string }>;
  backlog(
    repoPath: string,
  ): Promise<{ stdout: string; exitCode: number; durationMs: number; stderr: string }>;
}

export const defaultDesloppifyRunner: DesloppifyRunner = {
  async scan(repoPath) {
    const started = performance.now();
    const proc = Bun.spawn(["desloppify", "scan", "--path", "."], {
      cwd: repoPath,
      stdout: "pipe",
      stderr: "pipe",
    });
    const stderr = await new Response(proc.stderr).text();
    const exitCode = await proc.exited;
    return { exitCode, durationMs: Math.round(performance.now() - started), stderr };
  },
  async backlog(repoPath) {
    const started = performance.now();
    const proc = Bun.spawn(["desloppify", "backlog", "--format", "json", "--count", "1000"], {
      cwd: repoPath,
      stdout: "pipe",
      stderr: "pipe",
    });
    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();
    const exitCode = await proc.exited;
    return { stdout, stderr, exitCode, durationMs: Math.round(performance.now() - started) };
  },
};

export async function runDesloppify(
  repoPath: string,
  runner: DesloppifyRunner = defaultDesloppifyRunner,
): Promise<ScannerResult> {
  if (!isAbsolute(repoPath)) {
    throw new Error(`runDesloppify: repoPath must be absolute (got "${repoPath}")`);
  }

  const scanResult = await runner.scan(repoPath);
  if (scanResult.exitCode !== 0 && scanResult.exitCode !== 1) {
    throw new Error(
      `desloppify scan failed with exit code ${scanResult.exitCode}: ${scanResult.stderr.slice(0, 500)}`,
    );
  }

  const backlogResult = await runner.backlog(repoPath);
  if (backlogResult.exitCode !== 0 && backlogResult.exitCode !== 1) {
    throw new Error(
      `desloppify backlog failed with exit code ${backlogResult.exitCode}: ${backlogResult.stderr.slice(0, 500)}`,
    );
  }

  if (!backlogResult.stdout.trim()) {
    return {
      scanner: "desloppify",
      items: [],
      durationMs: scanResult.durationMs + backlogResult.durationMs,
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(backlogResult.stdout);
  } catch (err) {
    throw new Error(`Failed to parse desloppify JSON output: ${(err as Error).message}`);
  }

  return {
    scanner: "desloppify",
    items: parseDesloppifyOutput(parsed),
    durationMs: scanResult.durationMs + backlogResult.durationMs,
  };
}
