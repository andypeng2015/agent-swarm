# Weekly GTM Metrics Review

Use this when the swarm has access to generic analytics or CRM exports.

```json
{
  "name": "Weekly GTM metrics review",
  "cron": "0 14 * * 5",
  "timezone": "{{TIMEZONE}}",
  "agentRole": "analyst",
  "enabled": false,
  "slackChannelId": "{{SLACK_CHANNEL_ID}}",
  "task": "Prepare a weekly GTM review from the available analytics sources. Include top wins, regressions, anomalous changes, and three recommended next actions. Use placeholders or skip sections when data sources are not configured."
}
```
