# Scheduled Task Resilience

Use this skill for scheduled tasks, CI waits, browser scrapes, deploys, and any wait or poll loop.

Rules:

1. Prefer bounded polling with a clear timeout.
2. Emit progress before long waits and at meaningful milestones.
3. Persist enough state to resume without duplicating side effects.
4. Do not hold a session idle for long periods if the platform has a scheduling or wakeup mechanism.
5. Make completion idempotent: repeated wakeups should not double-post, double-merge, or double-charge.
6. If the same external blocker repeats, escalate with the exact blocker and evidence.
