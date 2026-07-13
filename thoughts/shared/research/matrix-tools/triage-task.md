# Operations triage digest

You are the lead responsible for producing one verified operations-triage digest. Coordinate the work yourself and do not ask a human for input.

Inspect the live swarm state and verify every item before reporting:

1. Find enabled schedules with repeated errors. Report the broken schedule names, and separately report enabled healthy schedules that you verified have no consecutive errors.
2. Inspect recent failed tasks. Cluster recurring failures using their `failureReason` and tags; report each cluster's identifying token and exact task count.
3. Inspect in-flight tasks. Report only task IDs that have been `in_progress` for more than two hours since their last update.

Return JSON only, exactly matching the task's output schema. Do not include Markdown, commentary, Slack messages, channel IDs, or extra keys. Use `OK` only when no defects are present; otherwise use `WATCH` or `ALERT`.
