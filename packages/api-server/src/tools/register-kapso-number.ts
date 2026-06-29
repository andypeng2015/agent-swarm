import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getPublicMcpBaseUrl } from "@swarm/core-utils/constants";
import { registerKapsoWebhook } from "@swarm/integrations/kapso/client";
import {
  deleteKapsoNumberMapping,
  getKapsoConfig,
  getKapsoNumberMapping,
  type KapsoNumberMapping,
  putKapsoNumberMapping,
} from "@swarm/integrations/kapso/config";
import {
  registerRegisterKapsoNumberToolShim,
  registerUnregisterKapsoNumberToolShim,
} from "@swarm/mcp-tool/kapso-registration";
import { getAgentById, getLeadAgent } from "@swarm/storage/db";

/** Build the native inbound webhook URL the swarm exposes for Kapso deliveries. */
function nativeWebhookUrl(): string {
  return `${getPublicMcpBaseUrl()}/api/integrations/kapso/webhook`;
}

export const registerRegisterKapsoNumberTool = (server: McpServer) => {
  registerRegisterKapsoNumberToolShim(
    server,
    async ({ phoneNumberId, agentId, workflowId, name }, requestInfo) => {
      try {
        // Lead-only: provisioning a number rewires inbound routing for the
        // whole swarm, so restrict it to the lead agent.
        const callerAgent = requestInfo.agentId ? getAgentById(requestInfo.agentId) : null;
        if (!callerAgent?.isLead) {
          const msg = "Permission denied. Only the lead can register a Kapso number.";
          return {
            content: [{ type: "text", text: msg }],
            structuredContent: { yourAgentId: requestInfo.agentId, success: false, message: msg },
          };
        }

        // Default the routing target to the lead when no agent/workflow is given.
        const ownerAgentId = agentId ?? (workflowId ? undefined : getLeadAgent()?.id);

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
          } else if (result.alreadyRegistered) {
            webhookNote = " (webhook already registered — skipped re-creation)";
          }
        }

        const mapping: KapsoNumberMapping = {
          phoneNumberId,
          ...(ownerAgentId ? { agentId: ownerAgentId } : {}),
          ...(workflowId ? { workflowId } : {}),
          ...(name ? { name } : {}),
          createdAt: new Date().toISOString(),
        };
        putKapsoNumberMapping(mapping);

        const text = `Registered Kapso number ${phoneNumberId} → ${
          workflowId
            ? `workflow ${workflowId}`
            : ownerAgentId
              ? `agent ${ownerAgentId}`
              : "task pool"
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
  registerUnregisterKapsoNumberToolShim(server, async ({ phoneNumberId }, requestInfo) => {
    try {
      const callerAgent = requestInfo.agentId ? getAgentById(requestInfo.agentId) : null;
      if (!callerAgent?.isLead) {
        const msg = "Permission denied. Only the lead can unregister a Kapso number.";
        return {
          content: [{ type: "text", text: msg }],
          structuredContent: { yourAgentId: requestInfo.agentId, success: false, message: msg },
        };
      }

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
  });
};
