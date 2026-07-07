import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod";
import { getAgentById } from "@/be/db";
import { upsertOAuthApp } from "@/be/db-queries/oauth";
import {
  getOAuthBindingTokenStatus,
  getOAuthProviderConfig,
  type OAuthBindingTokenStatus,
} from "@/be/oauth-credential-bindings";
import {
  disableCredentialBinding,
  importLegacyCredentialBindings,
  listRelationalCredentialBindings,
  type ScriptCredentialBindingRecord,
  upsertCredentialBinding,
} from "@/be/script-connections";
import { buildAuthorizationUrl } from "@/oauth/wrapper";
import { can } from "@/rbac";
import {
  CredentialBindingSchema,
  placeholderForConfigKey,
} from "@/scripts-runtime/credential-broker";
import { createToolRegistrar } from "@/tools/utils";
import { getPublicMcpBaseUrl } from "@/utils/constants";

const providerSchema = z
  .string()
  .min(1)
  .max(255)
  .regex(/^[A-Za-z0-9_-]+$/);
const tokenStatusSchema = z.enum(["ok", "expiring", "missing"]);
const credentialBindingToolBindingSchema = CredentialBindingSchema.and(
  z.object({
    id: z.string().optional(),
    source: z.enum(["default", "user", "migration"]).optional(),
    createdAt: z.string().optional(),
    updatedAt: z.string().optional(),
    createdBy: z.string().nullable().optional(),
    updatedBy: z.string().nullable().optional(),
    tokenStatus: tokenStatusSchema.optional(),
  }),
);

const credentialBindingsOutputSchema = z.object({
  yourAgentId: z.string().uuid().optional(),
  success: z.boolean(),
  message: z.string(),
  provider: z.string().optional(),
  authorizeUrl: z.string().optional(),
  redirectUri: z.string().optional(),
  bindings: z.array(credentialBindingToolBindingSchema),
});

const credentialBindingsInputSchema = z.object({
  action: z
    .enum(["list", "upsert", "disable", "import-legacy", "oauth-app-upsert", "oauth-authorize-url"])
    .describe(
      "List, add/update, disable, import legacy JSON bindings, or register/authorize OAuth apps.",
    ),
  id: z.string().uuid().optional(),
  configKey: z.string().min(1).max(255).optional(),
  allowedHosts: z.array(z.string().min(1)).min(1).optional(),
  headerTemplate: z.string().min(1).optional(),
  queryTemplate: z.string().min(1).optional(),
  scope: z.enum(["global", "agent", "repo"]).default("global").optional(),
  scopeId: z.string().uuid().nullable().optional(),
  authKind: z.enum(["config", "oauth"]).default("config").optional(),
  oauthProvider: providerSchema.optional(),
  provider: providerSchema.optional(),
  clientId: z.string().min(1).optional(),
  clientSecret: z.string().min(1).optional(),
  authorizeUrl: z.string().url().optional(),
  tokenUrl: z.string().url().optional(),
  scopes: z.array(z.string().min(1)).optional(),
  extraParams: z.record(z.string(), z.string()).optional(),
});

type BindingWithTokenStatus = ScriptCredentialBindingRecord & {
  tokenStatus?: OAuthBindingTokenStatus;
};

function genericOAuthRedirectUri(provider: string): string {
  return `${getPublicMcpBaseUrl()}/api/oauth/${encodeURIComponent(provider)}/callback`;
}

function decorateBindings(bindings: ScriptCredentialBindingRecord[]): BindingWithTokenStatus[] {
  return bindings.map((binding) =>
    binding.authKind === "oauth" && binding.oauthProvider
      ? { ...binding, tokenStatus: getOAuthBindingTokenStatus(binding.oauthProvider) }
      : binding,
  );
}

