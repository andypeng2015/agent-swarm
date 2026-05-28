# Daily Workflow Health Audit

Use this when workflows and recurring tasks are part of normal operations.

```json
{
  "name": "Daily workflow health audit",
  "cron": "15 8 * * 1-5",
  "timezone": "{{TIMEZONE}}",
  "agentRole": "lead",
  "enabled": true,
  "slackChannelId": "{{SLACK_CHANNEL_ID}}",
  "task": "Inspect recent scheduled task and workflow runs. Flag failing, stale, duplicated, or noisy automation. For each issue, include impact, likely cause, and whether to retry, disable, fix, or escalate."
}
```
