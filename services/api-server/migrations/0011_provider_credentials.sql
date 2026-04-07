CREATE TABLE user_provider_credentials (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider_id TEXT NOT NULL,
  auth_method TEXT NOT NULL,
  encrypted_credentials TEXT NOT NULL,
  requires_reauth INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, provider_id, auth_method)
);

CREATE INDEX idx_user_provider_credentials_provider
  ON user_provider_credentials(provider_id, auth_method);

-- Store in-progress auth attempt state
CREATE TABLE provider_auth_attempts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider_id TEXT NOT NULL,
  auth_method TEXT NOT NULL,
  flow_type TEXT NOT NULL,
  encrypted_context_json TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_provider_auth_attempts_user_provider
  ON provider_auth_attempts(user_id, provider_id, auth_method);
