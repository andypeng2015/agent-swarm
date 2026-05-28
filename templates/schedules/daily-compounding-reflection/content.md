# Daily Compounding Reflection

Use this to turn repeated work into reusable swarm knowledge.

```json
{
  "name": "Daily compounding reflection",
  "cron": "30 17 * * 1-5",
  "timezone": "{{TIMEZONE}}",
  "agentRole": "lead",
  "enabled": true,
  "slackChannelId": "{{SLACK_CHANNEL_ID}}",
  "task": "Review completed and failed tasks from the last day. Identify one reusable lesson, one missing or stale skill, and one workflow improvement. Save durable learnings to memory and post a short summary with links."
}
```
