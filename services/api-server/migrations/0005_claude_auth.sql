-- Per-user Claude OAuth tokens for Linux VM credential file generation
CREATE TABLE claude_tokens (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  encrypted_access_token TEXT NOT NULL,
  encrypted_refresh_token TEXT NOT NULL,
  expires_at_ms INTEGER NOT NULL,
  scopes_json TEXT NOT NULL,
  subscription_type TEXT,
  rate_limit_tier TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
