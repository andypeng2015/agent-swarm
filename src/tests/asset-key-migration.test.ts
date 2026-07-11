import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { closeDb, createTaskExtended, createUser, getDb, initDb } from "../be/db";

const FRESH_DB = "./test-asset-key-migration-fresh.sqlite";
const HISTORICAL_DB = "./test-asset-key-migration-historical.sqlite";
const LEGACY_STATUS_DB = "./test-asset-key-migration-legacy-status.sqlite";

const globals = globalThis as typeof globalThis & {
  __testMigrationTemplate?: Uint8Array;
  __savedAssetKeyTemplate?: Uint8Array;
};

async function removeDb(path: string): Promise<void> {
  for (const suffix of ["", "-wal", "-shm"]) {
    try {
      await Bun.file(`${path}${suffix}`).delete();
    } catch {}
  }
}

function dropMigration115ForHistoricalFixture(): void {
  const db = getDb();
  const triggers = db
    .prepare<{ name: string }, []>(
      `SELECT name FROM sqlite_master
       WHERE type = 'trigger'
         AND (name LIKE 'validate_%asset_key%' OR name = 'detach_asset_key_mapping_before_attachment_delete')`,
    )
    .all();
  for (const trigger of triggers) db.run(`DROP TRIGGER "${trigger.name}"`);
  for (const index of [
    "idx_agent_tasks_asset_key",
    "idx_workflows_asset_key",
    "idx_scheduled_tasks_asset_key",
    "idx_pages_asset_key",
  ]) {
    db.run(`DROP INDEX IF EXISTS "${index}"`);
  }
  db.run("DROP TABLE asset_key_history");
  db.run("DROP TABLE asset_key_mappings");
  for (const table of ["agent_tasks", "workflows", "scheduled_tasks", "pages"]) {
    db.run(`ALTER TABLE "${table}" DROP COLUMN "key"`);
  }
  db.run("DELETE FROM _migrations WHERE version = 115");
}

beforeAll(async () => {
  globals.__savedAssetKeyTemplate = globals.__testMigrationTemplate;
  globals.__testMigrationTemplate = undefined;
  closeDb();
  await removeDb(FRESH_DB);
  await removeDb(HISTORICAL_DB);
  await removeDb(LEGACY_STATUS_DB);
  initDb(FRESH_DB);
});

afterAll(async () => {
  closeDb();
  globals.__testMigrationTemplate = globals.__savedAssetKeyTemplate;
  globals.__savedAssetKeyTemplate = undefined;
  await removeDb(FRESH_DB);
  await removeDb(HISTORICAL_DB);
  await removeDb(LEGACY_STATUS_DB);
});

