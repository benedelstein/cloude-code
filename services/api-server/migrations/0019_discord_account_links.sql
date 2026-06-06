CREATE TABLE discord_account_links (
  discord_user_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  discord_username TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_used_at TEXT,
  expires_at TEXT NOT NULL,
  revoked_at TEXT
);

CREATE INDEX idx_discord_account_links_user
  ON discord_account_links(user_id, revoked_at, expires_at);

CREATE TABLE discord_link_attempts (
  token_hash TEXT PRIMARY KEY,
  discord_user_id TEXT NOT NULL,
  discord_username TEXT,
  guild_id TEXT,
  channel_id TEXT,
  expires_at TEXT NOT NULL,
  claimed_at TEXT,
  claimed_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_discord_link_attempts_discord_user
  ON discord_link_attempts(discord_user_id, expires_at);
