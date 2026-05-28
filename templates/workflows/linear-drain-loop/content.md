# Linear Drain Loop

Use this for generic issue tracker grooming and implementation handoff.

```json
{
  "name": "Linear drain loop",
  "description": "Drain ready child issues from a parent issue.",
  "triggerSchema": {
    "type": "object",
    "required": ["parentIssueKey"],
    "properties": {
      "parentIssueKey": { "type": "string" },
      "projectId": { "type": "string" },
      "repoUrl": { "type": "string" }
    }
  },
  "nodes": [
    {
      "id": "triage",
      "type": "agent-task",
      "config": {
        "role": "lead",
        "task": "Review child issues under {{parentIssueKey}} in project {{projectId}}. Identify ready, blocked, duplicate, and needs-human-decision items."
      },
      "next": ["dispatch"]
    },
    {
      "id": "dispatch",
      "type": "agent-task",
      "inputs": { "triage": "triage" },
      "config": {
        "role": "lead",
        "task": "For ready items only, create or assign implementation tasks against {{repoUrl}}. Leave a tracker comment summarizing what was dispatched."
      }
    }
  ]
}
```
