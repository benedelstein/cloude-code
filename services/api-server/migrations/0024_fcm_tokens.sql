CREATE TABLE fcm_tokens (
  user_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  token TEXT NOT NULL,
  platform TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
  invalidated_at TEXT,
  PRIMARY KEY (user_id, device_id),
  UNIQUE (token)
);

CREATE INDEX idx_fcm_tokens_user_active
  ON fcm_tokens(user_id, invalidated_at);
