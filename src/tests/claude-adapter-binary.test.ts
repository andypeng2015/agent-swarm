/**
 * Tests for the `CLAUDE_BINARY` env override in `ClaudeAdapter.createSession`.
 *
 * Two behaviors under test:
 *   1. Binary resolution — argv[0] tracks `process.env.CLAUDE_BINARY`, with
 *      "claude" as the default. argv[1..] is unchanged.
 *   2. Tmux fail-fast — when the resolved binary contains "shannon",
 *      createSession throws if `tmux` is not on PATH.
 *
 * `Bun.spawn` is stubbed so the tests don't actually exec anything; we read
 * the argv off the call args. `Bun.which` is stubbed for the tmux gate so
 * the tests don't depend on the host having tmux installed.
 */

import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { ClaudeAdapter } from "../providers/claude-adapter";
import type { ProviderSessionConfig } from "../providers/types";

/** Minimal config — empty apiUrl/apiKey/agentId skips the MCP-server fetch. */
function makeConfig(overrides: Partial<ProviderSessionConfig> = {}): ProviderSessionConfig {
  return {
    prompt: "Say hello",
    systemPrompt: "",
    model: "sonnet",
    role: "worker",
    agentId: "",
    taskId: "test-task-binary",
    apiUrl: "",
    apiKey: "",
    cwd: "/tmp",
    logFile: "/tmp/test-claude-adapter-binary.jsonl",
    ...overrides,
  };
}

/** Fake Bun.Subprocess that behaves as a process that exited cleanly with no output. */
function makeFakeProc(): ReturnType<typeof Bun.spawn> {
  return {
    stdout: null,
    stderr: null,
    stdin: null,
    exited: Promise.resolve(0),
    exitCode: 0,
    kill: () => {},
    pid: 0,
    killed: false,
    ref: () => {},
    unref: () => {},
  } as unknown as ReturnType<typeof Bun.spawn>;
}

describe("CLAUDE_BINARY env override", () => {
  // Cache the originals and restore after each test so the suite stays clean.
  let originalClaudeBinary: string | undefined;
  let originalOauthToken: string | undefined;
  let spawnSpy: ReturnType<typeof spyOn>;
  let whichSpy: ReturnType<typeof spyOn>;
  let spawnedArgs: Array<readonly string[]>;

  beforeEach(() => {
    originalClaudeBinary = process.env.CLAUDE_BINARY;
    originalOauthToken = process.env.CLAUDE_CODE_OAUTH_TOKEN;
    delete process.env.CLAUDE_BINARY;
    // Credential check runs before binary resolution; satisfy it.
    process.env.CLAUDE_CODE_OAUTH_TOKEN = "test-token";

    spawnedArgs = [];
    spawnSpy = spyOn(Bun, "spawn").mockImplementation(((cmd: readonly string[]) => {
      spawnedArgs.push(cmd);
      return makeFakeProc();
    }) as typeof Bun.spawn);

    // Default: pretend tmux IS on PATH so non-tmux-gate tests don't trip.
    whichSpy = spyOn(Bun, "which").mockImplementation((name: string) => {
      if (name === "tmux") return "/usr/bin/tmux";
      return null;
    });
  });

  afterEach(() => {
    spawnSpy.mockRestore();
    whichSpy.mockRestore();
    if (originalClaudeBinary === undefined) {
      delete process.env.CLAUDE_BINARY;
    } else {
      process.env.CLAUDE_BINARY = originalClaudeBinary;
    }
    if (originalOauthToken === undefined) {
      delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
    } else {
      process.env.CLAUDE_CODE_OAUTH_TOKEN = originalOauthToken;
    }
  });

  test("default: argv[0] is 'claude' when CLAUDE_BINARY is unset", async () => {
    const adapter = new ClaudeAdapter();
    await adapter.createSession(makeConfig());

    expect(spawnedArgs).toHaveLength(1);
    const argv = spawnedArgs[0];
    expect(argv[0]).toBe("claude");
  });

  test("override: argv[0] is 'shannon' when CLAUDE_BINARY=shannon", async () => {
    process.env.CLAUDE_BINARY = "shannon";

    const adapter = new ClaudeAdapter();
    await adapter.createSession(makeConfig());

    const argv = spawnedArgs[0];
    expect(argv[0]).toBe("shannon");
  });

  test("custom path: argv[0] is the absolute path when CLAUDE_BINARY=/usr/local/bin/shannon", async () => {
    process.env.CLAUDE_BINARY = "/usr/local/bin/shannon";

    const adapter = new ClaudeAdapter();
    await adapter.createSession(makeConfig());

    expect(spawnedArgs[0][0]).toBe("/usr/local/bin/shannon");
  });

  test("argv[1..] is unchanged when CLAUDE_BINARY=shannon (shannon uses the same flags)", async () => {
    process.env.CLAUDE_BINARY = "shannon";
    const adapter = new ClaudeAdapter();
    await adapter.createSession(makeConfig());
    const argvShannon = spawnedArgs[0].slice(1);

    // Compare against the default-binary argv built from the same config.
    spawnedArgs = [];
    delete process.env.CLAUDE_BINARY;
    await adapter.createSession(makeConfig());
    const argvClaude = spawnedArgs[0].slice(1);

    expect(argvShannon).toEqual(argvClaude);
  });
});

