import { afterEach, describe, expect, test } from "bun:test";
import type { HarnessConfig } from "../types.ts";
import { apiRuntimeEnv, workerRuntimeEnv } from "./sandbox.ts";

const ENV_KEYS = ["OPENROUTER_API_KEY", "CLAUDE_CODE_OAUTH_TOKEN", "ANTHROPIC_API_KEY"] as const;
const saved: Record<string, string | undefined> = {};
for (const k of ENV_KEYS) saved[k] = process.env[k];

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

function workerEnvFor(config: HarnessConfig): Record<string, string> {
  return workerRuntimeEnv({
    swarmKey: "test-key",
    apiUrl: "https://api.example",
    agentId: "agent-1",
    config,
  });
}

describe("workerRuntimeEnv session-summary credential injection", () => {
  test("claude provider + OPENROUTER_API_KEY in controller env → injected (breaks the claude -p summarizer recursion on published templates)", () => {
    process.env.OPENROUTER_API_KEY = "or-test-key";
    process.env.CLAUDE_CODE_OAUTH_TOKEN = "oauth-test";
    const env = workerEnvFor({ id: "claude-haiku", provider: "claude", model: "haiku" });
    expect(env.OPENROUTER_API_KEY).toBe("or-test-key");
    // Harness credential gating unchanged: OAuth token still present.
    expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBe("oauth-test");
  });

  test("claude provider without OPENROUTER_API_KEY → no injection, OAuth-only env", () => {
    delete process.env.OPENROUTER_API_KEY;
    process.env.CLAUDE_CODE_OAUTH_TOKEN = "oauth-test";
    const env = workerEnvFor({ id: "claude-haiku", provider: "claude", model: "haiku" });
    expect(env.OPENROUTER_API_KEY).toBeUndefined();
  });

  test("non-claude provider with anthropic-prefixed model → OPENROUTER_API_KEY NOT injected (credential gating stays config-driven)", () => {
    process.env.OPENROUTER_API_KEY = "or-test-key";
    process.env.ANTHROPIC_API_KEY = "ant-test-key";
    const env = workerEnvFor({
      id: "pi-haiku",
      provider: "pi",
      model: "anthropic/claude-haiku-4-5",
    });
    expect(env.OPENROUTER_API_KEY).toBeUndefined();
    expect(env.ANTHROPIC_API_KEY).toBe("ant-test-key");
  });

  test("config.env wins over the injected key", () => {
    process.env.OPENROUTER_API_KEY = "or-test-key";
    process.env.CLAUDE_CODE_OAUTH_TOKEN = "oauth-test";
    const env = workerEnvFor({
      id: "claude-haiku",
      provider: "claude",
      model: "haiku",
      env: { OPENROUTER_API_KEY: "per-config-key" },
    });
    expect(env.OPENROUTER_API_KEY).toBe("per-config-key");
  });
});

describe("apiRuntimeEnv", () => {
  test("pins EMBEDDING_DIMENSIONS to the 512-dim vec0 column width", () => {
    // Published API templates ≤ v1.85.0 compute Number(undefined) ?? 512 = NaN
    // (NaN is not nullish) → 1536-dim embeddings → every memory index/search
    // fails with a dimension mismatch. The explicit pin keeps old AND new
    // templates correct.
    expect(apiRuntimeEnv("k").EMBEDDING_DIMENSIONS).toBe("512");
  });
});
