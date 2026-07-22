CREATE TABLE sign_in_attempts (
  id TEXT PRIMARY KEY,
  client_type TEXT NOT NULL,
  claim_token_hash TEXT NOT NULL,
  status TEXT NOT NULL,
  user_id TEXT,
  completion_target TEXT NOT NULL,
  return_to TEXT,
  install_url TEXT,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_sign_in_attempts_expires_at ON sign_in_attempts(expires_at);
ALTER TABLE oauth_states ADD COLUMN sign_in_attempt_id TEXT;
