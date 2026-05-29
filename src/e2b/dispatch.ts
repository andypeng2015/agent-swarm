import { DEFAULT_E2B_API_BASE, type EnvMap, redactWithEnv } from "./env";

export type E2BRole = "api" | "worker";

export type E2BSandboxInfo = {
  templateID: string;
  sandboxID: string;
  clientID?: string;
  envdVersion?: string;
  alias?: string;
  envdAccessToken?: string;
  trafficAccessToken?: string;
  domain?: string | null;
  startedAt?: string;
  endAt?: string;
  metadata?: Record<string, string>;
  // Client-side fallback for the sandbox expiry. The raw `POST /sandboxes`
  // create response uses E2B's `Sandbox` schema, which (unlike `ListedSandbox`
  // / `SandboxDetail`) does NOT include `endAt`. We populate this from
  // `now + timeoutSec*1000` at create time so `ttlRemaining` can report expiry
  // immediately after a launch without an extra round-trip. `endAt` (when
  // present, e.g. from `listSandboxes`) is always authoritative over this.
  expiresAt?: string;
};

export type TtlRemaining = {
  expiresAt?: string;
  secondsLeft?: number;
};

export type SetSandboxTimeoutOptions = {
  sandboxId: string;
  apiKey: string;
  apiBase?: string;
  e2bEnv?: EnvMap;
  timeoutMs: number;
};

export type E2BCommandResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

export type BuildTemplateOptions = {
  role: E2BRole;
  name: string;
  dockerfile: string;
  cwd: string;
  cpuCount: number;
  memoryMb: number;
  noCache: boolean;
  e2bEnv: EnvMap;
  dryRun?: boolean;
};

export type DeleteTemplateOptions = {
  name: string;
  e2bEnv: EnvMap;
  dryRun?: boolean;
};

export type TemplateVisibilityOptions = {
  name: string;
  e2bEnv: EnvMap;
  public: boolean;
  dryRun?: boolean;
};

export type BuildImageTemplateOptions = {
  role: E2BRole;
  name: string;
  image: string;
  cpuCount: number;
  memoryMb: number;
  noCache: boolean;
  e2bEnv: EnvMap;
  dryRun?: boolean;
};

export type CreateSandboxOptions = {
  apiKey: string;
  apiBase?: string;
  template: string;
  timeoutSec: number;
  envVars: EnvMap;
  metadata: Record<string, string>;
  allowInternetAccess?: boolean;
};

export type StartDetachedOptions = {
  sandbox: E2BSandboxInfo;
  apiKey: string;
  apiBase?: string;
  e2bEnv?: EnvMap;
  env: EnvMap;
  command: string;
  role: E2BRole;
  user?: string;
  cwd?: string;
};

type E2BSdkConnectionOptions = {
  apiKey: string;
  apiUrl?: string;
  domain?: string;
  sandboxUrl?: string;
};

type E2BTemplateVisibilityResponse = {
  names: string[];
};

function e2bHeaders(apiKey: string): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "X-API-Key": apiKey,
  };
}

export function buildDetachedShell(command: string, logPath: string, pidPath: string): string {
  return [
    "set -e",
    `nohup ${command} >${logPath} 2>&1 </dev/null & pid=$!`,
    "sleep 2",
    `if ! kill -0 "$pid" 2>/dev/null; then cat ${logPath} >&2; exit 1; fi`,
    `echo "$pid" > ${pidPath}`,
    'echo "$pid"',
  ].join("; ");
}

export function e2bSdkConnectionOptions(
  apiKey: string,
  env: EnvMap,
  apiBase?: string,
): E2BSdkConnectionOptions {
  const options: E2BSdkConnectionOptions = { apiKey };
  const resolvedApiUrl = apiBase || env.E2B_API_URL;
  if (resolvedApiUrl) options.apiUrl = resolvedApiUrl;
  if (env.E2B_DOMAIN) options.domain = env.E2B_DOMAIN;
  if (env.E2B_SANDBOX_URL) options.sandboxUrl = env.E2B_SANDBOX_URL;
  return options;
}

