# Authentication

## Overview

cloude-code uses a GitHub App for repository access instead of a shared personal access token. Each session gets a scoped, short-lived installation access token that's automatically refreshed.

## How It Works

### Flow

```
1. Admin installs the GitHub App on an org/user account
2. GitHub sends installation webhooks → stored in D1
3. Client creates session: POST /sessions { repoId: 123456789 }
4. API resolves numeric repo id → installation and verifies user access
5. Durable Object provisions the Sprite, clones with a read-only installation token, and configures `origin --push` through the Worker git proxy
6. Git proxy requests mint or reuse scoped installation tokens through `GitHubAppService`
```

### Token Resolution

When a session is created, repo access is checked by `assertUserRepoAccess(...)` in `services/api-server/src/modules/sessions/services/session-repo-access.service.ts`. GitHub App token minting for clone/push goes through `GitHubAppService`:

1. Resolve the numeric repo id to an installation with `findInstallationForRepoId(...)`.
2. Verify the current user can access the repo through that installation.
3. Check D1 token cache (valid if expires > now + 5 minutes).
4. On cache miss, generate a new token via `octokit App.getInstallationOctokit()`.
5. Cache the token in D1 and return it.

If no installation is found in D1, the code falls back to GitHub API installation lookup and records the result.

### Git Authentication on the VM

Git setup lives in `SessionProvisionService.cloneRepo(...)` and `configureGitRemote(...)`:

- **Clone**: the API server mints a read-only installation token with `getReadOnlyTokenForRepo(...)`, base64-encodes `x-access-token:<TOKEN>`, and runs clone with an `http.extraHeader`:
  ```
  git -c http.extraHeader="Authorization: Basic <base64(x-access-token:TOKEN)>" clone ...
  ```
- **Push/fetch after clone**: `origin` is reset to the public GitHub URL for reads, and `origin --push` is set to `WORKER_URL/git-proxy/:sessionId/github.com/owner/repo.git`. The proxy authenticates Sprite requests with a per-session bearer secret and forwards to GitHub with a fresh or cached installation token from `getInstallationTokenForRepo(...)`.

## Architecture

### Key Files

| File | Purpose |
|------|---------|
| `services/api-server/src/modules/github/services/github-app.service.ts` | `GitHubAppService` - token resolution, installation lookup, webhook handling |
| `services/api-server/src/modules/sessions/services/session-repo-access.service.ts` | Session repo access checks for create/read/connect/chat paths |
| `services/api-server/src/modules/session-agent/services/session-provision.service.ts` | Sprite provisioning, read-only clone, git remote setup |
| `services/api-server/src/shared/integrations/git/git-setup.service.ts` | Configures `origin`, push URL, git identity, and git-proxy auth header |
| `services/api-server/src/modules/session-agent/services/session-git-proxy.service.ts` | Session-scoped git proxy auth/access wrapper |
| `services/api-server/src/modules/webhooks/routes/webhooks.routes.ts` | `POST /webhooks/github` - receives GitHub webhook events |
| `services/api-server/migrations/0001_github_app.sql` | D1 schema for installations, repos, token cache |

### D1 Tables

- **`github_installations`** — One row per GitHub App installation. Tracks account, permissions, repo selection mode, suspension status.
- **`github_installation_repos`** — Tracks which repos are accessible when `repository_selection = "selected"`. When `"all"`, every repo under the account is accessible (no rows needed).
- **`installation_token_cache`** — Caches encrypted installation access tokens. Runtime cache keys include the repo id and permission scope, and reads require `expires_at` to be more than 5 minutes in the future.
- **`github_user_repo_access_cache`** — Caches per-user repo access checks for 5 minutes. This is used by session creation and existing-session access checks.

### Webhook Events

The app listens at `POST /webhooks/github` for:

| Event | Action | Effect |
|-------|--------|--------|
| `installation.created` | Upsert installation + selected repos in D1 |
| `installation.deleted` | Delete installation (CASCADE cleans up repos + cache) |
| `installation.suspend` | Set `suspended_at` timestamp |
| `installation.unsuspend` | Clear `suspended_at` |
| `installation_repositories.added` | Update installation repo rows and invalidate affected repo-access/listing caches |
| `installation_repositories.removed` | Delete repo rows, invalidate affected caches, and block sessions for removed repos |
| `github_app_authorization.revoked` | Revoke all auth sessions and stored GitHub credentials for the sender |

Webhook signature verification is handled by `octokit`'s `app.webhooks.verifyAndReceive()`.

### Error Handling

`GitHubAppError` with codes:
- `INSTALLATION_NOT_FOUND` — No GitHub App installation for the repo's owner
- `REPO_NOT_ACCESSIBLE` — Installation exists but repo not in selected repos list
- `INVALID_REPO` — Repo id/name was invalid or no longer resolvable
- `GITHUB_AUTH_ERROR` — User OAuth token is invalid and could not be refreshed
- `GITHUB_API_ERROR` — GitHub API call failed

Session creation maps these through `SessionsService.createSession(...)`: access denials return **403**, invalid repo input returns **400**, GitHub auth failures return **401**, and temporary GitHub API failures return **503**.

## Configuration

These non-secret vars live in `services/api-server/wrangler.jsonc`:

| Var | Description |
|-----|-------------|
| `GITHUB_APP_ID` | Numeric app ID from GitHub App settings |
| `GITHUB_APP_CLIENT_ID` | OAuth client ID |
| `GITHUB_APP_SLUG` | GitHub App slug used for install URLs |

Set these via `wrangler secret put`:

| Secret | Description |
|--------|-------------|
| `GITHUB_APP_PRIVATE_KEY` | PEM private key (PKCS#8 format) |
| `GITHUB_WEBHOOK_SECRET` | Webhook secret configured in GitHub App settings |
| `GITHUB_APP_CLIENT_SECRET` | OAuth client secret |
| `TOKEN_ENCRYPTION_KEY` | Encrypts GitHub OAuth tokens and cached installation tokens |

## Setup

1. Create a GitHub App at https://github.com/settings/apps/new
2. Set webhook URL to `https://<api-domain>/webhooks/github`
3. Grant permissions: `Contents: Read & write`, `Metadata: Read-only`
4. Subscribe to events: `Installation`, `Repository`
5. Generate a private key and download it
6. Ensure `GITHUB_APP_ID`, `GITHUB_APP_CLIENT_ID`, and `GITHUB_APP_SLUG` are configured in `wrangler.jsonc`, then set secrets:
   ```bash
   wrangler secret put GITHUB_APP_PRIVATE_KEY
   wrangler secret put GITHUB_WEBHOOK_SECRET
   wrangler secret put GITHUB_APP_CLIENT_SECRET
   wrangler secret put TOKEN_ENCRYPTION_KEY
   ```
7. Install the app on the target org/user account
