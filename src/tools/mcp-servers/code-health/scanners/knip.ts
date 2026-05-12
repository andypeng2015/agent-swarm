import { createHash } from "node:crypto";
import { isAbsolute } from "node:path";
import type { ScannerResult, Severity } from "../types";

interface KnipPos {
  name: string;
  line?: number;
  col?: number;
  pos?: number;
  namespace?: string;
}

interface KnipIssueEntry {
  file: string;
  owners?: string[];
  files?: boolean;
  dependencies?: KnipPos[];
  devDependencies?: KnipPos[];
  optionalPeerDependencies?: KnipPos[];
  unlisted?: KnipPos[];
  unresolved?: KnipPos[];
  exports?: KnipPos[];
  types?: KnipPos[];
  nsExports?: KnipPos[];
  nsTypes?: KnipPos[];
  enumMembers?: KnipPos[];
  classMembers?: KnipPos[];
  duplicates?: Array<string | KnipPos>;
  binaries?: KnipPos[];
}

interface KnipReport {
  files?: string[];
  issues?: KnipIssueEntry[];
}

interface KindConfig {
  kind: string;
  severity: Severity;
  titleFor: (entry: KnipPos & { namespace?: string }) => string;
}

const KIND_CONFIG: Record<keyof Omit<KnipIssueEntry, "file" | "owners" | "files">, KindConfig> = {
  exports: {
    kind: "dead-export",
    severity: "medium",
    titleFor: (e) => `Unused export: ${e.name}`,
  },
  types: {
    kind: "dead-type",
    severity: "medium",
    titleFor: (e) => `Unused type: ${e.name}`,
  },
  nsExports: {
    kind: "dead-namespace-export",
    severity: "low",
    titleFor: (e) => `Unused namespace export: ${e.name}`,
  },
  nsTypes: {
    kind: "dead-namespace-type",
    severity: "low",
    titleFor: (e) => `Unused namespace type: ${e.name}`,
  },
  enumMembers: {
    kind: "dead-enum-member",
    severity: "low",
    titleFor: (e) => `Unused enum member: ${e.namespace ?? "?"}.${e.name}`,
  },
  classMembers: {
    kind: "dead-class-member",
    severity: "low",
    titleFor: (e) => `Unused class member: ${e.name}`,
  },
  duplicates: {
    kind: "duplicate-export",
    severity: "medium",
    titleFor: (e) => `Duplicate export: ${e.name}`,
  },
  dependencies: {
    kind: "unused-dependency",
    severity: "low",
    titleFor: (e) => `Unused dependency: ${e.name}`,
  },
  devDependencies: {
    kind: "unused-dev-dependency",
    severity: "low",
    titleFor: (e) => `Unused devDependency: ${e.name}`,
  },
  optionalPeerDependencies: {
    kind: "unused-optional-peer-dependency",
    severity: "low",
    titleFor: (e) => `Unused optional peer dependency: ${e.name}`,
  },
  unlisted: {
    kind: "unlisted-dependency",
    severity: "medium",
    titleFor: (e) => `Unlisted dependency: ${e.name}`,
  },
  unresolved: {
    kind: "unresolved-import",
    severity: "high",
    titleFor: (e) => `Unresolved import: ${e.name}`,
  },
  binaries: {
    kind: "unused-binary",
    severity: "low",
    titleFor: (e) => `Unused binary: ${e.name}`,
  },
};

function stableId(parts: Array<string | number | null | undefined>): string {
  const joined = parts.map((p) => (p == null ? "" : String(p))).join("|");
  return createHash("sha1").update(joined).digest("hex").slice(0, 16);
}

function normalizeDuplicate(d: string | KnipPos): KnipPos {
  return typeof d === "string" ? { name: d } : d;
}

/**
 * Parse a knip JSON report into scanner items. Pure function — exposed for tests.
 */
export function parseKnipReport(report: KnipReport): ScannerResult["items"] {
  const items: ScannerResult["items"] = [];

  if (Array.isArray(report.files)) {
    for (const file of report.files) {
      items.push({
        id: stableId(["knip", "unused-file", file]),
        scanner: "knip",
        kind: "unused-file",
        severity: "high",
        title: `Unused file: ${file}`,
        file,
        line: null,
        symbol: null,
      });
    }
  }

  for (const entry of report.issues ?? []) {
    // Some knip versions encode an unused file as `files: true` inside the issue.
    if (entry.files === true) {
      items.push({
        id: stableId(["knip", "unused-file", entry.file]),
        scanner: "knip",
        kind: "unused-file",
        severity: "high",
        title: `Unused file: ${entry.file}`,
        file: entry.file,
        line: null,
        symbol: null,
      });
    }

    for (const [field, config] of Object.entries(KIND_CONFIG)) {
      const rawList = entry[field as keyof typeof KIND_CONFIG];
      if (!Array.isArray(rawList) || rawList.length === 0) continue;

      const list =
        field === "duplicates" ? rawList.map(normalizeDuplicate) : (rawList as KnipPos[]);
      for (const pos of list) {
        items.push({
          id: stableId(["knip", config.kind, entry.file, pos.namespace ?? "", pos.name]),
          scanner: "knip",
          kind: config.kind,
          severity: config.severity,
          title: config.titleFor(pos),
          file: entry.file,
          line: pos.line ?? null,
          symbol: pos.name,
          details: pos.namespace ? { namespace: pos.namespace } : undefined,
        });
      }
    }
  }

  return items;
}

export type KnipRunner = (
  repoPath: string,
) => Promise<{ stdout: string; exitCode: number; durationMs: number }>;

export const defaultKnipRunner: KnipRunner = async (repoPath) => {
  const started = performance.now();
  // `bunx knip` works in any TS project; respects the repo's local knip config.
  const proc = Bun.spawn(["bunx", "knip", "--reporter", "json", "--no-progress"], {
    cwd: repoPath,
    stdout: "pipe",
    stderr: "pipe",
  });
  const stdout = await new Response(proc.stdout).text();
  const exitCode = await proc.exited;
  return { stdout, exitCode, durationMs: Math.round(performance.now() - started) };
};

export async function runKnip(
  repoPath: string,
  runner: KnipRunner = defaultKnipRunner,
): Promise<ScannerResult> {
  if (!isAbsolute(repoPath)) {
    throw new Error(`runKnip: repoPath must be absolute (got "${repoPath}")`);
  }

  const { stdout, exitCode, durationMs } = await runner(repoPath);

  // knip: 0 = clean, 1 = issues found, 2 = exception
  if (exitCode === 2) {
    throw new Error(`knip exited with code 2 (exception). stdout: ${stdout.slice(0, 500)}`);
  }

  if (!stdout.trim()) {
    return { scanner: "knip", items: [], durationMs };
  }

  let report: KnipReport;
  try {
    report = JSON.parse(stdout);
  } catch (err) {
    throw new Error(`Failed to parse knip JSON output: ${(err as Error).message}`);
  }

  return { scanner: "knip", items: parseKnipReport(report), durationMs };
}
