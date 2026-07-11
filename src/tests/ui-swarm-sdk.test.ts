import { describe, expect, test } from "bun:test";
import { makeSwarmSDK, SWARM_SDK_METHODS } from "../../apps/ui/src/lib/swarm-sdk";

type RecordedCall = {
  url: string;
  method: string;
  body?: unknown;
};

describe("SPA SwarmSDK asset namespace domain", () => {
  test("exposes and routes every asset management method", async () => {
    const calls: RecordedCall[] = [];
    const fetchStub = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({
        url: String(input),
        method: init?.method ?? "GET",
        body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
      });
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;

    const sdk = makeSwarmSDK({
      apiUrl: "https://swarm.example",
      getHeaders: () => ({ "content-type": "application/json" }),
      fetch: fetchStub,
    });

    expect(SWARM_SDK_METHODS).toEqual(
      expect.arrayContaining([
        "assets.list",
        "assets.audit",
        "assets.registerMapping",
        "assets.move",
      ]),
    );

    await sdk.assets.list({ keyPrefix: "shared/team/", types: "task,page", limit: 25 });
    await sdk.invoke("assets.audit");
    await sdk.invoke("assets.registerMapping", {
      providerId: "agent-fs",
      providerKey: "reports/q3.md",
      key: "shared/reports/",
    });
    await sdk.invoke("assets.move", {
      entityType: "page",
      id: "page/quarterly",
      key: "shared/reports/",
    });

    const listUrl = new URL(calls[0]!.url);
    expect(listUrl.pathname).toBe("/api/assets");
    expect(listUrl.searchParams.get("keyPrefix")).toBe("shared/team/");
    expect(listUrl.searchParams.get("types")).toBe("task,page");
    expect(listUrl.searchParams.get("limit")).toBe("25");

    expect(calls.slice(1)).toEqual([
      {
        url: "https://swarm.example/api/assets/key-audit",
        method: "GET",
        body: undefined,
      },
      {
        url: "https://swarm.example/api/assets/mappings",
        method: "POST",
        body: {
          providerId: "agent-fs",
          providerKey: "reports/q3.md",
          key: "shared/reports/",
        },
      },
      {
        url: "https://swarm.example/api/assets/page/page%2Fquarterly/key",
        method: "PATCH",
        body: { key: "shared/reports/" },
      },
    ]);
  });
});