function sandboxDomainFromUrl(rawUrl: string): string | undefined {
  try {
    const url = new URL(rawUrl);
    const host = url.host;
    return host.startsWith("sandbox.") ? host.slice("sandbox.".length) : host;
  } catch {
    const host = rawUrl.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
    if (!host) return undefined;
    return host.startsWith("sandbox.") ? host.slice("sandbox.".length) : host;
  }
}

function configuredSandboxDomain(env: EnvMap): string | undefined {
  if (env.E2B_DOMAIN) return env.E2B_DOMAIN;
  if (env.E2B_SANDBOX_URL) return sandboxDomainFromUrl(env.E2B_SANDBOX_URL);
  return undefined;
}

export function sandboxPortHost(sandbox: E2BSandboxInfo, port: number, env: EnvMap = {}): string {
  const domain = sandbox.domain || configuredSandboxDomain(env) || "e2b.app";
  if (domain.includes(sandbox.sandboxID)) {
    return `${port}-${domain}`;
  }
  return `${port}-${sandbox.sandboxID}.${domain}`;
}

export function sandboxPortUrl(sandbox: E2BSandboxInfo, port: number, env: EnvMap = {}): string {
  return `https://${sandboxPortHost(sandbox, port, env)}`;
}

async function readResponseBody(response: Response): Promise<string> {
  const text = await response.text();
  return text.trim();
}