describe("Shannon tmux fail-fast gate", () => {
  let originalClaudeBinary: string | undefined;
  let originalOauthToken: string | undefined;
  let spawnSpy: ReturnType<typeof spyOn>;
  let whichSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    originalClaudeBinary = process.env.CLAUDE_BINARY;
    originalOauthToken = process.env.CLAUDE_CODE_OAUTH_TOKEN;
    delete process.env.CLAUDE_BINARY;
    process.env.CLAUDE_CODE_OAUTH_TOKEN = "test-token";
    spawnSpy = spyOn(Bun, "spawn").mockImplementation((() => makeFakeProc()) as typeof Bun.spawn);
    whichSpy = spyOn(Bun, "which");
  });

  afterEach(() => {
    spawnSpy.mockRestore();
    whichSpy.mockRestore();
    if (originalClaudeBinary === undefined) {
      delete process.env.CLAUDE_BINARY;
    } else {
      process.env.CLAUDE_BINARY = originalClaudeBinary;
    }
    if (originalOauthToken === undefined) {
      delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
    } else {
      process.env.CLAUDE_CODE_OAUTH_TOKEN = originalOauthToken;
    }
  });

  test("sad path: rejects with tmux-mentioning error when CLAUDE_BINARY=shannon and tmux is missing", async () => {
    process.env.CLAUDE_BINARY = "shannon";
    whichSpy.mockImplementation((name: string) => {
      if (name === "tmux") return null;
      return `/usr/bin/${name}`;
    });

    const adapter = new ClaudeAdapter();
    await expect(adapter.createSession(makeConfig())).rejects.toThrow(/tmux/i);
  });

  test("happy path: does not throw when CLAUDE_BINARY=shannon and tmux IS on PATH", async () => {
    process.env.CLAUDE_BINARY = "shannon";
    whichSpy.mockImplementation((name: string) => {
      if (name === "tmux") return "/usr/bin/tmux";
      return null;
    });

    const adapter = new ClaudeAdapter();
    await expect(adapter.createSession(makeConfig())).resolves.toBeDefined();
  });

  test("non-shannon binary skips the tmux check (no Bun.which call for tmux)", async () => {
    process.env.CLAUDE_BINARY = "claude";
    whichSpy.mockImplementation((name: string) => {
      if (name === "tmux") return null;
      return null;
    });

    const adapter = new ClaudeAdapter();
    // Should NOT throw even though tmux is "missing".
    await expect(adapter.createSession(makeConfig())).resolves.toBeDefined();
  });

  test("custom shannon path (e.g. /usr/local/bin/shannon) still triggers the tmux check", async () => {
    process.env.CLAUDE_BINARY = "/usr/local/bin/shannon";
    whichSpy.mockImplementation((name: string) => {
      if (name === "tmux") return null;
      return null;
    });

    const adapter = new ClaudeAdapter();
    await expect(adapter.createSession(makeConfig())).rejects.toThrow(/tmux/i);
  });
});
