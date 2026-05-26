/**
 * Thin Kapso REST client for the native integration. Pure `fetch` — no DB access.
 *
 * Two Kapso surfaces are used:
 *  - Meta Cloud API proxy:  `{base}/meta/whatsapp/v24.0/{phoneNumberId}/messages`
 *  - Kapso platform API:    `{base}/platform/v1/whatsapp/phone_numbers/{id}/webhooks`
 *
 * Both authenticate with the `X-API-Key` header.
 */

/** Result of an outbound text/reply send through the Meta proxy. */
export interface KapsoSendResult {
  ok: boolean;
  status: number;
  /** Outbound WAMID when the send succeeded. */
  messageId?: string;
  raw: unknown;
  /** True when Kapso/Meta rejected the send for being outside the 24h session window. */
  sessionWindowExpired: boolean;
  errorMessage?: string;
}

/** Meta error codes that mean "outside the 24h customer-service window". */
const SESSION_WINDOW_ERROR_CODES = new Set([131047, 131051, 470]);

function extractMetaError(raw: unknown): { code?: number; message?: string } {
  if (raw && typeof raw === "object" && "error" in raw) {
    const err = (raw as { error?: { code?: number; message?: string } }).error;
    if (err) return { code: err.code, message: err.message };
  }
  return {};
}

function isSessionWindowError(raw: unknown): boolean {
  const { code, message } = extractMetaError(raw);
  if (code !== undefined && SESSION_WINDOW_ERROR_CODES.has(code)) return true;
  const text = (message ?? "").toLowerCase();
  return text.includes("24 hours") || text.includes("re-engagement") || text.includes("outside");
}

async function parseJsonSafe(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/**
 * Send a free-form WhatsApp text message via the Meta Cloud API proxy. When
 * `contextMessageId` is set, the message renders as a quote-reply to that WAMID.
 */
export async function sendKapsoText(params: {
  apiBaseUrl: string;
  apiKey: string;
  phoneNumberId: string;
  to: string;
  body: string;
  previewUrl?: boolean;
  contextMessageId?: string;
}): Promise<KapsoSendResult> {
  const url = `${params.apiBaseUrl}/meta/whatsapp/v24.0/${params.phoneNumberId}/messages`;
  const payload: Record<string, unknown> = {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: params.to,
    type: "text",
    text: { preview_url: params.previewUrl ?? false, body: params.body },
  };
  if (params.contextMessageId) {
    payload.context = { message_id: params.contextMessageId };
  }

  const res = await fetch(url, {
    method: "POST",
    headers: { "X-API-Key": params.apiKey, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const raw = await parseJsonSafe(res);

  if (!res.ok) {
    const { message } = extractMetaError(raw);
    return {
      ok: false,
      status: res.status,
      raw,
      sessionWindowExpired: isSessionWindowError(raw),
      errorMessage: message ?? `Kapso send failed with status ${res.status}`,
    };
  }

  const messageId =
    raw && typeof raw === "object" && "messages" in raw
      ? (raw as { messages?: Array<{ id?: string }> }).messages?.[0]?.id
      : undefined;
  return { ok: true, status: res.status, messageId, raw, sessionWindowExpired: false };
}

/** Result of configuring a webhook on a phone number. */
export interface KapsoWebhookResult {
  ok: boolean;
  status: number;
  raw: unknown;
  errorMessage?: string;
}

/**
 * Register (or re-point) the Kapso webhook for a phone number so inbound events
 * are delivered to `webhookUrl`, signed with `secret` via `X-Webhook-Signature`.
 */
export async function registerKapsoWebhook(params: {
  apiBaseUrl: string;
  apiKey: string;
  phoneNumberId: string;
  webhookUrl: string;
  secret?: string;
  events?: string[];
}): Promise<KapsoWebhookResult> {
  const url = `${params.apiBaseUrl}/platform/v1/whatsapp/phone_numbers/${params.phoneNumberId}/webhooks`;
  const whatsapp_webhook: Record<string, unknown> = {
    kind: "kapso",
    url: params.webhookUrl,
    events: params.events ?? ["whatsapp.message.received"],
  };
  if (params.secret) whatsapp_webhook.secret_key = params.secret;

  const res = await fetch(url, {
    method: "POST",
    headers: { "X-API-Key": params.apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({ whatsapp_webhook }),
  });
  const raw = await parseJsonSafe(res);

  if (!res.ok) {
    const { message } = extractMetaError(raw);
    return {
      ok: false,
      status: res.status,
      raw,
      errorMessage: message ?? `Kapso webhook registration failed with status ${res.status}`,
    };
  }
  return { ok: true, status: res.status, raw };
}
