#!/usr/bin/env bun
/**
 * One-shot backfill: redact resolved secrets from historical
 * `workflow_run_steps.input` rows.
 *
 * Background — PR #501 closes the leak going forward: the engine now writes a
 * redacted clone of `ctx` to `workflow_run_steps.input` for every new step
 * (`secret.*` and sensitive `${ENV}` references become `***REDACTED***`).
 * Historical rows persisted BEFORE that fix still contain raw tokens
 * (TURSO_DB_TOKEN, AGENT_FS_API_KEY, IMGFLIP_PASSWORD, GITHUB_TOKEN, …).
 * This script rewrites those rows so they match the new write-time behaviour.
 *
 * Strategy — hybrid:
 *   1. Definition-based: for each step, look up its run's workflow and call
 *      `getSecretInputKeys(workflow.input)`. Redact `ctx.input[k]` for every
 *      flagged k. This is the source of truth and matches PR #501 exactly.
 *   2. Pattern-based fallback: workflow definitions can change between runs
 *      and now. To cover keys that were sensitive at run-time but no longer
 *      appear in `workflow.input`, ALSO redact any `ctx.input[k]` where either
 *        - `isSensitiveKey(k)` is true (suffix/exact heuristic from
 *          secret-scrubber.ts), OR
 *        - the string value matches one of the well-known credential regexes
 *          (GitHub PATs, JWTs, sk-…, glpat-…, etc.).
 *      Already-redacted values are left alone — re-running the script is a
 *      no-op.
 *
 * Modes:
 *   --commit   apply the UPDATEs inside a single transaction.
 *   (default)  dry run: count affected rows, print 3 sample before/after
 *              diffs, mutate nothing.
 *
 * Flags:
 *   --db <path>      path to the sqlite file (default: ./agent-swarm-db.sqlite
 *                    or $DATABASE_PATH).
 *   --verbose        print every row-level change in dry-run mode.
 *   --sample N       number of sample diffs to print (default: 3).
 *
 * Usage:
 *   bun run scripts/backfill-redact-workflow-run-steps.ts
 *   bun run scripts/backfill-redact-workflow-run-steps.ts --commit
 *   DATABASE_PATH=/path/to/prod.sqlite bun run scripts/backfill-redact-workflow-run-steps.ts --commit
 */

import { getDb } from "../src/be/db";
import { getSecretInputKeys, REDACTED_SECRET_VALUE } from "../src/workflows/input";
import { isSensitiveKey } from "../src/utils/secret-scrubber";

// ---------------------------------------------------------------------------
// CLI parsing
// ---------------------------------------------------------------------------

interface CliArgs {
  commit: boolean;
  verbose: boolean;
  sample: number;
  dbPath?: string;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { commit: false, verbose: false, sample: 3 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--commit") args.commit = true;
    else if (a === "--verbose") args.verbose = true;
    else if (a === "--sample") {
      const n = Number(argv[++i]);
      if (!Number.isFinite(n) || n < 0) throw new Error(`invalid --sample value: ${argv[i]}`);
      args.sample = n;
    } else if (a === "--db") {
      args.dbPath = argv[++i];
      if (!args.dbPath) throw new Error("--db requires a path argument");
    } else if (a === "--help" || a === "-h") {
      console.log(
        "Usage: bun run scripts/backfill-redact-workflow-run-steps.ts [--commit] [--verbose] [--sample N] [--db PATH]",
      );
      process.exit(0);
    } else {
      throw new Error(`unknown flag: ${a}`);
    }
  }
  return args;
}

// ---------------------------------------------------------------------------
// Token-shape patterns (mirror of secret-scrubber.ts TOKEN_REGEXES but bound
// to whole-value matching — we only redact when the entire input value looks
// like a credential, not when it's prose that happens to contain one).
// ---------------------------------------------------------------------------

