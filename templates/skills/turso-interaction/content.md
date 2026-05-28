# Turso / LibSQL Interaction

Use this skill for generic LibSQL or Turso database work.

Rules:

1. Use read-only queries until the requested mutation is clear.
2. Keep credentials in secrets, never in prompts or committed files.
3. For mutations, include the exact SQL and expected row count in progress notes.
4. Prefer transactions for multi-step changes.
5. Export or summarize evidence before and after high-risk changes.
