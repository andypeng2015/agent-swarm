# Iterative Review Loop

Use this for bounded iteration on a task with explicit stop conditions.

```json
{
  "name": "Iterative review loop",
  "description": "Implement, review, and revise until accepted or blocked.",
  "triggerSchema": {
    "type": "object",
    "required": ["task"],
    "properties": {
      "task": { "type": "string" },
      "repoUrl": { "type": "string" },
      "maxIterations": { "type": "number" }
    }
  },
  "nodes": [
    {
      "id": "implement",
      "type": "agent-task",
      "config": {
        "role": "coder",
        "task": "Implement this task in {{repoUrl}}: {{task}}. Run focused checks and report the diff."
      },
      "next": ["review"]
    },
    {
      "id": "review",
      "type": "agent-task",
      "inputs": { "implementation": "implement" },
      "config": {
        "role": "reviewer",
        "task": "Review the implementation. Return PASS when ready, otherwise list blocking fixes only."
      }
    }
  ]
}
```
