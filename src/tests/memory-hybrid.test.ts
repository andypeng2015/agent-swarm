import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { unlink } from "node:fs/promises";
import { closeDb, createAgent, getDb, initDb } from "../be/db";
import { SqliteMemoryStore } from "../be/memory/providers/sqlite-store";

const TEST_DB_PATH = "./test-memory-hybrid.sqlite";
const agentId = "aaaa0000-0000-4000-8000-000000000101";

function vector(value: number): Float32Array {
  const embedding = new Float32Array(512);
  embedding[0] = value;
  return embedding;
}

describe("memory hybrid search", () => {
  let store: SqliteMemoryStore;

  beforeAll(async () => {
    for (const suffix of ["", "-wal", "-shm"]) {
      try {
        await unlink(TEST_DB_PATH + suffix);
      } catch {}
    }
    initDb(TEST_DB_PATH);
    createAgent({ id: agentId, name: "Hybrid Test Agent", isLead: false, status: "idle" });
    store = new SqliteMemoryStore();
  });

  afterAll(async () => {
    closeDb();
    for (const suffix of ["", "-wal", "-shm"]) {
      try {
        await unlink(TEST_DB_PATH + suffix);
      } catch {}
    }
  });

  test("syncs FTS rows on store and delete", () => {
    const memory = store.store({
      agentId,
      scope: "agent",
      name: "lexical row",
      content: "contains frobnicate-token",
      source: "manual",
    });

    const inserted = getDb()
      .prepare<{ count: number }, [string]>(
        "SELECT COUNT(*) AS count FROM memory_fts WHERE memory_id = ?",
      )
      .get(memory.id)?.count;
    expect(inserted).toBe(1);

    store.delete(memory.id);
    const deleted = getDb()
      .prepare<{ count: number }, [string]>(
        "SELECT COUNT(*) AS count FROM memory_fts WHERE memory_id = ?",
      )
      .get(memory.id)?.count;
    expect(deleted).toBe(0);
  });

  test("uses keyword arm for exact terms and dedupes fused results", () => {
    const exact = store.store({
      agentId,
      scope: "agent",
      name: "runbook",
      content: "The incident codeword is quasarneedle.",
      source: "manual",
    });
    const semantic = store.store({
      agentId,
      scope: "agent",
      name: "general note",
      content: "A generic operational note.",
      source: "manual",
    });
    store.updateEmbedding(exact.id, vector(1), "test");
    store.updateEmbedding(semantic.id, vector(1), "test");

    const results = store.search(vector(1), agentId, {
      scope: "agent",
      limit: 10,
      queryText: "quasarneedle",
    });

    expect(results.some((result) => result.id === exact.id)).toBe(true);
    expect(new Set(results.map((result) => result.id)).size).toBe(results.length);
  });

  test("falls back to keyword-only search when vector query is unavailable", () => {
    const exact = store.store({
      agentId,
      scope: "agent",
      name: "keyword fallback",
      content: "The fallback marker is lexiconneedle.",
      source: "manual",
    });

    const results = store.search(new Float32Array(0), agentId, {
      scope: "agent",
      limit: 5,
      queryText: "lexiconneedle",
    });

    expect(results.map((result) => result.id)).toContain(exact.id);
  });
});
