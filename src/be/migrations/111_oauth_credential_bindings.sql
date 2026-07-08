ALTER TABLE script_credential_bindings
  ADD COLUMN auth_kind TEXT NOT NULL DEFAULT 'config'
  CHECK(auth_kind IN ('config', 'oauth'));

ALTER TABLE script_credential_bindings
  ADD COLUMN oauth_provider TEXT;
