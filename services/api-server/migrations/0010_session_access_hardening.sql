ALTER TABLE sessions ADD COLUMN installation_id INTEGER;
ALTER TABLE sessions ADD COLUMN revoked_at TEXT;
ALTER TABLE sessions ADD COLUMN revoked_reason TEXT;

CREATE INDEX idx_sessions_user_installation_repo
  ON sessions(user_id, installation_id, repo_id);
