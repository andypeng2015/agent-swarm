import type { IncomingMessage, ServerResponse } from "node:http";
import { z } from "zod";
import { createPage, getPage } from "../be/db";
import { snapshotPage } from "../pages/version";
import { PageAuthModeSchema, PageContentTypeSchema } from "../types";
import { signPageSession } from "../utils/page-session";
import { route } from "./route-def";
import { json, jsonError } from "./utils";

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Lightweight kebab-case slug generator. Lowercases, replaces any run of
 * non-alphanumeric chars with a single hyphen, trims hyphens, falls back to
 * "page" if the result is empty (e.g. a title of "!!!").
 */
function slugify(input: string): string {
  const slug = input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "page";
}

// ─── Route Definitions ──────────────────────────────────────────────────────

const createPageRoute = route({
  method: "post",
  path: "/api/pages",
  pattern: ["api", "pages"],
  summary: "Create a new page",
  tags: ["Pages"],
  body: z.object({
    slug: z.string().min(1).optional(),
    title: z.string().min(1),
    description: z.string().optional(),
    contentType: PageContentTypeSchema,
    authMode: PageAuthModeSchema,
    password: z.string().min(1).optional(),
    body: z.string(),
    needsCredentials: z.array(z.string()).optional(),
  }),
  responses: {
    201: { description: "Page created" },
    400: { description: "Invalid body" },
    409: { description: "Slug already exists for this agent" },
  },
});

const getPageRoute = route({
  method: "get",
  path: "/api/pages/{id}",
  pattern: ["api", "pages", null],
  summary: "Get a page by ID",
  tags: ["Pages"],
  params: z.object({ id: z.string() }),
  responses: {
    200: { description: "Page row" },
    404: { description: "Page not found" },
  },
});

/**
 * Issue a page-session cookie for a given page id. Until step-3 narrows the
 * authorization story per `auth_mode`, this endpoint accepts any page and
 * issues a cookie purely on bearer auth. Used by the SPA iframe shell when
 * loading `/artifacts/:id`.
 *
 * Response: 204 No Content + `Set-Cookie: page_session=<signed>; HttpOnly; ...`.
 */
const launchPageRoute = route({
  method: "post",
  path: "/api/pages/{id}/launch",
  pattern: ["api", "pages", null, "launch"],
  summary: "Launch a page session (issues HttpOnly cookie)",
  tags: ["Pages"],
  params: z.object({ id: z.string() }),
  responses: {
    204: { description: "Cookie issued" },
    404: { description: "Page not found" },
  },
});

/** Cookie lifetime in seconds. 1 hour. Renewed each /launch call. */
const PAGE_SESSION_TTL_SECONDS = 3600;

/**
 * Build the `Set-Cookie` value for the page-session cookie.
 *
 * Production defaults are paranoid: `HttpOnly` (no JS access), `Secure`
 * (HTTPS only), `SameSite=None` (cross-site embedding in `<iframe>` works).
 * In dev we soften this so localhost works without HTTPS — detected via
 * `NODE_ENV !== 'production'` AND a localhost-origin request.
 */
function buildSetCookie(value: string, opts: { dev: boolean }): string {
  const attrs = [
    `page_session=${value}`,
    "HttpOnly",
    "Path=/",
    `Max-Age=${PAGE_SESSION_TTL_SECONDS}`,
  ];
  if (opts.dev) {
    // Dev: SameSite=Lax + no Secure → works on http://localhost without TLS.
    attrs.push("SameSite=Lax");
  } else {
    // Prod: SameSite=None requires Secure (browser enforced).
    attrs.push("SameSite=None");
    attrs.push("Secure");
  }
  return attrs.join("; ");
}

/**
 * Apply CORS headers needed for the cross-origin launch call. The SPA on
 * `localhost:5274` calls `localhost:3013` with `credentials: 'include'`,
 * which requires:
 *   - `Access-Control-Allow-Origin: <exact origin>` (NOT `*`)
 *   - `Access-Control-Allow-Credentials: true`
 *
 * Production paths typically use a shared parent domain (cookie scoped via
 * `Domain=`), but for local dev we have to be explicit.
 */
function applyLaunchCors(req: IncomingMessage, res: ServerResponse): void {
  const origin = (req.headers.origin as string | undefined) ?? "";
  if (origin) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Credentials", "true");
  }
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
}

