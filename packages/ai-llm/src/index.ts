/**
 * Internal-AI: reusable structured-output LLM abstraction for both worker
 * subprocesses and the API server.
 *
 * Plan: thoughts/taras/plans/2026-05-10-fix-session-summarization-workers.md
 *
 * Worker-safe: uses fetch() only, no bun:sqlite import.
 *
 * Public surface:
 *   - `completeStructured<TZod>({...})` — context-agnostic lower layer.
 *   - `summarizeSession({...})` — worker-side session-end domain helper.
 *   - `resolveCredential({...})` — exposed for opencode-auth and tests.
 */

export {
  type CompleteStructuredOptions,
  completeStructured,
} from "./complete-structured";
export {
  type CredentialKind,
  DEFAULT_MODEL,
  type ResolveCredentialOptions,
  type ResolvedCredential,
  resolveCredential,
} from "./credentials";
export { parseModelStr, resolveModelString } from "./models";
export {
  type SummarizeSessionOptions,
  summarizeSession,
  summaryToolSchema,
} from "./summarize-session";
