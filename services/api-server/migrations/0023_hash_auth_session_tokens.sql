-- Store web session token verifiers instead of raw bearer tokens.
--
-- Existing plaintext web sessions are intentionally not migrated; users will
-- re-authenticate and receive hash-only sessions after this migration.
--
-- Keep a nullable legacy token column during this rollout because migrations
-- run before the Worker deploy. The previously deployed Worker can still read
-- and write this schema during the deploy window, while the new Worker writes
-- only token_hash. A later contraction migration can drop token after this
-- code has been deployed everywhere.

DROP INDEX IF EXISTS idx_auth_sessions_user;
DROP INDEX IF EXISTS idx_auth_sessions_refresh_session;

CREATE TABLE auth_sessions_next (
  token TEXT,
  token_hash TEXT,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL,
  refresh_session_id TEXT
);

DROP TABLE auth_sessions;
ALTER TABLE auth_sessions_next RENAME TO auth_sessions;

CREATE UNIQUE INDEX idx_auth_sessions_legacy_token ON auth_sessions(token);
CREATE UNIQUE INDEX idx_auth_sessions_token_hash ON auth_sessions(token_hash);
CREATE INDEX idx_auth_sessions_user ON auth_sessions(user_id);
CREATE INDEX idx_auth_sessions_refresh_session ON auth_sessions(refresh_session_id);
