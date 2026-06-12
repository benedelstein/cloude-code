-- Store web session token verifiers instead of raw bearer tokens.

DROP INDEX IF EXISTS idx_auth_sessions_user;
DROP INDEX IF EXISTS idx_auth_sessions_refresh_session;

CREATE TABLE auth_sessions_next (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL
);

DROP TABLE auth_sessions;
ALTER TABLE auth_sessions_next RENAME TO auth_sessions;

CREATE INDEX idx_auth_sessions_user ON auth_sessions(user_id);
