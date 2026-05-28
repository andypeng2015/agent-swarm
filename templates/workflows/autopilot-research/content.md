# Autopilot Research

Use this when a request needs discovery before implementation.

```json
{
  "name": "Autopilot research",
  "description": "Research a request and produce implementation options.",
  "triggerSchema": {
    "type": "object",
    "required": ["request"],
    "properties": {
      "request": { "type": "string" },
      "repoUrl": { "type": "string" }
    }
  },
  "nodes": [
    {
      "id": "map",
      "type": "agent-task",
      "config": {
        "role": "researcher",
        "task": "Map the codebase and product context for {{request}} in {{repoUrl}}. Return relevant files, existing patterns, and unknowns."
      },
      "next": ["options"]
    },
    {
      "id": "options",
      "type": "agent-task",
      "inputs": { "map": "map" },
      "config": {
        "role": "reviewer",
        "task": "Produce 2-3 implementation options with tradeoffs, risk, and recommended next step."
      }
    }
  ]
}
```
