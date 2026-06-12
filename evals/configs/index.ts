import type { HarnessConfig } from "../src/types.ts";

/**
 * The harness-config axis of the eval matrix. Models are deliberately cheap:
 * evals measure orchestration capability across harnesses, not peak model
 * quality. (pi/opencode cross-provider runs use deepseek-v4-flash per the
 * standing repo convention.)
 *
 * Catalog contract (v6 §0.14, frozen):
 * - ids match /^(claude|pi|opencode|codex)-[a-z0-9][a-z0-9.-]*$/ — `<short>`
 *   drops the vendor path (deepseek-pro, not deepseek-deepseek-v4-pro).
 * - NO `env` blocks: provider creds are injected at boot exclusively by
 *   `credentialsForConfig` (src/swarm/sandbox.ts) — openrouter/-prefixed
 *   models get OPENROUTER_API_KEY only; never put a secret value here.
 * - `modelTier` stays unset: tier-resolved configs would grade a moving target.
 * - DEFAULT_CONFIG_IDS stays the curated trio regardless of catalog size.
 */
export const configs: HarnessConfig[] = [
  {
    id: "claude-haiku",
    label: "Claude Code / haiku",
    provider: "claude",
    model: "haiku",
  },
  {
    id: "claude-sonnet",
    label: "Claude Code / sonnet",
    provider: "claude",
    model: "sonnet",
  },
  {
    id: "claude-opus",
    label: "Claude Code / opus (latest)",
    provider: "claude",
    model: "opus",
  },
  {
    id: "claude-opus-4.6",
    label: "Claude Code / opus 4.6",
    provider: "claude",
    model: "claude-opus-4-6",
  },
  {
    id: "claude-opus-4.7",
    label: "Claude Code / opus 4.7",
    provider: "claude",
    model: "claude-opus-4-7",
  },
  {
    id: "claude-opus-4.8",
    label: "Claude Code / opus 4.8",
    provider: "claude",
    model: "claude-opus-4-8",
  },
  {
    id: "claude-fable",
    label: "Claude Code / fable 5",
    provider: "claude",
    // Pinned concrete id (round-7 item 4) — bare "fable" would grade a moving
    // target. Historical rows with model "fable" resolve at read time (v7 §8).
    model: "claude-fable-5",
  },
  {
    id: "pi-deepseek-flash",
    label: "pi-mono / DeepSeek v4 flash (OpenRouter)",
    provider: "pi",
    model: "openrouter/deepseek/deepseek-v4-flash",
  },
  {
    id: "pi-deepseek-pro",
    label: "pi-mono / DeepSeek v4 pro (OpenRouter)",
    provider: "pi",
    model: "openrouter/deepseek/deepseek-v4-pro",
  },
  {
    id: "pi-gemini-flash",
    label: "pi-mono / Gemini 3 flash (OpenRouter)",
    provider: "pi",
    model: "openrouter/google/gemini-3-flash-preview",
  },
  {
    id: "pi-glm-flash",
    label: "pi-mono / GLM 4.7 flash (OpenRouter)",
    provider: "pi",
    model: "openrouter/z-ai/glm-4.7-flash",
  },
  {
    id: "pi-qwen-coder",
    label: "pi-mono / Qwen3 Coder next (OpenRouter)",
    provider: "pi",
    model: "openrouter/qwen/qwen3-coder-next",
  },
  {
    id: "pi-minimax-m2.5",
    label: "pi-mono / MiniMax M2.5 (OpenRouter)",
    provider: "pi",
    model: "openrouter/minimax/minimax-m2.5",
  },
  {
    id: "pi-kimi-k2.5",
    label: "pi-mono / Kimi K2.5 (OpenRouter)",
    provider: "pi",
    model: "openrouter/moonshotai/kimi-k2.5",
  },
  {
    id: "pi-gpt-oss-120b",
    label: "pi-mono / GPT-OSS 120B (OpenRouter)",
    provider: "pi",
    model: "openrouter/openai/gpt-oss-120b",
  },
  {
    id: "opencode-gemini-flash",
    label: "opencode / Gemini 3 flash (OpenRouter)",
    provider: "opencode",
    model: "openrouter/google/gemini-3-flash-preview",
  },
  {
    id: "opencode-deepseek-flash",
    label: "opencode / DeepSeek v4 flash (OpenRouter)",
    provider: "opencode",
    model: "openrouter/deepseek/deepseek-v4-flash",
  },
  {
    id: "opencode-deepseek-pro",
    label: "opencode / DeepSeek v4 pro (OpenRouter)",
    provider: "opencode",
    model: "openrouter/deepseek/deepseek-v4-pro",
  },
  {
    id: "opencode-glm-flash",
    label: "opencode / GLM 4.7 flash (OpenRouter)",
    provider: "opencode",
    model: "openrouter/z-ai/glm-4.7-flash",
  },
  {
    id: "opencode-qwen-coder",
    label: "opencode / Qwen3 Coder next (OpenRouter)",
    provider: "opencode",
    model: "openrouter/qwen/qwen3-coder-next",
  },
  {
    id: "opencode-minimax-m2.5",
    label: "opencode / MiniMax M2.5 (OpenRouter)",
    provider: "opencode",
    model: "openrouter/minimax/minimax-m2.5",
  },
  {
    id: "opencode-kimi-k2.5",
    label: "opencode / Kimi K2.5 (OpenRouter)",
    provider: "opencode",
    model: "openrouter/moonshotai/kimi-k2.5",
  },
  {
    id: "opencode-gemini-flash-lite",
    label: "opencode / Gemini 3.1 flash lite (OpenRouter)",
    provider: "opencode",
    model: "openrouter/google/gemini-3.1-flash-lite",
  },
  {
    id: "codex-5.4-mini",
    label: "Codex / gpt-5.4-mini",
    provider: "codex",
    model: "gpt-5.4-mini",
  },
  {
    id: "codex-5.4",
    label: "Codex / gpt-5.4",
    provider: "codex",
    model: "gpt-5.4",
  },
  {
    id: "codex-5.5",
    label: "Codex / gpt-5.5",
    provider: "codex",
    model: "gpt-5.5",
  },
];

export const DEFAULT_CONFIG_IDS = ["claude-haiku", "pi-deepseek-flash", "opencode-gemini-flash"];
