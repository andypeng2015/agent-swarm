# Swarm Script Node Demo

Use this as a minimal example for reusable script catalog nodes.

```json
{
  "name": "Swarm script node demo",
  "description": "Run a catalog script and summarize the result.",
  "triggerSchema": {
    "type": "object",
    "required": ["topic"],
    "properties": {
      "topic": { "type": "string" }
    }
  },
  "nodes": [
    {
      "id": "collect",
      "type": "swarm-script",
      "config": {
        "scriptName": "example-fetch-context",
        "input": { "topic": "{{topic}}" }
      },
      "next": ["summarize"]
    },
    {
      "id": "summarize",
      "type": "agent-task",
      "inputs": { "context": "collect" },
      "config": {
        "role": "researcher",
        "task": "Summarize the script result for {{topic}} and explain how downstream workflow nodes can use it."
      }
    }
  ]
}
```
