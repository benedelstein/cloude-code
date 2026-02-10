# GitHub App Authentication

## Overview

cloude-code uses a GitHub App for repository access instead of a shared personal access token. Each session gets a scoped, short-lived installation access token that's automatically refreshed.

## How It Works

### Flow

```
1. Admin installs the GitHub App on an org/user account
2. GitHub sends installation webhooks → stored in D1
3. Client creates session: POST /sessions { repoId: "acme/app" }
4. API resolves repoId → installation → access token (cached in D1)
5. Token passed to Durable Object → used for git clone + credential helper
6. Token refreshed automatically on session reattach (after hibernation)
```

### Token Resolution

When a session is created, `GitHubAppService.getTokenForRepo(repoId)` does:

1. Parse `owner/repo` from `repoId`
2. Look up installation in D1 by `account_login` (the owner)
3. If `repository_selection = "selected"`, verify the specific repo is in `github_installation_repos`
4. Check D1 token cache (valid if expires > now + 5 minutes)
5. On cache miss, generate a new token via `octokit App.getInstallationOctokit()`
6. Cache the token in D1 and return it

If no installation is found in D1, falls back to `apps.getRepoInstallation()` API call.

### Git Authentication on the VM

The token is used in two ways on the Sprite VM:

- **Clone**: `git clone https://x-access-token:<TOKEN>@github.com/owner/repo.git`
- **Fetch/Push**: Git credential helper configured to return the token:
  ```
  git config credential.helper '!f() { echo "username=x-access-token"; echo "password=<TOKEN>"; }; f'
  ```

## Architecture

### Key Files

| File | Purpose |
|------|---------|
| `services/api-server/src/lib/github/github-app.ts` | `GitHubAppService` — token resolution, installation lookup, webhook handlers |
| `services/api-server/src/lib/github/index.ts` | Barrel export |
| `services/api-server/src/routes/webhooks.routes.ts` | `POST /webhooks/github` — receives GitHub webhook events |
| `services/api-server/migrations/0001_github_app.sql` | D1 schema for installations, repos, token cache |

### D1 Tables

- **`github_installations`** — One row per GitHub App installation. Tracks account, permissions, repo selection mode, suspension status.
- **`github_installation_repos`** — Tracks which repos are accessible when `repository_selection = "selected"`. When `"all"`, every repo under the account is accessible (no rows needed).
- **`installation_token_cache`** — Caches installation access tokens (1hr lifetime, 5min expiry buffer).

### Webhook Events

The app listens at `POST /webhooks/github` for:

| Event | Action | Effect |
|-------|--------|--------|
| `installation.created` | Upsert installation + selected repos in D1 |
| `installation.deleted` | Delete installation (CASCADE cleans up repos + cache) |
| `installation.suspend` | Set `suspended_at` timestamp |
| `installation.unsuspend` | Clear `suspended_at` |
| `installation_repositories.added` | Insert repos into `github_installation_repos` |
| `installation_repositories.removed` | Delete repos from `github_installation_repos` |

Webhook signature verification is handled by `octokit`'s `app.webhooks.verifyAndReceive()`.

### Error Handling

`GitHubAppError` with codes:
- `INSTALLATION_NOT_FOUND` — No GitHub App installation for the repo's owner
- `REPO_NOT_ACCESSIBLE` — Installation exists but repo not in selected repos list
- `GITHUB_API_ERROR` — GitHub API call failed

Session creation returns **422** for `INSTALLATION_NOT_FOUND` and `REPO_NOT_ACCESSIBLE`.

## Secrets

Set via `wrangler secret put`:

| Secret | Description |
|--------|-------------|
| `GITHUB_APP_ID` | Numeric app ID from GitHub App settings |
| `GITHUB_APP_PRIVATE_KEY` | PEM private key (PKCS#8 format) |
| `GITHUB_WEBHOOK_SECRET` | Webhook secret configured in GitHub App settings |

## Setup

1. Create a GitHub App at https://github.com/settings/apps/new
2. Set webhook URL to `https://<api-domain>/webhooks/github`
3. Grant permissions: `Contents: Read & write`, `Metadata: Read-only`
4. Subscribe to events: `Installation`, `Repository`
5. Generate a private key and download it
6. Set secrets:
   ```bash
   npx wrangler secret put GITHUB_APP_ID
   npx wrangler secret put GITHUB_APP_PRIVATE_KEY
   npx wrangler secret put GITHUB_WEBHOOK_SECRET
   ```
7. Install the app on the target org/user account