export async function e2bFetchJson<T>(
  path: string,
  apiKey: string,
  init: RequestInit = {},
  apiBase = DEFAULT_E2B_API_BASE,
): Promise<T> {
  const response = await fetch(`${apiBase}${path}`, {
    ...init,
    headers: {
      ...e2bHeaders(apiKey),
      ...(init.headers ?? {}),
    },
  });

  if (!response.ok) {
    const body = await readResponseBody(response);
    throw new Error(`E2B API ${response.status} ${response.statusText}: ${body}`);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

export async function createSandbox(opts: CreateSandboxOptions): Promise<E2BSandboxInfo> {
  // Capture the wall-clock create instant BEFORE the request so the client-side
  // expiry fallback reflects when the TTL countdown begins.
  const createdAt = Date.now();
  const sandbox = await e2bFetchJson<E2BSandboxInfo>(
    "/sandboxes",
    opts.apiKey,
    {
      method: "POST",
      body: JSON.stringify({
        templateID: opts.template,
        timeout: opts.timeoutSec,
        secure: true,
        allow_internet_access: opts.allowInternetAccess ?? true,
        metadata: opts.metadata,
        envVars: opts.envVars,
      }),
    },
    opts.apiBase,
  );
  // Pre-flight check (resolved against node_modules/e2b types): the create
  // response is E2B's `Sandbox` schema, which omits `endAt`. Compute a
  // client-side expiry fallback so `ttlRemaining` works right after launch.
  if (!sandbox.endAt && !sandbox.expiresAt) {
    sandbox.expiresAt = new Date(createdAt + opts.timeoutSec * 1000).toISOString();
  }
  return sandbox;
}

/**
 * Compute the remaining time-to-live for a sandbox. Prefers the authoritative
 * `endAt` (present on listed/detail responses); falls back to the client-side
 * `expiresAt` stamped by `createSandbox`. Returns an empty object when neither
 * is available (e.g. a dry-run fake sandbox). `secondsLeft` is clamped at 0 so
 * an already-expired sandbox never reports negative time.
 */
export function ttlRemaining(sandbox: E2BSandboxInfo): TtlRemaining {
  const expiresAt = sandbox.endAt ?? sandbox.expiresAt;
  if (!expiresAt) return {};
  const expiryMs = Date.parse(expiresAt);
  if (Number.isNaN(expiryMs)) return {};
  const secondsLeft = Math.max(0, Math.round((expiryMs - Date.now()) / 1000));
  return { expiresAt, secondsLeft };
}

/**
 * Extend (or reduce) a live sandbox's TTL via the SDK and read back the actual
 * `endAt` E2B applied (the server clamps to the tier max, so the requested
 * timeout is not always honored verbatim). Connecting to a dead/expired sandbox
 * throws; we translate that into a redacted "not found / already expired"
 * error so a stale sandbox ID never leaks the controller key into logs.
 */
export async function setSandboxTimeout(opts: SetSandboxTimeoutOptions): Promise<TtlRemaining> {
  const { Sandbox } = await import("e2b");
  let sandbox: Awaited<ReturnType<typeof Sandbox.connect>>;
  try {
    sandbox = await Sandbox.connect(
      opts.sandboxId,
      e2bSdkConnectionOptions(opts.apiKey, opts.e2bEnv ?? {}, opts.apiBase),
    );
  } catch {
    // Do not surface the underlying error verbatim — it can embed the
    // controller API key / connection URL. Emit a fixed redacted message.
    throw new Error(`sandbox ${opts.sandboxId} not found / already expired`);
  }

  await sandbox.setTimeout(opts.timeoutMs);
  // `setTimeout` returns void; re-read the info to learn the clamped expiry.
  const info = await sandbox.getInfo();
  const expiresAt = info.endAt instanceof Date ? info.endAt.toISOString() : String(info.endAt);
  return ttlRemaining({
    sandboxID: opts.sandboxId,
    templateID: info.templateId,
    endAt: expiresAt,
  });
}

export async function killSandbox(
  sandboxId: string,
  apiKey: string,
  apiBase = DEFAULT_E2B_API_BASE,
): Promise<void> {
  await e2bFetchJson<void>(
    `/sandboxes/${encodeURIComponent(sandboxId)}`,
    apiKey,
    { method: "DELETE" },
    apiBase,
  );
}

export async function listSandboxes(
  apiKey: string,
  apiBase = DEFAULT_E2B_API_BASE,
): Promise<E2BSandboxInfo[]> {
  return e2bFetchJson<E2BSandboxInfo[]>("/sandboxes", apiKey, {}, apiBase);
}

export async function startDetachedProcess(opts: StartDetachedOptions): Promise<string> {
  const logPath = `/tmp/agent-swarm-e2b-${opts.role}.log`;
  const pidPath = `/tmp/agent-swarm-e2b-${opts.role}.pid`;
  const shell = buildDetachedShell(opts.command, logPath, pidPath);

  const { Sandbox } = await import("e2b");
  const sandbox = await Sandbox.connect(
    opts.sandbox.sandboxID,
    e2bSdkConnectionOptions(opts.apiKey, opts.e2bEnv ?? {}, opts.apiBase),
  );
  const result = await sandbox.commands.run(shell, {
    user: opts.user ?? "root",
    cwd: opts.cwd ?? "/",
    envs: opts.env,
    timeoutMs: 30_000,
  });

  if (result.exitCode !== 0) {
    throw new Error(`E2B start command failed: ${redactWithEnv(result.stderr, opts.env)}`);
  }
  return result.stdout.trim();
}

export async function waitForAgentRegistration(
  apiUrl: string,
  agentId: string,
  apiKey: string,
  timeoutMs: number,
): Promise<void> {
  const baseUrl = apiUrl.replace(/\/+$/, "");
  const url = `${baseUrl}/api/agents/${encodeURIComponent(agentId)}`;
  const started = Date.now();
  let lastError = "";

  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
      });
      if (response.ok) return;
      lastError = `${response.status} ${response.statusText}`;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
    await Bun.sleep(1_000);
  }

  throw new Error(
    `Timed out waiting for worker ${agentId} to register at ${url}${
      lastError ? ` (${lastError})` : ""
    }`,
  );
}

export async function waitForHttpOk(url: string, timeoutMs: number): Promise<void> {
  const started = Date.now();
  let lastError = "";
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
      lastError = `${response.status} ${response.statusText}`;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
    await Bun.sleep(1_000);
  }
  throw new Error(`Timed out waiting for ${url}${lastError ? ` (${lastError})` : ""}`);
}

