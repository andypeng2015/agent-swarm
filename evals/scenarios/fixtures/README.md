# SQL-dump fixtures (`scenario.seed.sqlDump`)

Fixtures referenced by `scenario.seed.sqlDump` live here as **full SQLite text
dumps** (`sqlite3 <db> .dump > fixture.sql`) — reviewable in git, carrying
schema + data + the `_migrations` table. The runner imports the dump into the
API sandbox's DB (`/app/data/agent-swarm-db.sqlite`) **before** the API server
first boots, so forward-only migrations apply any missing steps on top and
boot-time caches see the seeded rows.

## Rules

- **Full dumps only.** The runner rejects (fail-fast, pre-sandbox) any fixture
  missing the `_migrations` CREATE TABLE **and** its INSERT rows — a dump with
  tables but no `_migrations` history would make the migration bootstrapper
  re-apply migrations onto already-migrated tables at first boot.
- **Seed reference data only** (historical tasks, scripts, pricing, workflows).
  Do NOT seed live operational state:
  - no `agents` rows — workers self-register at boot; a pre-seeded agent row
    with a colliding ID would be silently reused;
  - no in-flight tasks — `pending`/`running` rows would be claimed by the
    booting worker;
  - no sessions or locks.
- **No hand-seeded `agent_memory` rows** — embeddings live in a sqlite-vec
  virtual table whose dumps are not portable. Use `scenario.seed.memories`
  (indexed via the memory API, embedded server-side) instead.
- Dumps **older** than the image are safe (forward-only migrations apply the
  rest at boot). Dumps **newer** than the image (created on a later branch) are
  NOT supported — regenerate against `main`'s migration set.
- Keep fixtures **< 1 MB** where possible; the runner enforces a **5 MB** hard
  cap. Fixtures are reference data, not prod DBs.
- Filenames are bare (`name.sql`, no path separators) — enforced by
  `validateScenario` at registry load.

## Regenerating a fixture

Commit a regenerated fixture alongside any scenario change that needs new data.
From the repo root:

```bash
rm -f /tmp/fixture-src.sqlite
DATABASE_PATH=/tmp/fixture-src.sqlite PORT=3961 \
  SLACK_DISABLE=true GITHUB_DISABLE=true JIRA_DISABLE=true LINEAR_DISABLE=true \
  bun run start:http          # fresh DB, migrations + seeds apply
# ... curl the API to create the reference rows you need ...
# (stop the server cleanly, then:)
sqlite3 /tmp/fixture-src.sqlite .dump > evals/scenarios/fixtures/<name>.sql
```

## Fixtures

| File | Used by | Contents |
|---|---|---|
| `seeded-history.sql` | `sql-seeded-history` | Full dump of a fresh dev DB (v1.94.0 migration set) plus exactly one completed, unassigned historical task titled "Calibrate the flux capacitor". Built with the recipe above: task created via `POST /api/tasks`, completed via a direct status/output update before dumping. |
