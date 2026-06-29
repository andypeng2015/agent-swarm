import { getApiKey } from "@swarm/core-utils/api-key";
import { getMcpBaseUrl } from "@swarm/core-utils/constants";
import { scrubSecrets } from "@swarm/core-utils/secret-scrubber";

interface ScriptsCommandDeps {
  apiKey?: string;
  baseUrl?: string;
  error?: (message: string) => void;
  exit?: (code: number) => void;
  fetch?: typeof fetch;
  log?: (message: string) => void;
}

export async function runScriptsCommand(
  argv: string[],
  deps: ScriptsCommandDeps = {},
): Promise<void> {
  const [subcommand] = argv;
  const log = deps.log ?? console.log;
  const error = deps.error ?? console.error;
  const exit = deps.exit ?? process.exit;

  if (subcommand !== "reembed") {
    error("Unknown scripts command. Usage: scripts reembed");
    exit(1);
    return;
  }

  const baseUrl = (deps.baseUrl ?? getMcpBaseUrl()).replace(/\/+$/, "");
  const apiKey = deps.apiKey ?? getApiKey();
  const fetchImpl = deps.fetch ?? fetch;

  const res = await fetchImpl(`${baseUrl}/api/scripts/reembed`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    error(scrubSecrets(`scripts reembed failed: HTTP ${res.status} ${res.statusText} ${body}`));
    exit(1);
    return;
  }

  const body = (await res.json().catch(() => ({}))) as { reembedded?: number };
  log(`Scripts re-embedded${typeof body.reembedded === "number" ? `: ${body.reembedded}` : ""}.`);
}
