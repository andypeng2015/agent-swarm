/**
 * Thin in-SPA mirror of `BROWSER_SDK_JS` (see `src/artifact-sdk/browser-sdk.ts`)
 * — the same agent-facing SwarmSDK surface that legacy artifact pages get
 * injected at window scope, reachable from a JSON-render page via the
 * `swarm.sdk` action node (step-7 of the db-backed-pages plan).
 *
 * The classic SDK proxies through `/@swarm/api/*` on the artifact's own Hono
 * server, which strips the page-session cookie and forwards with a
 * server-side bearer. The JSON renderer runs IN the SPA — there is no
 * server-side bearer-injection layer — so we call the swarm API directly
 * with the SPA's stored bearer (`Authorization: Bearer ${apiKey}`).
 *
 * Per `root.md` "What We're NOT Doing": JSON pages' declared actions in v1
 * may only target the swarm API using the viewer's bearer.
 */

const SDK_METHODS = [
  "createTask",
  "getTasks",
  "getTaskDetails",
  "storeProgress",
  "postMessage",
  "readMessages",
  "getSwarm",
  "listServices",
  "slackReply",
] as const;

export type SwarmSdkMethod = (typeof SDK_METHODS)[number];

export const SWARM_SDK_METHODS: readonly SwarmSdkMethod[] = SDK_METHODS;

export interface SwarmSdkContext {
  /** Absolute API base URL (no trailing slash), e.g. `http://localhost:3013`. */
  apiUrl: string;
  /**
   * Returns the per-request header map. Mirrors `ApiClient.getHeaders` —
   * factored as a callable so the bearer is re-read on every action invoke
   * (the user can swap the active connection between clicks).
   */
  getHeaders: () => Record<string, string>;
  /**
   * Override of `globalThis.fetch` (test injection point). When omitted, the
   * real `fetch` is used.
   */
  fetch?: typeof fetch;
}

export interface SwarmSDKInstance {
  createTask(args: Record<string, unknown>): Promise<unknown>;
  getTasks(args: Record<string, unknown>): Promise<unknown>;
  getTaskDetails(args: { id: string }): Promise<unknown>;
  storeProgress(args: { taskId: string; data: Record<string, unknown> }): Promise<unknown>;
  postMessage(args: Record<string, unknown>): Promise<unknown>;
  readMessages(args: Record<string, unknown>): Promise<unknown>;
  getSwarm(): Promise<unknown>;
  listServices(): Promise<unknown>;
  slackReply(args: Record<string, unknown>): Promise<unknown>;
}

/**
 * Construct an in-SPA SwarmSDK instance that dispatches each method to its
 * canonical `/api/*` endpoint with the viewer's bearer header. The endpoints
 * mirror `src/artifact-sdk/browser-sdk.ts` 1:1 — keep them in sync if either
 * surface changes.
 */
export function makeSwarmSDK(ctx: SwarmSdkContext): SwarmSDKInstance {
  const f = ctx.fetch ?? fetch.bind(globalThis);
  const headers = () => ctx.getHeaders();

  async function call(
    method: "GET" | "POST",
    path: string,
    body?: Record<string, unknown>,
  ): Promise<unknown> {
    const res = await f(`${ctx.apiUrl}${path}`, {
      method,
      headers: headers(),
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    // Empty body → return null rather than crash JSON.parse.
    let parsed: unknown = null;
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = text;
      }
    }
    if (!res.ok) {
      const err = new Error(`swarm.sdk ${method} ${path}: ${res.status}`);
      (err as Error & { response?: unknown }).response = parsed;
      throw err;
    }
    return parsed;
  }

  function toQuery(args: Record<string, unknown> | undefined): string {
    if (!args) return "";
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(args)) {
      if (v === undefined || v === null) continue;
      params.set(k, String(v));
    }
    const qs = params.toString();
    return qs ? `?${qs}` : "";
  }

  return {
    createTask: (args) => call("POST", "/api/tasks", args),
    getTasks: (args) => call("GET", `/api/tasks${toQuery(args)}`),
    getTaskDetails: (args) => call("GET", `/api/tasks/${encodeURIComponent(String(args.id))}`),
    storeProgress: (args) =>
      call(
        "POST",
        `/api/tasks/${encodeURIComponent(String(args.taskId))}/progress`,
        (args.data as Record<string, unknown> | undefined) ?? {},
      ),
    postMessage: (args) => call("POST", "/api/messages", args),
    readMessages: (args) => call("GET", `/api/messages${toQuery(args)}`),
    getSwarm: () => call("GET", "/api/agents"),
    listServices: () => call("GET", "/api/services"),
    slackReply: (args) => call("POST", "/api/slack/reply", args),
  };
}
