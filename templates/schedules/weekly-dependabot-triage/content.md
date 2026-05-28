# Weekly Dependency Triage

Use this for repositories with automated dependency PRs.

```json
{
  "name": "Weekly dependency triage",
  "cron": "0 10 * * 1",
  "timezone": "{{TIMEZONE}}",
  "agentRole": "lead",
  "enabled": true,
  "slackChannelId": "{{SLACK_CHANNEL_ID}}",
  "task": "Review dependency update PRs for {{REPO_URL}}. Group low-risk patch/minor updates, call out major upgrades requiring human review, and propose a merge order. Do not merge unless explicitly authorized."
}
```
