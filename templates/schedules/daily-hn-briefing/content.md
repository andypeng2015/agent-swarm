# Daily Hacker News Briefing

Use this as a lightweight demo of research plus reporting.

```json
{
  "name": "Daily HN briefing",
  "cron": "0 8 * * 1-5",
  "timezone": "{{TIMEZONE}}",
  "agentRole": "researcher",
  "enabled": false,
  "slackChannelId": "{{SLACK_CHANNEL_ID}}",
  "task": "Review current technology discussions on Hacker News. Summarize five items relevant to software teams, why they matter, and any follow-up reading. Keep it factual and include source links."
}
```
