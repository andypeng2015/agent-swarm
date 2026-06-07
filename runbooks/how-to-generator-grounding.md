# how-to-generator-with-schema grounding guardrail

The weekly `sunday-how-to-generator-dispatcher` schedule feeds the
`how-to-generator-with-schema` workflow from `content-state.discovery_topics`.
The generator can safely produce generic procedural topics such as
`how to test an mcp server in ci`, but it cannot infer first-person company
narratives such as `how we made mcp development feel good` unless real source
material is supplied.

## Guardrail

Apply both layers:

1. Dispatcher selection must skip self-referential first-person topics unless
   the dispatcher also passes explicit grounding sources.
2. The workflow must fail before outline generation when `topic` is
   self-referential. This protects manual triggers and stale dispatchers.

The detector lives in `src/content/how-to-grounding.ts`. The SQL predicate for
`content-state.discovery_topics` is exported as
`DISCOVERY_TOPIC_GROUNDING_SQL_PREDICATE`.

## Dispatcher SQL

Add the predicate to both the preferred how-to query and fallback query:

```sql
SELECT id, bucket, phrase, source, fetched_at
FROM discovery_topics
WHERE dispatched_at IS NULL
  AND bucket = 'how-to'
  AND NOT (
    lower(phrase) GLOB 'how we *'
    OR lower(phrase) GLOB 'how i *'
    OR lower(phrase) GLOB 'how our *'
    OR lower(phrase) GLOB 'how my *'
    OR lower(phrase) GLOB 'why we *'
    OR lower(phrase) GLOB 'why our *'
    OR lower(phrase) GLOB 'what we *'
    OR lower(phrase) GLOB 'what our *'
    OR lower(phrase) GLOB '* our team *'
    OR lower(phrase) GLOB '* our workflow *'
    OR lower(phrase) GLOB '* our stack *'
    OR lower(phrase) GLOB '* our setup *'
    OR lower(phrase) GLOB '* our process *'
    OR lower(phrase) GLOB '* our pipeline *'
    OR lower(phrase) GLOB '* our full setup *'
    OR lower(phrase) GLOB '* our exact setup *'
  )
ORDER BY rank ASC, created_at ASC
LIMIT 1;
```

If the filtered query returns no rows, do not unfilter just to keep the cadence.
Post a Slack warning and complete without triggering the workflow.

## Workflow guard

The current production stance is conservative: first-person topics are rejected
before outline generation, because the workflow does not yet have a source
retrieval/citation step. If source-backed first-person pages become necessary,
add `groundingSources` to the trigger payload and use
`shouldRejectUngroundedHowToTopic` as the admission check; the outline, render,
and litmus prompts must then require every first-person factual claim to trace
back to those sources.

Suggested rejection message:

```text
ERROR: self-referential how-to topics require real source material and are not
generated from topic text alone.
```
