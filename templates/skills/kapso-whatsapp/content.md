# WhatsApp Messaging

Use this skill when sending WhatsApp messages through a configured provider.

Rules:

1. Confirm sender, recipient, and whether the conversation window is open.
2. Use approved templates when the recipient is outside the free-form window.
3. Do not send regulated, sensitive, or private content without explicit authorization.
4. Log provider message IDs and status.
5. Keep `{{WHATSAPP_PROVIDER_API_KEY}}` and `{{WHATSAPP_SENDER_ID}}` in secrets or configuration.
