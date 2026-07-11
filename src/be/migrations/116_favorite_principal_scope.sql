-- Favorites were originally keyed only to canonical users. The hosted SPA,
-- however, authenticates with the deployment's shared operator bearer, so it
-- had no users.id to store and every toggle returned 401. Keep user ownership
-- intact while allowing the authenticated operator principal to own a separate
-- deployment-wide favorite set. The operator fingerprint remains in the
-- audit columns, while the storage scope stays stable across key rotation.

CREATE TABLE user_favorites_new (
  id            TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  favoriteScope TEXT NOT NULL,
  userId        TEXT REFERENCES users(id) ON DELETE CASCADE,
  itemType      TEXT NOT NULL CHECK (itemType IN ('page','workflow','schedule')),
  itemId        TEXT NOT NULL,
  createdAt     TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  lastUpdatedAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by    TEXT,
  updated_by    TEXT,
  UNIQUE (favoriteScope, itemType, itemId)
);

INSERT INTO user_favorites_new (
  id, favoriteScope, userId, itemType, itemId,
  createdAt, lastUpdatedAt, created_by, updated_by
)
SELECT
  id, 'user:' || userId, userId, itemType, itemId,
  createdAt, lastUpdatedAt, created_by, updated_by
FROM user_favorites;

DROP TABLE user_favorites;
ALTER TABLE user_favorites_new RENAME TO user_favorites;

CREATE INDEX idx_user_favorites_scope_type
  ON user_favorites(favoriteScope, itemType);
CREATE INDEX idx_user_favorites_user_type
  ON user_favorites(userId, itemType);
CREATE INDEX idx_user_favorites_item
  ON user_favorites(itemType, itemId);
