/**
 * Public-facing page routes — `/p/:id` and `/p/:id.json`.
 *
 * Distinct from `src/http/pages.ts` (bearer-authed REST) — these are the
 * surfaces an end-user's browser actually hits. Both routes are declared
 * with `auth: { apiKey: false }` so the global bearer gate skips them.
 *
 * Scope of THIS module (step-3):
 *   - `auth_mode === 'public'`: ungated. HTML responses inline-inject the
 *     `BROWSER_SDK_JS` constant from `src/artifact-sdk/browser-sdk.ts` (reused
 *     verbatim — no token-injection hook on the client). JSON responses
 *     302-redirect to the SPA `/artifacts/:id` route (the JSON renderer lives
 *     in the SPA, not the API — step-6/7).
 *   - `auth_mode === 'authed'`: returns 401. step-4 narrows this to also
 *     accept a valid `page_session` cookie.
 *   - `auth_mode === 'password'`: returns 401. step-5 narrows this to also
 *     accept `?key=` query param + HTTP Basic.
 *
 * No request/response body is ever scrubbed in the served stream — page
 * bodies are agent-authored content and pass through verbatim. Logging
 * paths (errors only) DO scrub via `scrubSecrets`.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { z } from "zod";
import { BROWSER_SDK_JS } from "../artifact-sdk/browser-sdk";
import { getPage } from "../be/db";
import type { Page } from "../types";
import { scrubSecrets } from "../utils/secret-scrubber";
import { route } from "./route-def";

// ─── Route definitions (registered with auth: { apiKey: false }) ────────────

const publicPageRoute = route({
  method: "get",
  path: "/p/{id}",
  pattern: ["p", null],
  summary: "Render a page (HTML inline; JSON redirects to SPA)",
  tags: ["Pages"],
  params: z.object({ id: z.string() }),
  responses: {
    200: { description: "Rendered HTML page" },
    302: { description: "Redirect to SPA for JSON content" },
    401: { description: "Page requires an authenticated session" },
    404: { description: "Page not found" },
  },
  auth: { apiKey: false },
});

const publicPageJsonRoute = route({
  method: "get",
  path: "/p/{id}.json",
  pattern: ["p", null],
  summary: "Page metadata + body as JSON (used by SPA renderer)",
  tags: ["Pages"],
  params: z.object({ id: z.string() }),
  responses: {
    200: { description: "Page JSON" },
    401: { description: "Page requires an authenticated session" },
    404: { description: "Page not found" },
  },
  auth: { apiKey: false },
});

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Inject the BROWSER_SDK script tag into an HTML body. Insert immediately
 * after `<head>` if present; otherwise prepend so partial fragments still get
 * the SDK. The script is wrapped in `<script>...</script>` with no token
 * injection (the SDK relies on server-side header injection at the
 * `/@swarm/api/*` proxy boundary).
 *
 * Also injects `<base target="_blank">` so links inside the iframed page
 * open in the parent window — avoids the user being trapped inside an
 * iframe by a misbehaving page.
 */
function injectBrowserSdk(html: string): string {
  const injection = `<base target="_blank"><script>${BROWSER_SDK_JS}</script>`;
  // Use the first occurrence of `<head>` (case-insensitive). A page that
  // doesn't have a `<head>` element (raw fragment) still gets the SDK at the
  // front of the document.
  const headOpenMatch = html.match(/<head\b[^>]*>/i);
  if (headOpenMatch) {
    const idx = headOpenMatch.index! + headOpenMatch[0].length;
    return html.slice(0, idx) + injection + html.slice(idx);
  }
  return injection + html;
}

/**
 * Trim `.json` off the last path segment, returning the bare id. Returns
 * `null` if the segment doesn't end in `.json` (caller should fall through
 * to the plain `/p/:id` matcher).
 */
function stripJsonSuffix(idSegment: string): string | null {
  return idSegment.endsWith(".json") ? idSegment.slice(0, -".json".length) : null;
}

/**
 * Compute the SPA base URL (`APP_URL`). Mirrors `getAppBaseUrl` in pages.ts —
 * duplicated here to keep this module standalone (no cross-import inside the
 * http/ layer).
 */
