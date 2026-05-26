import type { ProviderName } from "../types";

export type ResumeSessionSource = "task" | "parent";

export interface ResumeSessionCandidate {
  source: ResumeSessionSource;
  sessionId?: string | null;
  taskId?: string;
  provider?: ProviderName;
  providerMeta?: Record<string, unknown>;
}

export interface ResumeSessionSkip {
  source: ResumeSessionSource;
  sessionId: string;
  provider?: ProviderName;
  reason: string;
}

export interface ResumeSessionResolution {
  resumeSessionId?: string;
  source?: ResumeSessionSource;
  provider?: ProviderName;
  skipped: ResumeSessionSkip[];
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const RESUMABLE_PROVIDERS = new Set<ProviderName>(["claude", "claude-managed", "codex"]);

export function isClaudeCliSessionId(sessionId: string): boolean {
  return UUID_RE.test(sessionId);
}

function normalizeStoredProvider(candidate: ResumeSessionCandidate): ProviderName | undefined {
  if (candidate.provider === "claude" && candidate.providerMeta?.managed === true) {
    return "claude-managed";
  }
  return candidate.provider;
}

function providerSupportsResume(provider: ProviderName): boolean {
  return RESUMABLE_PROVIDERS.has(provider);
}

export function resolveResumeSession(
  currentProvider: ProviderName,
  candidates: ResumeSessionCandidate[],
): ResumeSessionResolution {
  const skipped: ResumeSessionSkip[] = [];

  for (const candidate of candidates) {
    const sessionId = candidate.sessionId?.trim();
    if (!sessionId) continue;

    const storedProvider = normalizeStoredProvider(candidate);

    if (!storedProvider) {
      if (currentProvider === "claude" && isClaudeCliSessionId(sessionId)) {
        return {
          resumeSessionId: sessionId,
          source: candidate.source,
          provider: "claude",
          skipped,
        };
      }

      skipped.push({
        source: candidate.source,
        sessionId,
        reason:
          currentProvider === "claude"
            ? "legacy Claude resume requires a UUID session id"
            : "stored session provider is unknown",
      });
      continue;
    }

    if (storedProvider !== currentProvider) {
      skipped.push({
        source: candidate.source,
        sessionId,
        provider: storedProvider,
        reason: `stored session provider ${storedProvider} does not match current provider ${currentProvider}`,
      });
      continue;
    }

    if (!providerSupportsResume(currentProvider)) {
      skipped.push({
        source: candidate.source,
        sessionId,
        provider: storedProvider,
        reason: `provider ${currentProvider} does not support runner resume`,
      });
      continue;
    }

    if (currentProvider === "claude" && !isClaudeCliSessionId(sessionId)) {
      skipped.push({
        source: candidate.source,
        sessionId,
        provider: storedProvider,
        reason: "Claude CLI --resume requires a UUID session id",
      });
      continue;
    }

    return {
      resumeSessionId: sessionId,
      source: candidate.source,
      provider: storedProvider,
      skipped,
    };
  }

  return { skipped };
}
