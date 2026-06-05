CREATE INDEX idx_sessions_user_created
  ON sessions(user_id, archived, created_at, id);

CREATE INDEX idx_sessions_user_repo_created
  ON sessions(user_id, repo_id, archived, created_at, id);