function isDevRequest(req: IncomingMessage): boolean {
  if (process.env.NODE_ENV === "production") return false;
  // Even without NODE_ENV=production, if the origin is non-localhost we still
  // treat the cookie as cross-site (Secure required) since the browser will
  // refuse `SameSite=None` without `Secure` over HTTP — except localhost is
  // an exception in Chrome/Safari.
  const origin = (req.headers.origin as string | undefined) ?? "";
  return (
    origin === "" || origin.startsWith("http://localhost") || origin.startsWith("http://127.0.0.1")
  );
}

// ─── Handler ────────────────────────────────────────────────────────────────

export async function handlePages(
  req: IncomingMessage,
  res: ServerResponse,
  pathSegments: string[],
  queryParams: URLSearchParams,
  myAgentId: string | undefined,
): Promise<boolean> {
  if (createPageRoute.match(req.method, pathSegments)) {
    const parsed = await createPageRoute.parse(req, res, pathSegments, queryParams);
    if (!parsed) return true;

    if (!myAgentId) {
      jsonError(res, "X-Agent-ID header required", 400);
      return true;
    }

    const slug = parsed.body.slug ?? slugify(parsed.body.title);

    // Hash password if provided. Bun.password.hash is async (Argon2 by default;
    // we explicitly select bcrypt to keep hashes short + portable).
    let passwordHash: string | undefined;
    if (parsed.body.password) {
      passwordHash = await Bun.password.hash(parsed.body.password, "bcrypt");
    }

    try {
      const page = createPage({
        agentId: myAgentId,
        slug,
        title: parsed.body.title,
        description: parsed.body.description,
        contentType: parsed.body.contentType,
        authMode: parsed.body.authMode,
        passwordHash,
        body: parsed.body.body,
        needsCredentials: parsed.body.needsCredentials,
      });
      // First write has no prior snapshot — version 1 is implicit (the parent
      // IS v1). step-3 will add snapshot-on-update via the PUT route.
      json(res, { id: page.id, version: 1 }, 201);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("UNIQUE")) {
        jsonError(res, `Page with slug "${slug}" already exists for this agent`, 409);
        return true;
      }
      throw err;
    }
    return true;
  }

  if (getPageRoute.match(req.method, pathSegments)) {
    const parsed = await getPageRoute.parse(req, res, pathSegments, queryParams);
    if (!parsed) return true;
    const page = getPage(parsed.params.id);
    if (!page) {
      res.writeHead(404);
      res.end();
      return true;
    }
    json(res, page);
    return true;
  }

  // CORS preflight for the launch endpoint. The SPA on localhost:5274 sends
  // an OPTIONS preflight before the credentialed POST. Match the same path
  // pattern (`api/pages/<id>/launch`) so we only respond for this one route.
  if (
    req.method === "OPTIONS" &&
    pathSegments.length === 4 &&
    pathSegments[0] === "api" &&
    pathSegments[1] === "pages" &&
    pathSegments[3] === "launch"
  ) {
    applyLaunchCors(req, res);
    res.writeHead(204);
    res.end();
    return true;
  }

  if (launchPageRoute.match(req.method, pathSegments)) {
    const parsed = await launchPageRoute.parse(req, res, pathSegments, queryParams);
    if (!parsed) return true;

    const page = getPage(parsed.params.id);
    if (!page) {
      applyLaunchCors(req, res);
      res.writeHead(404);
      res.end();
      return true;
    }

    // step-3 will narrow this per `page.authMode`. For now, any authed
    // (bearer) caller can mint a session cookie for any page id.
    const exp = Math.floor(Date.now() / 1000) + PAGE_SESSION_TTL_SECONDS;
    const token = await signPageSession({ pageId: page.id, exp });
    const cookie = buildSetCookie(token, { dev: isDevRequest(req) });

    applyLaunchCors(req, res);
    res.setHeader("Set-Cookie", cookie);
    res.writeHead(204);
    res.end();
    return true;
  }

  return false;
}

// `snapshotPage` is re-exported so step-3's PUT route handler can call it
// before invoking `updatePage`. Mirrors how src/http/workflows.ts re-uses
// `snapshotWorkflow` from `src/workflows/version.ts`.
export { snapshotPage };
