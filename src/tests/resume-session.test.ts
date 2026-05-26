import { describe, expect, test } from "bun:test";
import { resolveResumeSession } from "../commands/resume-session";

describe("resolveResumeSession", () => {
  test("allows local Claude resume for UUID session ids", () => {
    const resolution = resolveResumeSession("claude", [
      {
        source: "task",
        sessionId: "69dbe5a1-1130-45eb-983f-58a7a13c9c3c",
        provider: "claude",
      },
    ]);

    expect(resolution.resumeSessionId).toBe("69dbe5a1-1130-45eb-983f-58a7a13c9c3c");
    expect(resolution.source).toBe("task");
    expect(resolution.provider).toBe("claude");
    expect(resolution.skipped).toEqual([]);
  });

  test("rejects non-UUID ids for local Claude resume", () => {
    const resolution = resolveResumeSession("claude", [
      {
        source: "task",
        sessionId: "ses_19c145de3ffeD9qLlntj8SRO28",
        provider: "claude",
      },
    ]);

    expect(resolution.resumeSessionId).toBeUndefined();
    expect(resolution.skipped).toHaveLength(1);
    expect(resolution.skipped[0]?.reason).toBe("Claude CLI --resume requires a UUID session id");
  });

  test("normalizes legacy managed Claude rows to claude-managed", () => {
    const resolution = resolveResumeSession("claude-managed", [
      {
        source: "parent",
        sessionId: "sesn_resume_xyz",
        provider: "claude",
        providerMeta: { managed: true },
      },
    ]);

    expect(resolution.resumeSessionId).toBe("sesn_resume_xyz");
    expect(resolution.source).toBe("parent");
    expect(resolution.provider).toBe("claude-managed");
  });

  test("skips mismatched provider sessions and falls back to parent", () => {
    const resolution = resolveResumeSession("claude", [
      {
        source: "task",
        sessionId: "thread-codex",
        provider: "codex",
      },
      {
        source: "parent",
        sessionId: "69dbe5a1-1130-45eb-983f-58a7a13c9c3c",
        provider: "claude",
      },
    ]);

    expect(resolution.resumeSessionId).toBe("69dbe5a1-1130-45eb-983f-58a7a13c9c3c");
    expect(resolution.source).toBe("parent");
    expect(resolution.skipped).toHaveLength(1);
    expect(resolution.skipped[0]?.reason).toContain("does not match current provider");
  });

  test("rejects legacy unknown non-UUID Claude session ids", () => {
    const resolution = resolveResumeSession("claude", [
      {
        source: "task",
        sessionId: "ses_19c145de3ffeD9qLlntj8SRO28",
      },
    ]);

    expect(resolution.resumeSessionId).toBeUndefined();
    expect(resolution.skipped[0]?.reason).toBe("legacy Claude resume requires a UUID session id");
  });

  test("does not resume providers without runner resume support", () => {
    const resolution = resolveResumeSession("pi", [
      {
        source: "task",
        sessionId: "pi-session",
        provider: "pi",
      },
    ]);

    expect(resolution.resumeSessionId).toBeUndefined();
    expect(resolution.skipped[0]?.reason).toBe("provider pi does not support runner resume");
  });
});
