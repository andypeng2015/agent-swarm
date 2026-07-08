import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { unlink } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";
import { closeDb, createAgent, getDb, initDb, upsertSwarmConfig } from "../be/db";
import { upsertOAuthApp } from "../be/db-queries/oauth";
import { upsertCredentialBinding } from "../be/script-connections";
import { handleScriptConnections } from "../http/script-connections";
import { getPathSegments, parseQueryParams } from "../http/utils";

const TEST_DB_PATH = "./test-script-connections-http.sqlite";
const SECRET_VALUE = "vendor-secret-should-not-leak";

let leadAgentId: string;
let workerAgentId: string;

async function removeDbFiles(path: string): Promise<void> {
  for (const suffix of ["", "-wal", "-shm"]) {
    try {
      await unlink(path + suffix);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
}

type TestResponse = {
  status: number;
  text: string;
  json: () => Promise<unknown>;
};

async function dispatch(
  path: string,
  init: { method?: string; body?: unknown; agentId?: string } = {},
): Promise<TestResponse> {
  const req = Readable.from(
    init.body === undefined ? [] : [Buffer.from(JSON.stringify(init.body))],
  ) as IncomingMessage;
  req.method = init.method ?? "GET";
  req.url = path;
  req.headers = init.agentId
    ? {
        "x-agent-id": init.agentId,
        "content-type": "application/json",
      }
    : { "content-type": "application/json" };

  let status = 200;
  let text = "";
  const res = {
    headersSent: false,
    writableEnded: false,
    setHeader() {},
    writeHead(code: number) {
      status = code;
      this.headersSent = true;
      return this;
    },
    end(chunk?: unknown) {
      if (chunk !== undefined) text += String(chunk);
      this.writableEnded = true;
      return this;
    },
  } as unknown as ServerResponse;

  const pathSegments = getPathSegments(req.url || "");
  const queryParams = parseQueryParams(req.url || "");
  if (!(await handleScriptConnections(req, res, pathSegments, queryParams, init.agentId))) {
    res.writeHead(404);
    res.end("Not Found");
  }

  return {
    status,
    text,
    json: async () => JSON.parse(text),
  };
}

function inlineOpenApiSpec(): string {
  return JSON.stringify({
    openapi: "3.0.0",
    info: { title: "Vendor", version: "1.0.0" },
    paths: {
      "/items": {
        get: {
          operationId: "listItems",
          responses: {
            "200": {
              description: "OK",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: { ok: { type: "boolean" } },
                  },
                },
              },
            },
          },
        },
      },
    },
  });
}

beforeAll(async () => {
  await removeDbFiles(TEST_DB_PATH);
  initDb(TEST_DB_PATH);
  leadAgentId = createAgent({ name: "connections-http-lead", isLead: true, status: "idle" }).id;
  workerAgentId = createAgent({
    name: "connections-http-worker",
    isLead: false,
    status: "idle",
  }).id;
});

afterAll(async () => {
  closeDb();
  await removeDbFiles(TEST_DB_PATH);
});

beforeEach(() => {
  getDb().run("DELETE FROM script_connections");
  getDb().run("DELETE FROM script_credential_bindings");
  getDb().run("DELETE FROM oauth_tokens");
  getDb().run("DELETE FROM oauth_apps");
  getDb().run("DELETE FROM swarm_config");
});

describe("/api/script-connections HTTP", () => {
  test("POST upsert openapi inline spec succeeds as lead agent", async () => {
    const res = await dispatch("/api/script-connections", {
      method: "POST",
      agentId: leadAgentId,
      body: {
        kind: "openapi",
        slug: "vendor",
        displayName: "Vendor",
        baseUrl: "https://api.vendor.test",
        allowedHosts: ["api.vendor.test"],
        openapiSpecJson: inlineOpenApiSpec(),
      },
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      connection: { slug: string; kind: string; operationCount: number };
    };
    expect(body.connection.slug).toBe("vendor");
    expect(body.connection.kind).toBe("openapi");
    expect(body.connection.operationCount).toBe(1);
  });

  test("POST upsert is forbidden for non-lead agent principal", async () => {
    const res = await dispatch("/api/script-connections", {
      method: "POST",
      agentId: workerAgentId,
      body: {
        kind: "openapi",
        slug: "blockedVendor",
        baseUrl: "https://api.vendor.test",
        allowedHosts: ["api.vendor.test"],
        openapiSpecJson: inlineOpenApiSpec(),
      },
    });

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "Only the lead can manage script connections." });
  });

  test("list returns connections without secrets", async () => {
    upsertSwarmConfig({
      scope: "global",
      key: "VENDOR_TOKEN",
      value: SECRET_VALUE,
      isSecret: true,
    });
    const binding = upsertCredentialBinding({
      configKey: "VENDOR_TOKEN",
      allowedHosts: ["api.vendor.test"],
      headerTemplate: "Authorization: Bearer [REDACTED:VENDOR_TOKEN]",
    });

    await dispatch("/api/script-connections", {
      method: "POST",
      agentId: leadAgentId,
      body: {
        kind: "openapi",
        slug: "vendor",
        baseUrl: "https://api.vendor.test",
        allowedHosts: ["api.vendor.test"],
        credentialBindingId: binding.id,
        openapiSpecJson: inlineOpenApiSpec(),
      },
    });

    const res = await dispatch("/api/script-connections");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      connections: Array<{
        credentialBinding: { configKey: string } | null;
        openapiSpecJson?: string;
        generatedRuntimeJson?: string;
        generatedTypes?: string;
      }>;
    };
    expect(body.connections).toHaveLength(1);
    expect(body.connections[0]?.credentialBinding?.configKey).toBe("VENDOR_TOKEN");
    expect(body.connections[0]?.openapiSpecJson).toBeUndefined();
    expect(body.connections[0]?.generatedRuntimeJson).toBeUndefined();
    expect(body.connections[0]?.generatedTypes).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain(SECRET_VALUE);
    expect(JSON.stringify(body)).not.toContain("[REDACTED:VENDOR_TOKEN]");
  });

  test("oauth-apps GET never includes clientSecret", async () => {
    upsertOAuthApp("vendor_oauth", {
      clientId: "vendor-client",
      clientSecret: "oauth-client-secret-should-not-leak",
      authorizeUrl: "https://oauth.vendor.test/authorize",
      tokenUrl: "https://oauth.vendor.test/token",
      redirectUri: "https://api.public.test/api/oauth/vendor_oauth/callback",
      scopes: "read,write",
      metadata: JSON.stringify({
        extraParams: { audience: "vendor" },
        tokenAuthStyle: "basic",
        tokenBodyFormat: "json",
      }),
    });

    const res = await dispatch("/api/oauth-apps");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { oauthApps: Array<Record<string, unknown>> };
    expect(body.oauthApps).toHaveLength(1);
    expect(body.oauthApps[0]?.provider).toBe("vendor_oauth");
    expect(body.oauthApps[0]?.clientId).toBe("vendor-client");
    expect(body.oauthApps[0]).not.toHaveProperty("clientSecret");
    expect(JSON.stringify(body)).not.toContain("oauth-client-secret-should-not-leak");
  });
});
