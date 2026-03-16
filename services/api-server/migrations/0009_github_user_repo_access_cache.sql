CREATE TABLE github_user_repo_access_cache (
  user_id TEXT NOT NULL,
  installation_id INTEGER NOT NULL,
  repo_id INTEGER NOT NULL,
  allowed INTEGER NOT NULL,
  repo_full_name TEXT,
  expires_at TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, installation_id, repo_id)
);

CREATE INDEX idx_github_user_repo_access_cache_expires_at
  ON github_user_repo_access_cache(expires_at);
