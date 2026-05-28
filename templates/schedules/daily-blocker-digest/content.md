# Daily Blocker Digest

Use this schedule to keep the swarm honest about stalled work.

```json
{
  "name": "Daily blocker digest",
  "cron": "0 9 * * 1-5",
  "timezone": "{{TIMEZONE}}",
  "agentRole": "lead",
  "enabled": true,
  "slackChannelId": "{{SLACK_CHANNEL_ID}}",
  "task": "Review active tasks, open PRs, and recent failures. Post a concise blocker digest with: blocked item, current owner, missing decision or failing check, and the next action needed today. Keep it generic and avoid private customer data."
}
```
