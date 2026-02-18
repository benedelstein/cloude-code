-- Session history: lightweight index for listing past sessions per user
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  repo_id TEXT NOT NULL,
  title TEXT,
  status TEXT NOT NULL DEFAULT 'provisioning',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_message_at TEXT
);

CREATE INDEX idx_sessions_user ON sessions(user_id, updated_at);
CREATE INDEX idx_sessions_user_repo ON sessions(user_id, repo_id, updated_at);