function getAppBaseUrl(): string {
  const env = process.env.APP_URL?.trim();
  if (env) return env.replace(/\/+$/, "");
  return "http://localhost:5274";
}

/**
 * Build the `Content-Security-Policy` for the served HTML. Allows inline
 * scripts (required for `BROWSER_SDK_JS`) but locks down everything else to
 * `'self'`. The SPA iframes the page in step-6 with `sandbox="allow-scripts
 * allow-forms"`; the CSP is a defence-in-depth layer.
 */
function buildCsp(): string {
  const appUrl = getAppBaseUrl();
  return [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    "connect-src 'self'",
    `frame-ancestors 'self' ${appUrl}`,
  ].join("; ");
}

/**
 * Decide whether a page is reachable by an unauthenticated request. Only
 * `public` is permitted in step-3; `authed` (step-4) and `password` (step-5)
 * return 401 here. The narrowing happens in subsequent steps.
 */
function isAccessible(page: Page): { ok: true } | { ok: false; reason: string } {
  if (page.authMode === "public") return { ok: true };
  if (page.authMode === "authed") {
    return {
      ok: false,
      reason: "authed mode requires page-session cookie; visit /artifacts/:id",
    };
  }
  // password
  return { ok: false, reason: "password mode not yet implemented on /p/:id" };
}

// ─── Handler ────────────────────────────────────────────────────────────────

export async function handlePagesPublic(
  req: IncomingMessage,
  res: ServerResponse,
  pathSegments: string[],
  queryParams: URLSearchParams,
): Promise<boolean> {
  // Both routes share the same `["p", null]` pattern; we discriminate by
  // suffix on the second segment. The route() registrations exist mainly so
  // isPublicRoute() lets these through the bearer gate — actual dispatch is
  // handled here.
  if (pathSegments.length !== 2 || pathSegments[0] !== "p") return false;
  if (req.method !== "GET") return false;

  const second = pathSegments[1]!;
  const jsonStripped = stripJsonSuffix(second);
  const isJsonRoute = jsonStripped !== null;
  const id = jsonStripped ?? second;

  // Touch parse() to (a) honour Zod validation on the id segment and (b)
  // keep the OpenAPI machinery happy. Mismatched segment counts have
  // already been handled above.
  if (isJsonRoute) {
    // Re-shim pathSegments so the route parser sees `[p, <id>]` not `[p, <id>.json]`.
    const reshim = ["p", id];
    const parsed = await publicPageJsonRoute.parse(req, res, reshim, queryParams);
    if (!parsed) return true;
  } else {
    const parsed = await publicPageRoute.parse(req, res, pathSegments, queryParams);
    if (!parsed) return true;
  }

  const page = getPage(id);
  if (!page) {
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Page not found" }));
    return true;
  }

  const access = isAccessible(page);
  if (!access.ok) {
    res.writeHead(401, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: scrubSecrets(access.reason) }));
    return true;
  }

  if (isJsonRoute) {
    // `/p/:id.json` — JSON description of the page used by the SPA renderer.
    // Returns the current head state (no version history). Body included
    // verbatim. NOTE: passwordHash / agentId are NOT exposed here — these
    // are private. step-4 may revisit if needed.
    res.writeHead(200, {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    });
    res.end(
      JSON.stringify({
        id: page.id,
        version: 1, // edit-counter is API-internal; SPA reads via /api/pages/:id/versions
        title: page.title,
        description: page.description,
        contentType: page.contentType,
        authMode: page.authMode,
        body: page.body,
      }),
    );
    return true;
  }

  // `/p/:id` — render either HTML directly or 302→SPA for JSON.
  if (page.contentType === "application/json") {
    const target = `${getAppBaseUrl()}/artifacts/${page.id}`;
    res.writeHead(302, { Location: target });
    res.end();
    return true;
  }

  // text/html — inject SDK + serve.
  const html = injectBrowserSdk(page.body);
  res.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
    "Content-Security-Policy": buildCsp(),
    // Defence-in-depth: prevent MIME sniffing and clickjacking outside the SPA.
    "X-Content-Type-Options": "nosniff",
  });
  res.end(html);
  return true;
}
