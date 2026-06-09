CREATE TABLE integration_account_links (
  provider TEXT NOT NULL,
  external_user_id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  external_username TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_used_at TEXT,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  PRIMARY KEY (provider, external_user_id)
);

CREATE INDEX idx_integration_account_links_user
  ON integration_account_links(user_id, provider, revoked_at, expires_at);

CREATE TABLE integration_link_attempts (
  token_hash TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  external_user_id TEXT NOT NULL,
  external_username TEXT,
  expires_at TEXT NOT NULL,
  claimed_at TEXT,
  claimed_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_integration_link_attempts_external_user
  ON integration_link_attempts(provider, external_user_id, expires_at);
