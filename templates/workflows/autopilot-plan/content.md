# Autopilot Plan

Use this for planning when research already exists.

```json
{
  "name": "Autopilot plan",
  "description": "Create an implementation plan from existing context.",
  "triggerSchema": {
    "type": "object",
    "required": ["request", "context"],
    "properties": {
      "request": { "type": "string" },
      "context": { "type": "string" },
      "repoUrl": { "type": "string" }
    }
  },
  "nodes": [
    {
      "id": "plan",
      "type": "agent-task",
      "config": {
        "role": "reviewer",
        "task": "Using this context: {{context}}\nCreate a concrete implementation plan for {{request}} in {{repoUrl}}. Include sequence, files, tests, and rollback concerns."
      }
    }
  ]
}
```
