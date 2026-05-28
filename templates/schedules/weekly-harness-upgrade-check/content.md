# Weekly Harness Upgrade Check

Use this to keep agent runtimes and provider CLIs current without surprise breakage.

```json
{
  "name": "Weekly harness upgrade check",
  "cron": "30 10 * * 2",
  "timezone": "{{TIMEZONE}}",
  "agentRole": "lead",
  "enabled": true,
  "slackChannelId": "{{SLACK_CHANNEL_ID}}",
  "task": "Check release notes for the agent harnesses, model providers, and key CLIs used by this swarm. Summarize relevant changes, risks, and recommended upgrade tests. Create follow-up implementation tasks only for actionable upgrades."
}
```
