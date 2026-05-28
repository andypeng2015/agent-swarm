# Workflow Structured Output

Use this whenever a task includes an output schema, validation tag, or explicit JSON output format.

Rules:

1. Return exactly one JSON value matching the requested schema.
2. Do not wrap the JSON in prose or Markdown fences.
3. Include every required field, even when the value is empty.
4. Use `null` only when the schema allows it.
5. If work fails, report failure through the task status mechanism rather than inventing a success-shaped JSON object.
6. Validate field names, enum values, and nested arrays before storing progress.
