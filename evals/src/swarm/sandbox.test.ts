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

describe("workerRuntimeEnv v7 member env (§9.3 frozen merge order)", () => {
  test("identity envs map from the typed spec fields (TEMPLATE_ID / AGENT_NAME / SYSTEM_PROMPT)", () => {
    process.env.CLAUDE_CODE_OAUTH_TOKEN = "oauth-test";
    const env = workerRuntimeEnv({
      swarmKey: "k",
      apiUrl: "https://api.example",
      agentId: "agent-1",
      config: { id: "claude-haiku", provider: "claude", model: "haiku" },
      spec: { template: "coder", name: "scribe-a", systemPrompt: "Be terse." },
    });
    expect(env.TEMPLATE_ID).toBe("coder");
    expect(env.AGENT_NAME).toBe("scribe-a");
    expect(env.SYSTEM_PROMPT).toBe("Be terse.");
  });

  test("default member: no identity keys, AGENT_ROLE=worker, MAX_CONCURRENT_TASKS=1", () => {
    process.env.CLAUDE_CODE_OAUTH_TOKEN = "oauth-test";
    const env = workerEnvFor({ id: "claude-haiku", provider: "claude", model: "haiku" });
    expect(env.TEMPLATE_ID).toBeUndefined();
    expect(env.AGENT_NAME).toBeUndefined();
    expect(env.SYSTEM_PROMPT).toBeUndefined();
    expect(env.AGENT_ROLE).toBe("worker");
    expect(env.MAX_CONCURRENT_TASKS).toBe("1");
  });

  test("lead member: AGENT_ROLE=lead with the entrypoint's lead default MAX_CONCURRENT_TASKS=2", () => {
    process.env.CLAUDE_CODE_OAUTH_TOKEN = "oauth-test";
    const env = workerRuntimeEnv({
      swarmKey: "k",
      apiUrl: "https://api.example",
      agentId: "agent-lead",
      config: { id: "claude-sonnet", provider: "claude", model: "sonnet" },
      role: "lead",
      spec: { name: "coordinator" },
    });
    expect(env.AGENT_ROLE).toBe("lead");
    expect(env.MAX_CONCURRENT_TASKS).toBe("2");
    expect(env.AGENT_NAME).toBe("coordinator");
  });

  test("spec.env merges LAST (over config.env)", () => {
    process.env.CLAUDE_CODE_OAUTH_TOKEN = "oauth-test";
    const env = workerRuntimeEnv({
      swarmKey: "k",
      apiUrl: "https://api.example",
      agentId: "agent-1",
      config: {
        id: "claude-haiku",
        provider: "claude",
        model: "haiku",
        env: { EXTRA_FLAG: "from-config" },
      },
      spec: { env: { EXTRA_FLAG: "from-spec", MEMBER_ONLY: "1" } },
    });
    expect(env.EXTRA_FLAG).toBe("from-spec");
    expect(env.MEMBER_ONLY).toBe("1");
  });

  test("credential isolation follows the EFFECTIVE config (pi override on a claude host env)", () => {
    process.env.CLAUDE_CODE_OAUTH_TOKEN = "oauth-test";
    process.env.OPENROUTER_API_KEY = "or-test-key";
    // Member overridden to pi/openrouter: gets OPENROUTER_API_KEY, never the
    // claude OAuth token (claude creds in env win inside the harness).
    const env = workerRuntimeEnv({
      swarmKey: "k",
      apiUrl: "https://api.example",
      agentId: "agent-1",
      config: {
        id: "pi-deepseek-flash",
        provider: "pi",
        model: "openrouter/deepseek/deepseek-v4-flash",
      },
      spec: { configId: "pi-deepseek-flash" },
    });
    expect(env.HARNESS_PROVIDER).toBe("pi");
    expect(env.MODEL_OVERRIDE).toBe("openrouter/deepseek/deepseek-v4-flash");
    expect(env.OPENROUTER_API_KEY).toBe("or-test-key");
    expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBeUndefined();
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
