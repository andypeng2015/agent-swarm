import type { IncomingMessage, ServerResponse } from "node:http";
import { z } from "zod";
import { getOAuthProviderConfig } from "@/be/oauth-credential-bindings";
import { exchangeCode } from "@/oauth/wrapper";
import { route } from "./route-def";
import { jsonError } from "./utils";

const DEDICATED_CALLBACK_PROVIDERS = new Set(["linear"]);

const genericOAuthCallbackRoute = route({
  method: "get",
  path: "/api/oauth/{provider}/callback",
  pattern: ["api", "oauth", null, "callback"],
  operationId: "oauth_generic_callback",
  summary: "Generic OAuth redirect target for script credential bindings",
  tags: ["OAuth"],
  auth: { apiKey: false },
  params: z.object({
    provider: z
      .string()
      .min(1)
      .max(255)
      .regex(/^[A-Za-z0-9_-]+$/),
  }),
  query: z.object({
    code: z.string().optional(),
    state: z.string().optional(),
    error: z.string().optional(),
    error_description: z.string().optional(),
  }),
  responses: {
    200: { description: "OAuth authorization completed" },
    400: { description: "Missing or invalid OAuth callback parameters" },
    404: { description: "OAuth app not configured" },
    409: { description: "Provider has a dedicated OAuth callback" },
    502: { description: "Token exchange failed" },
  },
});

function sendAuthorizedHtml(res: ServerResponse, provider: string): void {
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(`<!DOCTYPE html>
<html>
<head><title>OAuth Authorized</title></head>
<body style="font-family: system-ui; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0;">
  <main style="text-align: center;">
    <h1>${provider} authorized</h1>
    <p>You can close this tab.</p>
  </main>
</body>
</html>`);
}

export async function handleGenericOAuth(
  req: IncomingMessage,
  res: ServerResponse,
  pathSegments: string[],
  queryParams: URLSearchParams,
): Promise<boolean> {
  if (!genericOAuthCallbackRoute.match(req.method, pathSegments)) return false;

  const parsed = await genericOAuthCallbackRoute.parse(req, res, pathSegments, queryParams);
  if (!parsed) return true;

  const { provider } = parsed.params;
  if (DEDICATED_CALLBACK_PROVIDERS.has(provider)) {
    jsonError(
      res,
      "Provider linear uses the dedicated OAuth flow at /api/trackers/linear/authorize and /api/trackers/linear/callback.",
      409,
    );
    return true;
  }

  if (parsed.query.error) {
    jsonError(res, parsed.query.error_description ?? parsed.query.error, 400);
    return true;
  }

  if (!parsed.query.code || !parsed.query.state) {
    jsonError(res, "Missing code or state parameter", 400);
    return true;
  }

  const config = getOAuthProviderConfig(provider);
  if (!config) {
    jsonError(res, `OAuth app ${provider} is not configured`, 404);
    return true;
  }

  try {
    await exchangeCode(config, parsed.query.code, parsed.query.state);
    sendAuthorizedHtml(res, provider);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status = message.includes("Invalid or expired OAuth state") ? 400 : 502;
    jsonError(
      res,
      status === 400 ? "Invalid or expired OAuth state" : `Token exchange failed: ${message}`,
      status,
    );
  }

  return true;
}
