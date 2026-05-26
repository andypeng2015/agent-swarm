import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod";
import { registerKapsoWebhook } from "@/integrations/kapso/client";
import {
  deleteKapsoNumberMapping,
  getKapsoConfig,
  getKapsoNumberMapping,
  type KapsoNumberMapping,
  putKapsoNumberMapping,
} from "@/integrations/kapso/config";
import { createToolRegistrar } from "@/tools/utils";

/** Build the native inbound webhook URL the swarm exposes for Kapso deliveries. */
function nativeWebhookUrl(): string {
  const base = (
    process.env.MCP_BASE_URL || `http://localhost:${process.env.PORT || "3013"}`
  ).replace(/\/+$/, "");
  return `${base}/api/integrations/kapso/webhook`;
}

export const registerRegisterKapsoNumberTool = (server: McpServer) => {
  createToolRegistrar(server)(
    "register-kapso-number",
    {
      title: "Register Kapso WhatsApp Number",
      annotations: { idempotentHint: true },
      description:
        "Provision a Kapso WhatsApp phone number for native inbound routing. Points the number's Kapso webhook at the swarm's native handler (signed with KAPSO_WEBHOOK_HMAC_SECRET) and stores a KV mapping so inbound messages route to an agent (or a workflow, if workflowId is given). Returns the stored mapping + the registered webhook URL.",
      inputSchema: z.object({
        phoneNumberId: z
          .string()
          .min(1)
          .describe("Kapso/Meta phone-number ID to provision (e.g. '1035039933036854')."),
        agentId: z
          .string()
          .uuid()
          .optional()
          .describe("Agent to route inbound messages to as a `kapso-inbound` task."),
        contextKey: z
          .string()
          .optional()
          .describe("Context key for thread/session continuity across messages."),
        workflowId: z
          .string()
          .uuid()
          .optional()
          .describe(
            "Advanced override: dispatch inbound via this workflow's webhook trigger instead of a task.",
          ),
        name: z.string().optional().describe("Human-friendly display name for the number."),
      }),
      outputSchema: z.object({
        yourAgentId: z.string().uuid().optional(),
        success: z.boolean(),
        message: z.string(),
        webhookUrl: z.string().optional(),
        webhookRegistered: z.boolean().optional(),
        mapping: z
          .object({
            phoneNumberId: z.string(),
            agentId: z.string().optional(),
            contextKey: z.string().optional(),
            workflowId: z.string().optional(),
            name: z.string().optional(),
            createdAt: z.string(),
          })
          .optional(),
      }),
    },
    async ({ phoneNumberId, agentId, contextKey, workflowId, name }, requestInfo) => {
      try {
        const config = getKapsoConfig();
        const webhookUrl = nativeWebhookUrl();

        // Best-effort: point the Kapso webhook at our native handler. The KV
        // mapping (the durable routing record the inbound handler reads) is
        // written regardless, so a manually-configured number still routes.
        let webhookRegistered = false;
        let webhookNote = "";
        if (!config.apiKey) {
          webhookNote =
            " (KAPSO_API_KEY not configured — skipped provider webhook registration; configure the webhook in the Kapso dashboard)";
        } else {
          const result = await registerKapsoWebhook({
            apiBaseUrl: config.apiBaseUrl,
            apiKey: config.apiKey,
            phoneNumberId,
            webhookUrl,
            secret: config.webhookHmacSecret,
          });
          webhookRegistered = result.ok;
          if (!result.ok) {
            webhookNote = ` (provider webhook registration failed: ${result.errorMessage})`;
          }
        }

        const mapping: KapsoNumberMapping = {
          phoneNumberId,
          ...(agentId ? { agentId } : {}),
          ...(contextKey ? { contextKey } : {}),
          ...(workflowId ? { workflowId } : {}),
          ...(name ? { name } : {}),
          createdAt: new Date().toISOString(),
        };
        putKapsoNumberMapping(mapping);

        const text = `Registered Kapso number ${phoneNumberId} → ${
          workflowId ? `workflow ${workflowId}` : agentId ? `agent ${agentId}` : "task pool"
        }${webhookNote}`;
        return {
          content: [{ type: "text", text }],
          structuredContent: {
            yourAgentId: requestInfo.agentId,
            success: true,
            message: text,
            webhookUrl,
            webhookRegistered,
            mapping,
          },
        };
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text", text: `Error: ${errorMessage}` }],
          structuredContent: {
            yourAgentId: requestInfo.agentId,
            success: false,
            message: errorMessage,
          },
        };
      }
    },
  );
};

export const registerUnregisterKapsoNumberTool = (server: McpServer) => {
  createToolRegistrar(server)(
    "unregister-kapso-number",
    {
      title: "Unregister Kapso WhatsApp Number",
      annotations: { idempotentHint: true },
      description:
        "Remove a Kapso phone number's native routing mapping from the KV store. Inbound messages for the number stop routing through the native handler. The Kapso-side webhook is not deleted automatically — remove it in the Kapso dashboard if you want deliveries to stop.",
      inputSchema: z.object({
        phoneNumberId: z
          .string()
          .min(1)
          .describe("Kapso/Meta phone-number ID whose mapping should be removed."),
      }),
      outputSchema: z.object({
        yourAgentId: z.string().uuid().optional(),
        success: z.boolean(),
        message: z.string(),
      }),
    },
    async ({ phoneNumberId }, requestInfo) => {
      try {
        const existing = getKapsoNumberMapping(phoneNumberId);
        const deleted = deleteKapsoNumberMapping(phoneNumberId);
        const text = existing
          ? `Unregistered Kapso number ${phoneNumberId}`
          : `No mapping found for Kapso number ${phoneNumberId}`;
        return {
          content: [{ type: "text", text }],
          structuredContent: {
            yourAgentId: requestInfo.agentId,
            success: deleted,
            message: text,
          },
        };
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text", text: `Error: ${errorMessage}` }],
          structuredContent: {
            yourAgentId: requestInfo.agentId,
            success: false,
            message: errorMessage,
          },
        };
      }
    },
  );
};