const VALUE_LOOKS_LIKE_SECRET: ReadonlyArray<RegExp> = [
  /^github_pat_[A-Za-z0-9_]{20,}$/,
  /^gh[pousr]_[A-Za-z0-9]{20,}$/,
  /^glpat-[A-Za-z0-9_-]{20,}$/,
  /^sk-ant-[A-Za-z0-9_-]{20,}$/,
  /^sk-proj-[A-Za-z0-9_-]{20,}$/,
  /^sk-or-(?:v1-)?[A-Za-z0-9_-]{20,}$/,
  /^sk-[A-Za-z0-9]{20,}$/,
  /^xox[baprseo]-[A-Za-z0-9-]{10,}$/,
  /^AKIA[0-9A-Z]{16}$/,
  /^AIza[A-Za-z0-9_-]{35}$/,
  /^eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}$/, // JWT
];

function valueLooksLikeSecret(value: unknown): boolean {
  if (typeof value !== "string") return false;
  if (value === REDACTED_SECRET_VALUE) return false;
  for (const re of VALUE_LOOKS_LIKE_SECRET) {
    if (re.test(value)) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Redaction
// ---------------------------------------------------------------------------

/**
 * Returns a redacted clone of the parsed step.input ctx, plus the number of
 * keys actually changed. If `changed === 0` the input is structurally
 * identical and we skip the UPDATE.
 *
 * `workflowInput` may be undefined (workflow deleted or row corrupted) — in
 * that case we fall back to pattern-only matching.
 */
function redactStepInput(
  parsed: unknown,
  workflowInput: Record<string, string> | undefined,
): { redacted: unknown; changed: number; redactedKeys: string[] } {
  if (!parsed || typeof parsed !== "object") {
    return { redacted: parsed, changed: 0, redactedKeys: [] };
  }
  const ctx = parsed as Record<string, unknown>;
  const inputBlock = ctx.input;
  if (!inputBlock || typeof inputBlock !== "object") {
    return { redacted: parsed, changed: 0, redactedKeys: [] };
  }

  const definitionKeys = workflowInput
    ? getSecretInputKeys(workflowInput)
    : new Set<string>();

  const original = inputBlock as Record<string, unknown>;
  const cloned: Record<string, unknown> = { ...original };
  const redactedKeys: string[] = [];

  for (const [k, v] of Object.entries(original)) {
    if (v === REDACTED_SECRET_VALUE) continue; // already redacted, idempotent
    const shouldRedact =
      definitionKeys.has(k) || isSensitiveKey(k) || valueLooksLikeSecret(v);
    if (shouldRedact) {
      cloned[k] = REDACTED_SECRET_VALUE;
      redactedKeys.push(k);
    }
  }

  if (redactedKeys.length === 0) {
    return { redacted: parsed, changed: 0, redactedKeys: [] };
  }

  return {
    redacted: { ...ctx, input: cloned },
    changed: redactedKeys.length,
    redactedKeys,
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

interface StepRow {
  id: string;
  runId: string;
  nodeId: string;
  input: string | null;
  workflowId: string | null;
  workflowInput: string | null;
}

interface PendingUpdate {
  id: string;
  runId: string;
  nodeId: string;
  before: string;
  after: string;
  redactedKeys: string[];
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  if (args.dbPath) process.env.DATABASE_PATH = args.dbPath;

  const db = getDb();
  const start = Date.now();

  console.log(
    `[backfill] mode=${args.commit ? "COMMIT" : "DRY-RUN"} db=${args.dbPath ?? process.env.DATABASE_PATH ?? "./agent-swarm-db.sqlite"}`,
  );

  // Pull every step row joined with its workflow's current input definition.
  // LEFT JOIN so steps whose workflow has been deleted still appear and fall
  // back to pattern-only redaction.
  const rows = db
    .prepare<StepRow, []>(
      `SELECT s.id, s.runId, s.nodeId, s.input, r.workflowId, w.input AS workflowInput
       FROM workflow_run_steps s
       JOIN workflow_runs r ON r.id = s.runId
       LEFT JOIN workflows w ON w.id = r.workflowId
       WHERE s.input IS NOT NULL`,
    )
    .all();

  console.log(`[backfill] scanned ${rows.length} workflow_run_steps rows with non-null input`);

  const pending: PendingUpdate[] = [];
  let totalKeysRedacted = 0;
  let parseFailures = 0;

  for (const row of rows) {
    if (!row.input) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(row.input);
    } catch (err) {
      parseFailures++;
      console.warn(`[backfill] WARN skip row ${row.id} — invalid JSON: ${(err as Error).message}`);
      continue;
    }

    let workflowInput: Record<string, string> | undefined;
    if (row.workflowInput) {
      try {
        const parsedWorkflowInput = JSON.parse(row.workflowInput);
        if (parsedWorkflowInput && typeof parsedWorkflowInput === "object") {
          // Filter to string-valued entries only — getSecretInputKeys ignores
          // non-strings, but typing wants Record<string, string>.
          const filtered: Record<string, string> = {};
          for (const [k, v] of Object.entries(parsedWorkflowInput)) {
            if (typeof v === "string") filtered[k] = v;
          }
          workflowInput = filtered;
        }
      } catch {
        // ignore — fall back to pattern-only
      }
    }

    const { redacted, changed, redactedKeys } = redactStepInput(parsed, workflowInput);
    if (changed === 0) continue;

    const before = row.input;
    const after = JSON.stringify(redacted);
    if (before === after) continue; // belt-and-suspenders: byte-equal => no UPDATE

    pending.push({ id: row.id, runId: row.runId, nodeId: row.nodeId, before, after, redactedKeys });
    totalKeysRedacted += changed;
  }

  console.log(
    `[backfill] ${pending.length} rows would change, ${totalKeysRedacted} secret keys total` +
      (parseFailures > 0 ? `, ${parseFailures} parse-failure rows skipped` : ""),
  );

  // Sample diffs
  const sampleN = Math.min(args.sample, pending.length);
  for (let i = 0; i < sampleN; i++) {
    const p = pending[i];
    if (!p) continue;
    console.log("\n────────────────────────────────────────────────");
    console.log(`SAMPLE ${i + 1}/${sampleN}  step=${p.id}  run=${p.runId}  node=${p.nodeId}`);
    console.log(`  redacted keys: ${p.redactedKeys.join(", ")}`);
    console.log("  BEFORE.input:", extractInputBlock(p.before));
    console.log("  AFTER.input :", extractInputBlock(p.after));
  }
  if (args.verbose) {
    console.log("\n[backfill] --verbose: full row list:");
    for (const p of pending) {
      console.log(
        `  step=${p.id} run=${p.runId} node=${p.nodeId} keys=[${p.redactedKeys.join(", ")}]`,
      );
    }
  }

  if (!args.commit) {
    console.log(
      `\n[backfill] dry-run complete (no writes). Re-run with --commit to apply. elapsed=${Date.now() - start}ms`,
    );
    process.exit(0);
  }

  // Commit mode — single transaction
  console.log(`\n[backfill] COMMIT: applying ${pending.length} UPDATEs in one transaction...`);
  const updateStmt = db.prepare<unknown, [string, string]>(
    "UPDATE workflow_run_steps SET input = ? WHERE id = ?",
  );
  let applied = 0;
  db.transaction(() => {
    for (const p of pending) {
      updateStmt.run(p.after, p.id);
      applied++;
    }
  })();

  console.log(`[backfill] COMMIT done: ${applied} rows updated. elapsed=${Date.now() - start}ms`);
}

/**
 * Pull just the `input` block out of a serialized ctx string for sample
 * printing. Keeps the diff readable when ctx has large `outputs` blobs.
 */
function extractInputBlock(serialized: string): string {
  try {
    const parsed = JSON.parse(serialized) as Record<string, unknown>;
    const block = parsed.input;
    return block ? JSON.stringify(block) : "<no input block>";
  } catch {
    return "<unparseable>";
  }
}

// Allow this module to be imported by tests (`import.meta.main` is false when
// the file is loaded via `import` rather than `bun run`). Avoids racing the
// DB open against a test that wants to inject its own DATABASE_PATH.
if (import.meta.main) {
  main();
}

// Re-exports for unit tests.
export { redactStepInput, valueLooksLikeSecret };
