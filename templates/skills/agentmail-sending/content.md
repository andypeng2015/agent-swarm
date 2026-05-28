# AgentMail Sending

Use this skill when an agent sends email on behalf of an operator.

Checklist:

1. Confirm recipient, subject, and intended outcome.
2. Keep the message concise and specific.
3. Never expose secrets, internal task IDs, private Slack links, or unapproved customer data.
4. Include a plain-text signature such as `{{COMPANY_SIGNATURE}}`.
5. If replying, preserve the relevant context and avoid changing commitments made earlier.
6. When the API returns a provider error, report the provider status and do not retry blindly.
