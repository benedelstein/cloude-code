CREATE TABLE repo_environments (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  repo_id INTEGER NOT NULL,
  repo_full_name TEXT NOT NULL,
  name TEXT NOT NULL,
  network_mode TEXT NOT NULL,
  network_extra_allowlist_json TEXT NOT NULL DEFAULT '[]',
  network_include_default_allowlist INTEGER NOT NULL DEFAULT 0,
  plain_env_vars_json TEXT NOT NULL DEFAULT '{}',
  startup_script TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_repo_environments_user_repo
  ON repo_environments(user_id, repo_id, updated_at);

CREATE UNIQUE INDEX idx_repo_environments_user_repo_name
  ON repo_environments(user_id, repo_id, name);

ALTER TABLE sessions ADD COLUMN source_environment_id TEXT;
ALTER TABLE sessions ADD COLUMN source_environment_name TEXT;
