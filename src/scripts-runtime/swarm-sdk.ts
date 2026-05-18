import { scrubObject } from "../utils/secret-scrubber";
import { Redacted } from "./redacted";
import { isSdkToolAllowed } from "./sdk-allowlist";
import type { SwarmConfig } from "./swarm-config";

async function callTool(name: string, args: unknown, config: SwarmConfig): Promise<unknown> {
  if (!isSdkToolAllowed(name)) {
    throw new Error(
      `Tool '${name}' is not exposed to scripts (lifecycle/cred tool); use the MCP surface directly if you're an agent`,
    );
  }

  const baseUrl = Redacted.value(config.mcpBaseUrl).replace(/\/$/, "");
  const res = await fetch(`${baseUrl}/api/mcp/tools/${name}/call`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${Redacted.value(config.apiKey)}`,
      "X-Agent-ID": Redacted.value(config.agentId),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(args ?? {}),
  });

  if (!res.ok) {
    throw new Error(`swarm-sdk: ${name} failed with ${res.status}`);
  }

  return scrubObject(await res.json());
}

export function createSwarmSdk(
  config: SwarmConfig,
): Record<string, (args?: unknown) => Promise<unknown>> {
  return new Proxy(
    {},
    {
      get(_target, prop) {
        if (typeof prop !== "string") return undefined;
        return (args?: unknown) => callTool(prop, args, config);
      },
    },
  ) as Record<string, (args?: unknown) => Promise<unknown>>;
}
