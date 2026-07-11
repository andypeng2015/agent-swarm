-- Canonical, non-unique namespace keys for primary swarm assets.
--
-- IDs remain entity identity. `key` is only a directory-like grouping label;
-- many assets intentionally share `shared/` (or any other valid subtree).
-- The SQL default is a rollback guard: older binaries can omit the new column
-- and still create rows that satisfy the v1 namespace contract.

ALTER TABLE agent_tasks ADD COLUMN "key" TEXT NOT NULL DEFAULT 'shared/';
ALTER TABLE workflows ADD COLUMN "key" TEXT NOT NULL DEFAULT 'shared/';
ALTER TABLE scheduled_tasks ADD COLUMN "key" TEXT NOT NULL DEFAULT 'shared/';
ALTER TABLE pages ADD COLUMN "key" TEXT NOT NULL DEFAULT 'shared/';

-- Defensive normalization for legacy/partially-provisioned databases. Fresh
-- rows receive the SQL default, but keeping this explicit makes the migration
-- safe if a database already carried an anomalous compatibility column.
UPDATE agent_tasks SET "key" = 'shared/' WHERE "key" IS NULL OR trim("key") = '';
UPDATE workflows SET "key" = 'shared/' WHERE "key" IS NULL OR trim("key") = '';
UPDATE scheduled_tasks SET "key" = 'shared/' WHERE "key" IS NULL OR trim("key") = '';
UPDATE pages SET "key" = 'shared/' WHERE "key" IS NULL OR trim("key") = '';

CREATE INDEX idx_agent_tasks_asset_key ON agent_tasks("key");
CREATE INDEX idx_workflows_asset_key ON workflows("key");
CREATE INDEX idx_scheduled_tasks_asset_key ON scheduled_tasks("key");
CREATE INDEX idx_pages_asset_key ON pages("key");

-- Physical provider addresses remain unchanged. This table projects each
-- provider tuple into a logical swarm namespace. Empty org/drive components
-- are canonical stand-ins for providers that do not expose those dimensions,
-- which makes the full tuple reliably unique in SQLite.
CREATE TABLE asset_key_mappings (
  id                  TEXT PRIMARY KEY,
  provider_id         TEXT NOT NULL,
  provider_org_id     TEXT NOT NULL DEFAULT '',
  provider_drive_id   TEXT NOT NULL DEFAULT '',
  provider_key        TEXT NOT NULL,
  "key"               TEXT NOT NULL DEFAULT 'shared/',
  source_entity_type  TEXT CHECK (source_entity_type IN ('task-attachment', 'external')),
  source_entity_id    TEXT,
  created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  created_by          TEXT REFERENCES users(id),
  updated_by          TEXT REFERENCES users(id),
  UNIQUE (provider_id, provider_org_id, provider_drive_id, provider_key)
);

CREATE INDEX idx_asset_key_mappings_key ON asset_key_mappings("key");
CREATE INDEX idx_asset_key_mappings_source
  ON asset_key_mappings(source_entity_type, source_entity_id);

