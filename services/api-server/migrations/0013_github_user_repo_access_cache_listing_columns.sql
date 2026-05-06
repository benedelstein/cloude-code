ALTER TABLE github_user_repo_access_cache ADD COLUMN owner TEXT;
ALTER TABLE github_user_repo_access_cache ADD COLUMN name TEXT;
ALTER TABLE github_user_repo_access_cache ADD COLUMN default_branch TEXT;
ALTER TABLE github_user_repo_access_cache ADD COLUMN is_private INTEGER;
ALTER TABLE github_user_repo_access_cache ADD COLUMN description TEXT;

CREATE INDEX idx_github_user_repo_access_cache_user_full_name
  ON github_user_repo_access_cache(user_id, allowed, repo_full_name COLLATE NOCASE);

-- Supports installation-scoped webhook DELETEs and the listing-sync
-- clearForInstallation sub-select. Without this, every webhook event for an
-- installation does a full table scan to find rows by installation_id.
CREATE INDEX idx_github_user_repo_access_cache_installation
  ON github_user_repo_access_cache(installation_id, user_id);
