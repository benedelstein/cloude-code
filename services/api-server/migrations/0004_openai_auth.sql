-- Per-user OpenAI OAuth tokens (ChatGPT Plus/Pro subscription)
CREATE TABLE openai_tokens (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  encrypted_access_token TEXT NOT NULL,
  encrypted_refresh_token TEXT,
  encrypted_id_token TEXT,
  token_expires_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Add PKCE code_verifier to oauth_states for OpenAI OAuth flow
ALTER TABLE oauth_states ADD COLUMN code_verifier TEXT;
