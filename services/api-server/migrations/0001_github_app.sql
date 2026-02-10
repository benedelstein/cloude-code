-- GitHub App installations (populated by installation.* webhooks)
CREATE TABLE github_installations (
  id INTEGER PRIMARY KEY,              -- GitHub installation ID
  app_id INTEGER NOT NULL,
  account_id INTEGER NOT NULL,         -- GitHub account ID (org or user)
  account_login TEXT NOT NULL,          -- org or user login (e.g. "acme-corp")
  account_type TEXT NOT NULL,           -- "Organization" or "User"
  target_type TEXT NOT NULL,
  permissions TEXT NOT NULL DEFAULT '{}',  -- JSON of granted permissions
  events TEXT NOT NULL DEFAULT '[]',    -- JSON of subscribed events
  repository_selection TEXT NOT NULL,   -- "all" or "selected"
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  suspended_at TEXT                     -- non-null if suspended
);
CREATE INDEX idx_installations_account ON github_installations(account_login);

-- Repos accessible per installation (populated by webhooks)
-- Only tracked when repository_selection = "selected"
-- When "all", every repo under account_login is accessible
CREATE TABLE github_installation_repos (
  installation_id INTEGER NOT NULL,
  repo_id INTEGER NOT NULL,            -- GitHub repo numeric ID
  repo_name TEXT NOT NULL,             -- "owner/repo" full name
  PRIMARY KEY (installation_id, repo_id),
  FOREIGN KEY (installation_id) REFERENCES github_installations(id) ON DELETE CASCADE
);
CREATE INDEX idx_installation_repos_name ON github_installation_repos(repo_name);

-- Cache for installation access tokens (1hr lifetime)
CREATE TABLE installation_token_cache (
  installation_id INTEGER NOT NULL,
  repo_id INTEGER NOT NULL,            -- GitHub numeric repo ID, or 0 for unscoped tokens
  token TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (installation_id, repo_id),
  FOREIGN KEY (installation_id) REFERENCES github_installations(id) ON DELETE CASCADE
);
