/**
 * DES-201: memory-get must not allow cross-agent reads of `agent`-scoped
 * memories. Covers: same-agent read (allowed), cross-agent read of an
 * `agent`-scoped memory (rejected), cross-agent read of a `swarm`-scoped
 * memory (allowed), and lead override (allowed).
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { unlink } from "node:fs/promises";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { closeDb, createAgent, initDb } from "../be/db";
import { SqliteMemoryStore } from "../be/memory/providers/sqlite-store";
import { registerMemoryGetTool } from "../tools/memory-get";

const TEST_DB_PATH = "./test-memory-get-tool.sqlite";
const ownerAgentId = "aaaa0000-0000-4000-8000-000000000301";
const otherAgentId = "aaaa0000-0000-4000-8000-000000000302";
const leadAgentId = "aaaa0000-0000-4000-8000-000000000303";

function buildServer() {
  const server = new McpServer({ name: "memory-get-test", version: "1.0.0" });
  registerMemoryGetTool(server);
  type RegisteredTool = {
    handler: (args: unknown, extra: unknown) => Promise<unknown>;
  };
  const registered = (server as unknown as { _registeredTools: Record<string, RegisteredTool> })
    ._registeredTools;
  const tool = registered["memory-get"];
  if (!tool) throw new Error("memory-get tool not registered");
  return tool;
}

function metaFor(agentId: string) {
  return {
    sessionId: "session-123",
    requestInfo: { headers: { "x-agent-id": agentId } },
  };
}

describe("memory-get MCP tool authorization (DES-201)", () => {
  let store: SqliteMemoryStore;
  let agentScopedMemoryId: string;
  let swarmScopedMemoryId: string;

  beforeAll(async () => {
    for (const suffix of ["", "-wal", "-shm"]) {
      try {
        await unlink(TEST_DB_PATH + suffix);
      } catch {}
    }
    initDb(TEST_DB_PATH);
    createAgent({ id: ownerAgentId, name: "Owner Agent", isLead: false, status: "idle" });
    createAgent({ id: otherAgentId, name: "Other Agent", isLead: false, status: "idle" });
    createAgent({ id: leadAgentId, name: "Lead Agent", isLead: true, status: "idle" });
    store = new SqliteMemoryStore();

    agentScopedMemoryId = store.store({
      agentId: ownerAgentId,
      scope: "agent",
      name: "private note",
      content: "sensitive owner-only content",
      source: "manual",
    }).id;

    swarmScopedMemoryId = store.store({
      agentId: ownerAgentId,
      scope: "swarm",
      name: "shared note",
      content: "shared content for everyone",
      source: "manual",
    }).id;
  });

  afterAll(async () => {
    closeDb();
    for (const suffix of ["", "-wal", "-shm"]) {
      try {
        await unlink(TEST_DB_PATH + suffix);
      } catch {}
    }
  });

  test("owner can read their own agent-scoped memory", async () => {
    const tool = buildServer();
    const result = (await tool.handler(
      { memoryId: agentScopedMemoryId, intent: "check my own note" },
      metaFor(ownerAgentId),
    )) as { structuredContent: { success: boolean; memory?: { content: string } } };

    expect(result.structuredContent.success).toBe(true);
    expect(result.structuredContent.memory?.content).toBe("sensitive owner-only content");
  });

  test("a different agent cannot read another agent's agent-scoped memory", async () => {
    const tool = buildServer();
    const result = (await tool.handler(
      { memoryId: agentScopedMemoryId, intent: "snooping" },
      metaFor(otherAgentId),
    )) as { structuredContent: { success: boolean; message: string; memory?: unknown } };

    expect(result.structuredContent.success).toBe(false);
    expect(result.structuredContent.message).toBe("Not authorized to read this memory.");
    expect(result.structuredContent.memory).toBeUndefined();
  });

  test("any agent can read a swarm-scoped memory owned by someone else", async () => {
    const tool = buildServer();
    const result = (await tool.handler(
      { memoryId: swarmScopedMemoryId, intent: "checking shared knowledge" },
      metaFor(otherAgentId),
    )) as { structuredContent: { success: boolean; memory?: { content: string } } };

    expect(result.structuredContent.success).toBe(true);
    expect(result.structuredContent.memory?.content).toBe("shared content for everyone");
  });

  test("lead agent can read another agent's agent-scoped memory", async () => {
    const tool = buildServer();
    const result = (await tool.handler(
      { memoryId: agentScopedMemoryId, intent: "lead audit" },
      metaFor(leadAgentId),
    )) as { structuredContent: { success: boolean; memory?: { content: string } } };

    expect(result.structuredContent.success).toBe(true);
    expect(result.structuredContent.memory?.content).toBe("sensitive owner-only content");
  });

  test("MCP handshake — memory-get is registered with the expected name", () => {
    const tool = buildServer();
    expect(tool).toBeTruthy();
  });
});
