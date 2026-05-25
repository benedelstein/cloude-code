ALTER TABLE sessions ADD COLUMN working_state TEXT NOT NULL DEFAULT 'idle';
ALTER TABLE sessions ADD COLUMN pushed_branch TEXT;
ALTER TABLE sessions ADD COLUMN pull_request_url TEXT;
ALTER TABLE sessions ADD COLUMN pull_request_number INTEGER;
ALTER TABLE sessions ADD COLUMN pull_request_state TEXT;

CREATE INDEX idx_sessions_pr_webhook
  ON sessions(installation_id, repo_id, pull_request_number);