describe("migration 115 asset namespace keys", () => {
  test("fresh schema has mandatory defaults, non-unique indexes, triggers, and mapping tables", () => {
    for (const table of ["agent_tasks", "workflows", "scheduled_tasks", "pages"]) {
      const column = getDb()
        .prepare<{ name: string; notnull: number; dflt_value: string | null }, []>(
          `PRAGMA table_info("${table}")`,
        )
        .all()
        .find((row) => row.name === "key");
      expect(column?.notnull).toBe(1);
      expect(column?.dflt_value).toBe("'shared/'");
    }

    const indexes = new Set(
      getDb()
        .prepare<{ name: string }, []>(
          "SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE '%asset_key%'",
        )
        .all()
        .map((row) => row.name),
    );
    for (const index of [
      "idx_agent_tasks_asset_key",
      "idx_workflows_asset_key",
      "idx_scheduled_tasks_asset_key",
      "idx_pages_asset_key",
    ]) {
      expect(indexes.has(index)).toBe(true);
    }
    expect(
      getDb()
        .prepare<{ count: number }, []>(
          "SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'trigger' AND name LIKE 'validate_%asset_key%'",
        )
        .get()?.count,
    ).toBeGreaterThanOrEqual(8);
    for (const table of ["asset_key_mappings", "asset_key_history"]) {
      expect(
        getDb()
          .prepare<{ present: number }, [string]>(
            "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?) AS present",
          )
          .get(table)?.present,
      ).toBe(1);
    }
  });

  test("old insert statements may omit key and repeated shared namespaces are valid", () => {
    const now = new Date().toISOString();
    const taskId = crypto.randomUUID();
    getDb().run(
      `INSERT INTO agent_tasks (id, task, status, source, createdAt, lastUpdatedAt)
       VALUES (?, 'legacy task', 'unassigned', 'api', ?, ?)`,
      [taskId, now, now],
    );
    getDb().run(
      `INSERT INTO workflows (id, name, definition, triggers, createdAt, lastUpdatedAt)
       VALUES (?, 'legacy workflow', '{"nodes":[]}', '[]', ?, ?)`,
      [crypto.randomUUID(), now, now],
    );
    getDb().run(
      `INSERT INTO scheduled_tasks (id, name, taskTemplate, intervalMs, createdAt, lastUpdatedAt)
       VALUES (?, 'legacy schedule', 'work', 60000, ?, ?)`,
      [crypto.randomUUID(), now, now],
    );
    getDb().run(
      `INSERT INTO pages (agentId, slug, title, contentType, authMode, body)
       VALUES ('legacy-agent', 'legacy-page', 'Legacy page', 'text/html', 'authed', '<p>ok</p>')`,
    );

    for (const table of ["agent_tasks", "workflows", "scheduled_tasks", "pages"]) {
      const count = getDb()
        .prepare<{ count: number }, []>(
          `SELECT COUNT(*) AS count FROM "${table}" WHERE "key" = 'shared/'`,
        )
        .get()?.count;
      expect(count).toBeGreaterThan(0);
    }
  });

  test("triggers reject malformed and unknown-personal keys but allow an existing personal user", () => {
    const taskId = getDb()
      .prepare<{ id: string }, []>("SELECT id FROM agent_tasks LIMIT 1")
      .get()!.id;
    for (const key of ["", "shared", "shared//bad/", "shared/../bad/", "Shared/", "other/"]) {
      expect(() =>
        getDb().run('UPDATE agent_tasks SET "key" = ? WHERE id = ?', [key, taskId]),
      ).toThrow();
    }
    expect(() =>
      getDb().run('UPDATE agent_tasks SET "key" = ? WHERE id = ?', [
        "personal/missing/drafts/",
        taskId,
      ]),
    ).toThrow();

    const user = createUser({ name: "Migration User", email: "migration@example.com" });
    expect(() =>
      getDb().run('UPDATE agent_tasks SET "key" = ? WHERE id = ?', [
        `personal/${user.id}/drafts/`,
        taskId,
      ]),
    ).not.toThrow();
  });

  test("upgrades a historical database, backfills attachment mappings, and is repeatable", async () => {
    closeDb();
    initDb(HISTORICAL_DB);
    dropMigration115ForHistoricalFixture();

    const now = new Date().toISOString();
    const taskId = crypto.randomUUID();
    const attachmentId = crypto.randomUUID();
    getDb().run(
      `INSERT INTO agent_tasks (id, task, status, source, createdAt, lastUpdatedAt)
       VALUES (?, 'historical task', 'unassigned', 'api', ?, ?)`,
      [taskId, now, now],
    );
    getDb().run(
      `INSERT INTO task_attachments
         (id, task_id, name, kind, path, provider_id, provider_key, agent_fs_org_id, agent_fs_drive_id)
       VALUES (?, ?, 'artifact.md', 'agent-fs', 'reports/artifact.md', 'agent-fs',
               'reports/artifact.md', 'org', 'drive')`,
      [attachmentId, taskId],
    );
    closeDb();

    initDb(HISTORICAL_DB);
    expect(getDb().query('SELECT "key" FROM agent_tasks WHERE id = ?').get(taskId)).toEqual({
      key: "shared/",
    });
    expect(
      getDb()
        .prepare<{ key: string; source_entity_id: string }, [string]>(
          'SELECT "key" AS key, source_entity_id FROM asset_key_mappings WHERE provider_key = ?',
        )
        .get("reports/artifact.md"),
    ).toEqual({ key: "shared/", source_entity_id: attachmentId });

    closeDb();
    expect(() => initDb(HISTORICAL_DB)).not.toThrow();
    expect(
      getDb()
        .prepare<{ count: number }, []>(
          "SELECT COUNT(*) AS count FROM _migrations WHERE version = 115",
        )
        .get()?.count,
    ).toBe(1);
  });

  test("preserves asset keys when upgrading a legacy restrictive task status schema", () => {
    closeDb();
    initDb(LEGACY_STATUS_DB);
    dropMigration115ForHistoricalFixture();

    const schema = getDb()
      .prepare<{ sql: string }, []>(
        "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'agent_tasks'",
      )
      .get()!.sql;
    const restrictiveSchema = schema
      .replace(
        /^(CREATE TABLE\s+(?:IF NOT EXISTS\s+)?)(?:"agent_tasks"|agent_tasks)/i,
        "$1agent_tasks_restrictive",
      )
      .replace(
        /status TEXT NOT NULL DEFAULT 'pending'/,
        "status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','in_progress','completed','failed'))",
      );
    expect(restrictiveSchema).not.toBe(schema);
    const columns = getDb()
      .prepare<{ name: string }, []>('PRAGMA table_info("agent_tasks")')
      .all()
      .map((column) => `"${column.name}"`)
      .join(", ");
    const schemaObjects = getDb()
      .prepare<{ sql: string }, []>(
        `SELECT sql FROM sqlite_master
         WHERE tbl_name = 'agent_tasks'
           AND type IN ('index', 'trigger')
           AND sql IS NOT NULL`,
      )
      .all()
      .map((row) => row.sql);
    getDb().run("PRAGMA foreign_keys = OFF");
    getDb().transaction(() => {
      getDb().run(restrictiveSchema);
      getDb().run(
        `INSERT INTO agent_tasks_restrictive (${columns}) SELECT ${columns} FROM agent_tasks`,
      );
      getDb().run("DROP TABLE agent_tasks");
      getDb().run("ALTER TABLE agent_tasks_restrictive RENAME TO agent_tasks");
      for (const sql of schemaObjects) getDb().run(sql);
    })();
    getDb().run("PRAGMA foreign_keys = ON");

    const taskId = crypto.randomUUID();
    const now = new Date().toISOString();
    const user = createUser({ name: "Legacy Task Owner", email: "legacy-task@example.com" });
    getDb().run(
      `INSERT INTO agent_tasks (
         id, task, status, source, createdAt, lastUpdatedAt,
         vcsProvider, vcsRepo, dir, outputSchema, requestedByUserId,
         contextKey, modelTier, effort, routingAffinity, created_by, updated_by
       ) VALUES (
         ?, 'legacy restrictive task', 'pending', 'api', ?, ?,
         'github', 'example/repo', '/workspace/example', '{"type":"object"}', ?,
         'task:legacy:thread', 'smart', 'high', '{"capabilities":["coding"]}', ?, ?
       )`,
      [taskId, now, now, user.id, user.id, user.id],
    );

    closeDb();

    expect(() => initDb(LEGACY_STATUS_DB)).not.toThrow();
    expect(getDb().query('SELECT "key" FROM agent_tasks WHERE id = ?').get(taskId)).toEqual({
      key: "shared/",
    });
    expect(
      getDb()
        .prepare<
          {
            vcsProvider: string;
            dir: string;
            requestedByUserId: string;
            modelTier: string;
            effort: string;
            routingAffinity: string;
          },
          [string]
        >(
          `SELECT vcsProvider, dir, requestedByUserId, modelTier, effort, routingAffinity
           FROM agent_tasks WHERE id = ?`,
        )
        .get(taskId),
    ).toEqual({
      vcsProvider: "github",
      dir: "/workspace/example",
      requestedByUserId: user.id,
      modelTier: "smart",
      effort: "high",
      routingAffinity: '{"capabilities":["coding"]}',
    });
    expect(
      getDb()
        .prepare<{ count: number }, []>(
          `SELECT COUNT(*) AS count FROM sqlite_master
           WHERE type = 'index' AND name = 'idx_agent_tasks_asset_key'`,
        )
        .get()?.count,
    ).toBe(1);
    expect(() =>
      getDb().run('UPDATE agent_tasks SET "key" = ? WHERE id = ?', ["INVALID", taskId]),
    ).toThrow("invalid asset namespace key");
    const createdAfterUpgrade = createTaskExtended("post-upgrade task");
    expect(createdAfterUpgrade.key).toBe(`shared/task:${createdAfterUpgrade.id}/`);
  });

  test("startup audit fails closed on structural corruption", () => {
    closeDb();
    initDb(HISTORICAL_DB);
    const taskId = getDb()
      .prepare<{ id: string }, []>("SELECT id FROM agent_tasks LIMIT 1")
      .get()!.id;
    getDb().run("DROP TRIGGER validate_agent_tasks_asset_key_update");
    getDb().run('UPDATE agent_tasks SET "key" = ? WHERE id = ?', ["INVALID", taskId]);
    closeDb();
    expect(() => initDb(HISTORICAL_DB)).toThrow("structurally invalid");
    closeDb();
  });
});