export const registerCredentialBindingsTool = (server: McpServer) => {
  createToolRegistrar(server)(
    "credential-bindings",
    {
      title: "Credential Bindings",
      description:
        "Lead-only management for scripts-runtime credential broker bindings. Bindings map config keys to allowed egress hosts; scripts consume them only through fetch-layer placeholder substitution.",
      annotations: { idempotentHint: true },
      inputSchema: credentialBindingsInputSchema,
      outputSchema: credentialBindingsOutputSchema,
    },
    async (args, requestInfo) => {
      if (!requestInfo.agentId) {
        return {
          content: [{ type: "text", text: 'Agent ID not found. Set the "X-Agent-ID" header.' }],
          structuredContent: {
            success: false,
            message: 'Agent ID not found. Set the "X-Agent-ID" header.',
            bindings: [],
          },
        };
      }

      const agent = getAgentById(requestInfo.agentId);
      const decision = can({
        principal: {
          kind: "agent",
          agentId: requestInfo.agentId,
          isLead: agent?.isLead ?? false,
        },
        verb: "credential-binding.manage",
        resource: { kind: "none" },
        source: "mcp",
      });
      if (!decision.allow) {
        return {
          content: [{ type: "text", text: "Only the lead can manage credential bindings." }],
          structuredContent: {
            yourAgentId: requestInfo.agentId,
            success: false,
            message: "Only the lead can manage credential bindings.",
            bindings: [],
          },
        };
      }

      const currentBindings = () =>
        decorateBindings(listRelationalCredentialBindings({ includeInactive: true }));
      const bindings = currentBindings();

      if (args.action === "oauth-app-upsert") {
        if (
          !args.provider ||
          !args.clientId ||
          !args.clientSecret ||
          !args.authorizeUrl ||
          !args.tokenUrl ||
          !args.scopes
        ) {
          return {
            content: [
              {
                type: "text",
                text: "provider, clientId, clientSecret, authorizeUrl, tokenUrl, and scopes are required for oauth-app-upsert.",
              },
            ],
            structuredContent: {
              yourAgentId: requestInfo.agentId,
              success: false,
              message:
                "provider, clientId, clientSecret, authorizeUrl, tokenUrl, and scopes are required for oauth-app-upsert.",
              bindings,
            },
          };
        }

        const redirectUri = genericOAuthRedirectUri(args.provider);
        upsertOAuthApp(args.provider, {
          clientId: args.clientId,
          clientSecret: args.clientSecret,
          authorizeUrl: args.authorizeUrl,
          tokenUrl: args.tokenUrl,
          redirectUri,
          scopes: args.scopes.join(","),
          ...(args.extraParams
            ? { metadata: JSON.stringify({ extraParams: args.extraParams }) }
            : {}),
        });

        return {
          content: [
            {
              type: "text",
              text: `OAuth app ${args.provider} saved. Redirect URI: ${redirectUri}`,
            },
          ],
          structuredContent: {
            yourAgentId: requestInfo.agentId,
            success: true,
            message: `OAuth app ${args.provider} saved.`,
            provider: args.provider,
            redirectUri,
            bindings: currentBindings(),
          },
        };
      }

      if (args.action === "oauth-authorize-url") {
        if (!args.provider) {
          return {
            content: [{ type: "text", text: "provider is required for oauth-authorize-url." }],
            structuredContent: {
              yourAgentId: requestInfo.agentId,
              success: false,
              message: "provider is required for oauth-authorize-url.",
              bindings,
            },
          };
        }

        const config = getOAuthProviderConfig(args.provider);
        if (!config) {
          return {
            content: [{ type: "text", text: `OAuth app ${args.provider} is not configured.` }],
            structuredContent: {
              yourAgentId: requestInfo.agentId,
              success: false,
              message: `OAuth app ${args.provider} is not configured.`,
              provider: args.provider,
              bindings,
            },
          };
        }

        const result = await buildAuthorizationUrl(config);
        return {
          content: [{ type: "text", text: result.url }],
          structuredContent: {
            yourAgentId: requestInfo.agentId,
            success: true,
            message: `OAuth authorization URL generated for ${args.provider}.`,
            provider: args.provider,
            authorizeUrl: result.url,
            redirectUri: config.redirectUri,
            bindings,
          },
        };
      }

      if (args.action === "list") {
        return {
          content: [
            {
              type: "text",
              text:
                bindings.length === 0
                  ? "No configured credential bindings."
                  : `Found ${bindings.length} credential binding(s).`,
            },
          ],
          structuredContent: {
            yourAgentId: requestInfo.agentId,
            success: true,
            message:
              bindings.length === 0
                ? "No configured credential bindings."
                : `Found ${bindings.length} credential binding(s).`,
            bindings,
          },
        };
      }

      if (args.action === "import-legacy") {
        const imported = importLegacyCredentialBindings();
        const nextBindings = currentBindings();
        return {
          content: [{ type: "text", text: `Imported ${imported} legacy credential binding(s).` }],
          structuredContent: {
            yourAgentId: requestInfo.agentId,
            success: true,
            message: `Imported ${imported} legacy credential binding(s).`,
            bindings: nextBindings,
          },
        };
      }

      if (args.action === "disable") {
        const disabled = args.id ? disableCredentialBinding(args.id) : null;
        if (!disabled) {
          return {
            content: [{ type: "text", text: "Credential binding id not found." }],
            structuredContent: {
              yourAgentId: requestInfo.agentId,
              success: false,
              message: "Credential binding id not found.",
              bindings,
            },
          };
        }

        const nextBindings = currentBindings();
        return {
          content: [{ type: "text", text: `Credential binding ${disabled.configKey} disabled.` }],
          structuredContent: {
            yourAgentId: requestInfo.agentId,
            success: true,
            message: `Credential binding ${disabled.configKey} disabled.`,
            bindings: nextBindings,
          },
        };
      }

      if (!args.configKey) {
        return {
          content: [{ type: "text", text: "configKey is required for upsert." }],
          structuredContent: {
            yourAgentId: requestInfo.agentId,
            success: false,
            message: "configKey is required for upsert.",
            bindings,
          },
        };
      }

      const scope = args.scope ?? "global";
      const scopeId = scope === "global" ? null : (args.scopeId ?? null);
      if (scope !== "global" && !scopeId) {
        return {
          content: [{ type: "text", text: `scopeId is required for ${scope} bindings.` }],
          structuredContent: {
            yourAgentId: requestInfo.agentId,
            success: false,
            message: `scopeId is required for ${scope} bindings.`,
            bindings,
          },
        };
      }

      if (!args.allowedHosts || (!args.headerTemplate && !args.queryTemplate)) {
        return {
          content: [
            {
              type: "text",
              text: "allowedHosts and at least one of headerTemplate or queryTemplate are required for upsert.",
            },
          ],
          structuredContent: {
            yourAgentId: requestInfo.agentId,
            success: false,
            message:
              "allowedHosts and at least one of headerTemplate or queryTemplate are required for upsert.",
            bindings,
          },
        };
      }

      if ((args.authKind ?? "config") === "oauth" && !args.oauthProvider) {
        return {
          content: [{ type: "text", text: "oauthProvider is required for oauth bindings." }],
          structuredContent: {
            yourAgentId: requestInfo.agentId,
            success: false,
            message: "oauthProvider is required for oauth bindings.",
            bindings,
          },
        };
      }

      const placeholder = placeholderForConfigKey(args.configKey);
      if (args.headerTemplate && !args.headerTemplate.includes(placeholder)) {
        return {
          content: [{ type: "text", text: `headerTemplate must include ${placeholder}.` }],
          structuredContent: {
            yourAgentId: requestInfo.agentId,
            success: false,
            message: `headerTemplate must include ${placeholder}.`,
            bindings,
          },
        };
      }
      if (args.queryTemplate && !args.queryTemplate.includes(placeholder)) {
        return {
          content: [{ type: "text", text: `queryTemplate must include ${placeholder}.` }],
          structuredContent: {
            yourAgentId: requestInfo.agentId,
            success: false,
            message: `queryTemplate must include ${placeholder}.`,
            bindings,
          },
        };
      }

      const nextBinding = CredentialBindingSchema.parse({
        configKey: args.configKey,
        allowedHosts: args.allowedHosts,
        headerTemplate: args.headerTemplate,
        queryTemplate: args.queryTemplate,
        scope,
        scopeId,
        active: true,
        authKind: args.authKind ?? "config",
        oauthProvider: args.oauthProvider,
      });

      upsertCredentialBinding({
        id: args.id,
        configKey: nextBinding.configKey,
        allowedHosts: nextBinding.allowedHosts,
        headerTemplate: nextBinding.headerTemplate,
        queryTemplate: nextBinding.queryTemplate,
        scope: nextBinding.scope,
        scopeId: nextBinding.scopeId ?? null,
        active: true,
        authKind: nextBinding.authKind,
        oauthProvider: nextBinding.oauthProvider ?? null,
      });
      const nextBindings = currentBindings();

      return {
        content: [{ type: "text", text: `Credential binding ${args.configKey} saved.` }],
        structuredContent: {
          yourAgentId: requestInfo.agentId,
          success: true,
          message: `Credential binding ${args.configKey} saved.`,
          bindings: nextBindings,
        },
      };
    },
  );
};
