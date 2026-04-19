CREATE TABLE user_github_credentials (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  encrypted_access_token TEXT NOT NULL,
  access_token_expires_at TEXT,
  encrypted_refresh_token TEXT,
  refresh_token_expires_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO user_github_credentials (
  user_id,
  encrypted_access_token,
  access_token_expires_at,
  encrypted_refresh_token,
  refresh_token_expires_at
)
WITH ranked_auth_sessions AS (
  SELECT
    user_id,
    github_access_token,
    token_expires_at,
    ROW_NUMBER() OVER (
      PARTITION BY user_id
      ORDER BY datetime(expires_at) DESC, rowid DESC
    ) AS row_number
  FROM auth_sessions
)
SELECT
  ranked_auth_sessions.user_id,
  ranked_auth_sessions.github_access_token,
  ranked_auth_sessions.token_expires_at,
  user_refresh_tokens.encrypted_token,
  user_refresh_tokens.expires_at
FROM ranked_auth_sessions
LEFT JOIN user_refresh_tokens
  ON user_refresh_tokens.user_id = ranked_auth_sessions.user_id
WHERE ranked_auth_sessions.row_number = 1;

CREATE TABLE auth_sessions_next (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL
);

INSERT INTO auth_sessions_next (token, user_id, created_at, expires_at)
SELECT token, user_id, created_at, expires_at
FROM auth_sessions;

DROP TABLE auth_sessions;
DROP TABLE user_refresh_tokens;
ALTER TABLE auth_sessions_next RENAME TO auth_sessions;
CREATE INDEX idx_auth_sessions_user ON auth_sessions(user_id);
