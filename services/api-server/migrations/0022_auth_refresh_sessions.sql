CREATE TABLE auth_refresh_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  refresh_token_hash TEXT NOT NULL UNIQUE,
  previous_refresh_token_hash TEXT,
  previous_rotated_at TEXT,
  refresh_expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
ALTER TABLE auth_sessions ADD COLUMN refresh_session_id TEXT;
CREATE INDEX idx_auth_sessions_refresh_session ON auth_sessions(refresh_session_id);
CREATE INDEX idx_auth_refresh_sessions_user ON auth_refresh_sessions(user_id);
CREATE INDEX idx_auth_refresh_sessions_prev_hash ON auth_refresh_sessions(previous_refresh_token_hash);
