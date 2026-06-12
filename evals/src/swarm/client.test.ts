import { afterEach, describe, expect, test } from "bun:test";
import { SwarmClient } from "./client.ts";

interface CapturedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

const realFetch = globalThis.fetch;

/** Swap global fetch for a capturing stub returning `responseBody`. */
function mockFetch(responseBody: unknown): CapturedRequest[] {
  const captured: CapturedRequest[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((value, key) => {
      headers[key.toLowerCase()] = value;
    });
    captured.push({
      url: String(input),
      method: init?.method ?? "GET",
      headers,
      body: typeof init?.body === "string" ? JSON.parse(init.body) : init?.body,
    });
    return new Response(JSON.stringify(responseBody), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;
  return captured;
}

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("SwarmClient.createTask dependsOn passthrough (v6 §0.7)", () => {
  test("dependsOn UUID array appears verbatim in the POST body", async () => {
    const captured = mockFetch({ id: "new-task", title: "t", status: "pending" });
    const client = new SwarmClient("http://stack.test", "swarm-key");
    const deps = ["11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222"];
    await client.createTask({ task: "title\n\nbody", agentId: "agent-1", dependsOn: deps });

    expect(captured).toHaveLength(1);
    const req = captured[0] as CapturedRequest;
    expect(req.url).toBe("http://stack.test/api/tasks");
    expect(req.method).toBe("POST");
    expect(req.headers.authorization).toBe("Bearer swarm-key");
    expect(req.body).toEqual({
      task: "title\n\nbody",
      agentId: "agent-1",
      source: "api",
      dependsOn: deps,
    });
  });

  test("dependsOn is omitted from the body when not provided", async () => {
    const captured = mockFetch({ id: "new-task", title: "t", status: "pending" });
    const client = new SwarmClient("http://stack.test", "swarm-key");
    await client.createTask({ task: "title\n\nbody", agentId: "agent-1" });
    const body = (captured[0] as CapturedRequest).body as Record<string, unknown>;
    expect("dependsOn" in body).toBe(false);
  });
});

describe("SwarmClient memory endpoints (v6 §0.6/§0.7)", () => {
  test("indexMemory POSTs the body verbatim to /api/memory/index", async () => {
    const captured = mockFetch({ queued: true, memoryIds: ["m-1", "m-2"] });
    const client = new SwarmClient("http://stack.test", "swarm-key");
    const res = await client.indexMemory({
      content: "the fact",
      name: "seed-memory-1",
      scope: "swarm",
      source: "manual",
      tags: ["eval-seed"],
    });
    expect(res.memoryIds).toEqual(["m-1", "m-2"]);
    const req = captured[0] as CapturedRequest;
    expect(req.url).toBe("http://stack.test/api/memory/index");
    expect(req.body).toEqual({
      content: "the fact",
      name: "seed-memory-1",
      scope: "swarm",
      source: "manual",
      tags: ["eval-seed"],
    });
  });

  test("searchMemory sends agentId as the X-Agent-ID header (not in the body)", async () => {
    const captured = mockFetch({ results: [{ id: "m-1" }] });
    const client = new SwarmClient("http://stack.test", "swarm-key");
    const res = await client.searchMemory({ agentId: "agent-uuid", query: "the fact" });
    expect(res.results).toEqual([{ id: "m-1" }]);
    const req = captured[0] as CapturedRequest;
    expect(req.url).toBe("http://stack.test/api/memory/search");
    expect(req.headers["x-agent-id"]).toBe("agent-uuid");
    expect(req.headers.authorization).toBe("Bearer swarm-key");
    // defaults are applied in the body; agentId stays out of it
    expect(req.body).toEqual({ query: "the fact", limit: 5, scope: "all" });
  });
});
