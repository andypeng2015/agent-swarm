import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import * as z from "zod";
import type { RequestInfo } from "./utils";
import { createToolRegistrar } from "./utils";

const kapsoNumberMappingSchema = z.object({
  phoneNumberId: z.string(),
  agentId: z.string().optional(),
  workflowId: z.string().optional(),
  name: z.string().optional(),
  createdAt: z.string(),
});

const registerKapsoNumberInputSchema = z.object({
  phoneNumberId: z
    .string()
    .min(1)
    .describe("Kapso/Meta phone-number ID to provision (KAPSO_PHONE_NUMBER_ID)."),
  agentId: z
    .string()
    .uuid()
    .optional()
    .describe(
      "Agent to route inbound messages to as a `kapso-inbound` task. Defaults to the lead agent when omitted.",
    ),
  workflowId: z
    .string()
    .uuid()
    .optional()
    .describe(
      "Advanced override: dispatch inbound via this workflow's webhook trigger instead of a task.",
    ),
  name: z.string().optional().describe("Human-friendly display name for the number."),
});

const registerKapsoNumberOutputSchema = z.object({
  yourAgentId: z.string().uuid().optional(),
  success: z.boolean(),
  message: z.string(),
  webhookUrl: z.string().optional(),
  webhookRegistered: z.boolean().optional(),
  mapping: kapsoNumberMappingSchema.optional(),
});

const unregisterKapsoNumberInputSchema = z.object({
  phoneNumberId: z
    .string()
    .min(1)
    .describe("Kapso/Meta phone-number ID whose mapping should be removed."),
});

const unregisterKapsoNumberOutputSchema = z.object({
  yourAgentId: z.string().uuid().optional(),
  success: z.boolean(),
  message: z.string(),
});

export type RegisterKapsoNumberInput = z.infer<typeof registerKapsoNumberInputSchema>;
export type UnregisterKapsoNumberInput = z.infer<typeof unregisterKapsoNumberInputSchema>;

type ToolHandler<Input> = (
  input: Input,
  requestInfo: RequestInfo,
) => CallToolResult | Promise<CallToolResult>;

export const registerRegisterKapsoNumberToolShim = (
  server: McpServer,
  handler: ToolHandler<RegisterKapsoNumberInput>,
) => {
  createToolRegistrar(server)(
    "register-kapso-number",
    {
      title: "Register Kapso WhatsApp Number",
      annotations: { idempotentHint: true, openWorldHint: true },
      description:
        "Provision a Kapso WhatsApp phone number for native inbound routing. Lead-only. Points the number's Kapso webhook at the swarm's native handler (signed with KAPSO_WEBHOOK_HMAC_SECRET) and stores a KV mapping so inbound messages route to an agent (defaults to the lead, or a workflow if workflowId is given). Returns the stored mapping + the registered webhook URL.",
      inputSchema: registerKapsoNumberInputSchema,
      outputSchema: registerKapsoNumberOutputSchema,
    },
    handler,
  );
};

export const registerUnregisterKapsoNumberToolShim = (
  server: McpServer,
  handler: ToolHandler<UnregisterKapsoNumberInput>,
) => {
  createToolRegistrar(server)(
    "unregister-kapso-number",
    {
      title: "Unregister Kapso WhatsApp Number",
      annotations: { idempotentHint: true },
      description:
        "Remove a Kapso phone number's native routing mapping from the KV store. Lead-only. Inbound messages for the number stop routing through the native handler. The Kapso-side webhook is not deleted automatically — remove it in the Kapso dashboard if you want deliveries to stop.",
      inputSchema: unregisterKapsoNumberInputSchema,
      outputSchema: unregisterKapsoNumberOutputSchema,
    },
    handler,
  );
};
