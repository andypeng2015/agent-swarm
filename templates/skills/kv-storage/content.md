# KV Storage

Use this skill when a task needs small durable state.

Guidelines:

1. Use namespaced keys tied to the task, schedule, workflow, or external object.
2. Store compact JSON, not large artifacts.
3. Include timestamps and source identifiers for idempotency records.
4. Set TTLs for temporary state.
5. Do not store secrets or bulky logs in KV.