-- A compact append-only move trail. Content remains in the entity/provider
-- tables; this records only identifiers, namespace transitions, and actor.
CREATE TABLE asset_key_history (
  id           TEXT PRIMARY KEY,
  entity_type  TEXT NOT NULL CHECK (entity_type IN ('task', 'workflow', 'schedule', 'page', 'file')),
  entity_id    TEXT NOT NULL,
  previous_key TEXT,
  new_key      TEXT NOT NULL,
  changed_by   TEXT REFERENCES users(id),
  changed_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX idx_asset_key_history_entity
  ON asset_key_history(entity_type, entity_id, changed_at DESC);

-- Existing agent-fs pointers inherit their parent task namespace. No provider
-- API is called and no physical file is renamed or copied.
INSERT OR IGNORE INTO asset_key_mappings (
  id,
  provider_id,
  provider_org_id,
  provider_drive_id,
  provider_key,
  "key",
  source_entity_type,
  source_entity_id,
  created_at,
  updated_at,
  created_by,
  updated_by
)
SELECT
  lower(hex(randomblob(16))),
  COALESCE(NULLIF(a.provider_id, ''), 'agent-fs'),
  COALESCE(a.agent_fs_org_id, ''),
  COALESCE(a.agent_fs_drive_id, ''),
  COALESCE(NULLIF(a.provider_key, ''), a.path),
  t."key",
  'task-attachment',
  a.id,
  a.created_at,
  a.created_at,
  a.created_by,
  COALESCE(a.updated_by, a.created_by)
FROM task_attachments a
JOIN agent_tasks t ON t.id = a.task_id
WHERE a.kind = 'agent-fs'
  AND COALESCE(NULLIF(a.provider_key, ''), a.path) IS NOT NULL;

-- SQLite cannot express NFKC in a CHECK constraint. Runtime schemas enforce
-- full Unicode normalization; these triggers fail closed on every structural
-- property SQLite can validate and on unknown personal user roots.

CREATE TRIGGER validate_agent_tasks_asset_key_insert
BEFORE INSERT ON agent_tasks
WHEN NEW."key" IS NULL
  OR length(NEW."key") = 0
  OR NEW."key" != trim(NEW."key")
  OR length(NEW."key") > 255
  OR substr(NEW."key", -1, 1) != '/'
  OR instr(NEW."key", char(0)) > 0
  OR instr(NEW."key", char(92)) > 0
  OR instr(NEW."key", '//') > 0
  OR instr(NEW."key", '/../') > 0
  OR instr(NEW."key", '/./') > 0
  OR NEW."key" != lower(NEW."key")
  OR NOT (
    NEW."key" = 'shared/'
    OR NEW."key" LIKE 'shared/%'
    OR (
      NEW."key" LIKE 'personal/%/%'
      AND EXISTS (
        SELECT 1 FROM users
        WHERE id = substr(NEW."key", 10, instr(substr(NEW."key", 10), '/') - 1)
      )
    )
  )
BEGIN
  SELECT RAISE(ABORT, 'invalid asset namespace key');
END;

CREATE TRIGGER validate_agent_tasks_asset_key_update
BEFORE UPDATE OF "key" ON agent_tasks
WHEN NEW."key" IS NULL
  OR length(NEW."key") = 0
  OR NEW."key" != trim(NEW."key")
  OR length(NEW."key") > 255
  OR substr(NEW."key", -1, 1) != '/'
  OR instr(NEW."key", char(0)) > 0
  OR instr(NEW."key", char(92)) > 0
  OR instr(NEW."key", '//') > 0
  OR instr(NEW."key", '/../') > 0
  OR instr(NEW."key", '/./') > 0
  OR NEW."key" != lower(NEW."key")
  OR NOT (
    NEW."key" = 'shared/'
    OR NEW."key" LIKE 'shared/%'
    OR (
      NEW."key" LIKE 'personal/%/%'
      AND EXISTS (
        SELECT 1 FROM users
        WHERE id = substr(NEW."key", 10, instr(substr(NEW."key", 10), '/') - 1)
      )
    )
  )
BEGIN
  SELECT RAISE(ABORT, 'invalid asset namespace key');
END;

CREATE TRIGGER validate_workflows_asset_key_insert
BEFORE INSERT ON workflows
WHEN NEW."key" IS NULL
  OR length(NEW."key") = 0
  OR NEW."key" != trim(NEW."key")
  OR length(NEW."key") > 255
  OR substr(NEW."key", -1, 1) != '/'
  OR instr(NEW."key", char(0)) > 0
  OR instr(NEW."key", char(92)) > 0
  OR instr(NEW."key", '//') > 0
  OR instr(NEW."key", '/../') > 0
  OR instr(NEW."key", '/./') > 0
  OR NEW."key" != lower(NEW."key")
  OR NOT (
    NEW."key" = 'shared/'
    OR NEW."key" LIKE 'shared/%'
    OR (
      NEW."key" LIKE 'personal/%/%'
      AND EXISTS (
        SELECT 1 FROM users
        WHERE id = substr(NEW."key", 10, instr(substr(NEW."key", 10), '/') - 1)
      )
    )
  )
BEGIN
  SELECT RAISE(ABORT, 'invalid asset namespace key');
END;

CREATE TRIGGER validate_workflows_asset_key_update
BEFORE UPDATE OF "key" ON workflows
WHEN NEW."key" IS NULL
  OR length(NEW."key") = 0
  OR NEW."key" != trim(NEW."key")
  OR length(NEW."key") > 255
  OR substr(NEW."key", -1, 1) != '/'
  OR instr(NEW."key", char(0)) > 0
  OR instr(NEW."key", char(92)) > 0
  OR instr(NEW."key", '//') > 0
  OR instr(NEW."key", '/../') > 0
  OR instr(NEW."key", '/./') > 0
  OR NEW."key" != lower(NEW."key")
  OR NOT (
    NEW."key" = 'shared/'
    OR NEW."key" LIKE 'shared/%'
    OR (
      NEW."key" LIKE 'personal/%/%'
      AND EXISTS (
        SELECT 1 FROM users
        WHERE id = substr(NEW."key", 10, instr(substr(NEW."key", 10), '/') - 1)
      )
    )
  )
BEGIN
  SELECT RAISE(ABORT, 'invalid asset namespace key');
END;

CREATE TRIGGER validate_scheduled_tasks_asset_key_insert
BEFORE INSERT ON scheduled_tasks
WHEN NEW."key" IS NULL
  OR length(NEW."key") = 0
  OR NEW."key" != trim(NEW."key")
  OR length(NEW."key") > 255
  OR substr(NEW."key", -1, 1) != '/'
  OR instr(NEW."key", char(0)) > 0
  OR instr(NEW."key", char(92)) > 0
  OR instr(NEW."key", '//') > 0
  OR instr(NEW."key", '/../') > 0
  OR instr(NEW."key", '/./') > 0
  OR NEW."key" != lower(NEW."key")
  OR NOT (
    NEW."key" = 'shared/'
    OR NEW."key" LIKE 'shared/%'
    OR (
      NEW."key" LIKE 'personal/%/%'
      AND EXISTS (
        SELECT 1 FROM users
        WHERE id = substr(NEW."key", 10, instr(substr(NEW."key", 10), '/') - 1)
      )
    )
  )
BEGIN
  SELECT RAISE(ABORT, 'invalid asset namespace key');
END;

CREATE TRIGGER validate_scheduled_tasks_asset_key_update
BEFORE UPDATE OF "key" ON scheduled_tasks
WHEN NEW."key" IS NULL
  OR length(NEW."key") = 0
  OR NEW."key" != trim(NEW."key")
  OR length(NEW."key") > 255
  OR substr(NEW."key", -1, 1) != '/'
  OR instr(NEW."key", char(0)) > 0
  OR instr(NEW."key", char(92)) > 0
  OR instr(NEW."key", '//') > 0
  OR instr(NEW."key", '/../') > 0
  OR instr(NEW."key", '/./') > 0
  OR NEW."key" != lower(NEW."key")
  OR NOT (
    NEW."key" = 'shared/'
    OR NEW."key" LIKE 'shared/%'
    OR (
      NEW."key" LIKE 'personal/%/%'
      AND EXISTS (
        SELECT 1 FROM users
        WHERE id = substr(NEW."key", 10, instr(substr(NEW."key", 10), '/') - 1)
      )
    )
  )
BEGIN
  SELECT RAISE(ABORT, 'invalid asset namespace key');
END;

CREATE TRIGGER validate_pages_asset_key_insert
BEFORE INSERT ON pages
WHEN NEW."key" IS NULL
  OR length(NEW."key") = 0
  OR NEW."key" != trim(NEW."key")
  OR length(NEW."key") > 255
  OR substr(NEW."key", -1, 1) != '/'
  OR instr(NEW."key", char(0)) > 0
  OR instr(NEW."key", char(92)) > 0
  OR instr(NEW."key", '//') > 0
  OR instr(NEW."key", '/../') > 0
  OR instr(NEW."key", '/./') > 0
  OR NEW."key" != lower(NEW."key")
  OR NOT (
    NEW."key" = 'shared/'
    OR NEW."key" LIKE 'shared/%'
    OR (
      NEW."key" LIKE 'personal/%/%'
      AND EXISTS (
        SELECT 1 FROM users
        WHERE id = substr(NEW."key", 10, instr(substr(NEW."key", 10), '/') - 1)
      )
    )
  )
BEGIN
  SELECT RAISE(ABORT, 'invalid asset namespace key');
END;

CREATE TRIGGER validate_pages_asset_key_update
BEFORE UPDATE OF "key" ON pages
WHEN NEW."key" IS NULL
  OR length(NEW."key") = 0
  OR NEW."key" != trim(NEW."key")
  OR length(NEW."key") > 255
  OR substr(NEW."key", -1, 1) != '/'
  OR instr(NEW."key", char(0)) > 0
  OR instr(NEW."key", char(92)) > 0
  OR instr(NEW."key", '//') > 0
  OR instr(NEW."key", '/../') > 0
  OR instr(NEW."key", '/./') > 0
  OR NEW."key" != lower(NEW."key")
  OR NOT (
    NEW."key" = 'shared/'
    OR NEW."key" LIKE 'shared/%'
    OR (
      NEW."key" LIKE 'personal/%/%'
      AND EXISTS (
        SELECT 1 FROM users
        WHERE id = substr(NEW."key", 10, instr(substr(NEW."key", 10), '/') - 1)
      )
    )
  )
BEGIN
  SELECT RAISE(ABORT, 'invalid asset namespace key');
END;

CREATE TRIGGER validate_asset_key_mappings_insert
BEFORE INSERT ON asset_key_mappings
WHEN NEW.provider_id = ''
  OR NEW.provider_key = ''
  OR NEW."key" IS NULL
  OR length(NEW."key") = 0
  OR NEW."key" != trim(NEW."key")
  OR length(NEW."key") > 255
  OR substr(NEW."key", -1, 1) != '/'
  OR instr(NEW."key", char(0)) > 0
  OR instr(NEW."key", char(92)) > 0
  OR instr(NEW."key", '//') > 0
  OR instr(NEW."key", '/../') > 0
  OR instr(NEW."key", '/./') > 0
  OR NEW."key" != lower(NEW."key")
  OR NOT (
    NEW."key" = 'shared/'
    OR NEW."key" LIKE 'shared/%'
    OR (
      NEW."key" LIKE 'personal/%/%'
      AND EXISTS (
        SELECT 1 FROM users
        WHERE id = substr(NEW."key", 10, instr(substr(NEW."key", 10), '/') - 1)
      )
    )
  )
BEGIN
  SELECT RAISE(ABORT, 'invalid asset key mapping');
END;

CREATE TRIGGER validate_asset_key_mappings_update
BEFORE UPDATE ON asset_key_mappings
WHEN NEW.provider_id = ''
  OR NEW.provider_key = ''
  OR NEW."key" IS NULL
  OR length(NEW."key") = 0
  OR NEW."key" != trim(NEW."key")
  OR length(NEW."key") > 255
  OR substr(NEW."key", -1, 1) != '/'
  OR instr(NEW."key", char(0)) > 0
  OR instr(NEW."key", char(92)) > 0
  OR instr(NEW."key", '//') > 0
  OR instr(NEW."key", '/../') > 0
  OR instr(NEW."key", '/./') > 0
  OR NEW."key" != lower(NEW."key")
  OR NOT (
    NEW."key" = 'shared/'
    OR NEW."key" LIKE 'shared/%'
    OR (
      NEW."key" LIKE 'personal/%/%'
      AND EXISTS (
        SELECT 1 FROM users
        WHERE id = substr(NEW."key", 10, instr(substr(NEW."key", 10), '/') - 1)
      )
    )
  )
BEGIN
  SELECT RAISE(ABORT, 'invalid asset key mapping');
END;

-- Attachments are association rows, not the remote file itself. If an
-- attachment is deleted (directly or by task cascade), retain the provider
-- mapping as an externally registered logical file instead of leaving a
-- dangling source reference or deleting remote metadata.
CREATE TRIGGER detach_asset_key_mapping_before_attachment_delete
BEFORE DELETE ON task_attachments
BEGIN
  UPDATE asset_key_mappings
  SET source_entity_type = 'external',
      source_entity_id = NULL,
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE source_entity_type = 'task-attachment'
    AND source_entity_id = OLD.id;
END;
