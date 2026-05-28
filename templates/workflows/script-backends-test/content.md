# Script Backends Test

Use this as a smoke test after enabling multiple script backends.

```json
{
  "name": "Script backends test",
  "description": "Verify script backends and summarize results.",
  "triggerSchema": {
    "type": "object",
    "properties": {
      "message": { "type": "string" }
    }
  },
  "nodes": [
    {
      "id": "typescript",
      "type": "swarm-script",
      "config": { "scriptName": "echo-typescript", "input": { "message": "{{message}}" } },
      "next": ["python", "shell"]
    },
    {
      "id": "python",
      "type": "swarm-script",
      "config": { "scriptName": "echo-python", "input": { "message": "{{message}}" } }
    },
    {
      "id": "shell",
      "type": "swarm-script",
      "config": { "scriptName": "echo-shell", "input": { "message": "{{message}}" } }
    }
  ]
}
```