export function buildTemplateArgs(opts: BuildTemplateOptions): string[] {
  const args = [
    "template",
    "create",
    "-p",
    opts.cwd,
    "-d",
    opts.dockerfile,
    "-c",
    "sleep infinity",
    "--ready-cmd",
    "sleep 0",
    "--cpu-count",
    String(opts.cpuCount),
    "--memory-mb",
    String(opts.memoryMb),
  ];

  if (opts.noCache) {
    args.push("--no-cache");
  }

  args.push(opts.name);
  return args;
}

export async function runE2BCommand(args: string[], env: EnvMap): Promise<E2BCommandResult> {
  const child = Bun.spawn(["e2b", ...args], {
    env: { ...process.env, ...env },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { stdout: redactWithEnv(stdout, env), stderr: redactWithEnv(stderr, env), exitCode };
}

export async function buildTemplate(opts: BuildTemplateOptions): Promise<E2BCommandResult> {
  const args = buildTemplateArgs(opts);
  if (opts.dryRun) {
    return { exitCode: 0, stdout: `e2b ${args.join(" ")}\n`, stderr: "" };
  }
  return runE2BCommand(args, opts.e2bEnv);
}

export async function buildImageTemplate(
  opts: BuildImageTemplateOptions,
): Promise<E2BCommandResult> {
  if (opts.dryRun) {
    return {
      exitCode: 0,
      stdout: [
        `e2b-sdk template build --from-image ${opts.image}`,
        `  --name ${opts.name}`,
        `  --start-cmd "sleep infinity"`,
        `  --ready-cmd "sleep 0"`,
        `  --cpu-count ${opts.cpuCount}`,
        `  --memory-mb ${opts.memoryMb}`,
        opts.noCache ? `  --no-cache` : "",
      ]
        .filter(Boolean)
        .join("\n")
        .concat("\n"),
      stderr: "",
    };
  }

  const apiKey = opts.e2bEnv.E2B_API_KEY;
  if (!apiKey) {
    throw new Error("Missing E2B_API_KEY");
  }

  const { Template } = await import("e2b");
  const template = Template().fromImage(opts.image).setStartCmd("sleep infinity", "sleep 0");
  const buildInfo = await Template.build(template, opts.name, {
    ...e2bSdkConnectionOptions(apiKey, opts.e2bEnv),
    cpuCount: opts.cpuCount,
    memoryMB: opts.memoryMb,
    skipCache: opts.noCache,
  });

  return {
    exitCode: 0,
    stdout: `Built E2B ${opts.role} template ${buildInfo.name} (${buildInfo.templateId}, build ${buildInfo.buildId})\n`,
    stderr: "",
  };
}

export async function deleteTemplate(opts: DeleteTemplateOptions): Promise<E2BCommandResult> {
  const args = ["template", "delete", opts.name, "-y"];
  if (opts.dryRun) {
    return { exitCode: 0, stdout: `e2b ${args.join(" ")}\n`, stderr: "" };
  }
  return runE2BCommand(args, opts.e2bEnv);
}

export async function setTemplateVisibility(
  opts: TemplateVisibilityOptions,
): Promise<E2BCommandResult> {
  const path = `/v2/templates/${encodeURIComponent(opts.name)}`;
  if (opts.dryRun) {
    return {
      exitCode: 0,
      stdout: `PATCH ${path} {"public":${opts.public}}\n`,
      stderr: "",
    };
  }

  const apiKey = opts.e2bEnv.E2B_API_KEY;
  if (!apiKey) {
    throw new Error("Missing E2B_API_KEY");
  }

  const result = await e2bFetchJson<E2BTemplateVisibilityResponse>(
    path,
    apiKey,
    {
      method: "PATCH",
      body: JSON.stringify({ public: opts.public }),
    },
    opts.e2bEnv.E2B_API_URL || DEFAULT_E2B_API_BASE,
  );
  const names = result.names.length > 0 ? ` (${result.names.join(", ")})` : "";
  const visibility = opts.public ? "public" : "private";
  return {
    exitCode: 0,
    stdout: `Set E2B template ${opts.name} visibility to ${visibility}${names}\n`,
    stderr: "",
  };
}
