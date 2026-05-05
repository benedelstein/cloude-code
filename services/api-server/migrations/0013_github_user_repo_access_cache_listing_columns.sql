ALTER TABLE github_user_repo_access_cache ADD COLUMN owner TEXT;
ALTER TABLE github_user_repo_access_cache ADD COLUMN name TEXT;
ALTER TABLE github_user_repo_access_cache ADD COLUMN default_branch TEXT;
ALTER TABLE github_user_repo_access_cache ADD COLUMN is_private INTEGER;
ALTER TABLE github_user_repo_access_cache ADD COLUMN description TEXT;

CREATE INDEX idx_github_user_repo_access_cache_user_full_name
  ON github_user_repo_access_cache(user_id, allowed, repo_full_name COLLATE NOCASE);
