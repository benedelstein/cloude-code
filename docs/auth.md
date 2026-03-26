# Authentication Flow

## Overview

GitHub OAuth via a GitHub App, with server-side session tokens stored in an HTTP-only cookie. The Next.js web app acts as a BFF (backend-for-frontend) proxy so the session token never touches client-side JavaScript.

## Flow

```
Browser                    Next.js (web)                API Server              GitHub
  |                            |                            |                      |
  |-- Click "Sign in" -------->|                            |                      |
  |                            |-- GET /auth/github ------->|                      |
  |                            |<-- { url, state } ---------|                      |
  |                            |                            |                      |
  |-- Open popup to url ------>|                            |                      |
  |                            |                            |                      |
  |                            |                   (user authorizes on GitHub)      |
  |                            |                            |                      |
  |<-- Redirect to /api/auth/callback?code=X&state=Y --------------------------------|
  |                            |                            |                      |
  |                            |-- POST /auth/token ------->|                      |
  |                            |   { code, state }          |-- exchange code ---->|
  |                            |                            |<-- tokens, user -----|
  |                            |                            |                      |
  |                            |                            | validate state (nonce)
  |                            |                            | check allowlist
  |                            |                            | encrypt tokens
  |                            |                            | upsert user
  |                            |                            | create 30-day session
  |                            |                            |                      |
  |                            |<-- { token, user } --------|                      |
  |                            |                            |                      |
  |<-- Set session_token cookie |                            |                      |
  |<-- postMessage to parent --|                            |                      |
  |                            |                            |                      |
  | (popup closes, user is logged in)                       |                      |
```

## Authenticated Requests

```
Browser                    Next.js proxy (/api/*)       API Server
  |                            |                            |
  |-- fetch /api/sessions ---->|                            |
  |   (cookie sent auto)       |                            |
  |                            |-- GET /sessions ---------->|
  |                            |   Authorization: Bearer <token>
  |                            |                            |
  |                            |   (middleware validates session,
  |                            |    decrypts GitHub access token,
  |                            |    refreshes if expired)
  |                            |                            |
  |                            |<-- response ---------------|
  |<-- response ---------------|                            |
```

## Key Design Decisions

- **HTTP-only cookie**: The session token is stored as an HTTP-only, secure, sameSite=lax cookie. Client JS cannot access it, mitigating XSS token theft.
- **Server-side sessions**: Session tokens are random UUIDs stored in D1, not JWTs. This makes them revocable (delete the row to log out).
- **BFF proxy**: The Next.js `/api/[...path]` catch-all extracts the cookie and forwards it as a `Bearer` token. The API server only deals with Bearer auth.
- **Encrypted GitHub tokens**: GitHub access/refresh tokens are encrypted with `TOKEN_ENCRYPTION_KEY` before storage.
- **State token (nonce)**: A random single-use state token with 10-min expiry prevents CSRF on the OAuth callback. Consumed atomically via `DELETE ... RETURNING`.
- **Allowlist**: Only GitHub logins in `ALLOWED_GITHUB_LOGINS` can authenticate.
- **Token refresh**: The auth middleware transparently refreshes expired GitHub access tokens using the stored refresh token.

## Websocket Auth

Websockets send directly to the server, so they cannot carry a cookie as auth. 
Instead, we generate a short-lived token for websocket authentication.

This isn't exactly a JWT, but it's a stateless token with a known structure that can be verified by the server.
Before initiating a websocket connection, the client fetches a token from the server using /sessions/{sessionId}/websocket-token.

## Relevant Files

| File | Purpose |
|------|---------|
| `services/api-server/src/routes/auth/auth.routes.ts` | OAuth endpoints (GET /auth/github, POST /auth/token, logout) |
| `services/api-server/src/middleware/auth.middleware.ts` | Session validation, token refresh |
| `services/api-server/src/lib/github/github-app.ts` | GitHub App OAuth helpers |
| `services/api-server/src/lib/crypto.ts` | Token encryption/decryption |
| `apps/web/app/api/auth/callback/route.ts` | OAuth callback, sets cookie |
| `apps/web/app/api/[...path]/route.ts` | BFF proxy, cookie -> Bearer translation |
| `apps/web/hooks/use-auth.ts` | Client-side auth hook (login, logout) |

## Authentication Rules

- You can only create a session on a repo if you have access to it via its github app installation.
  We first check the installation that the repo is associated with, and then use the user's github access token to verify that the user can access that repo via the installation.
  Even if a user can access a repo, they may not have access to it via the installation.
- You can only view a session if you created it (for now).
- You can only install the github app on a repo if you have admin access to it (this is a limitation of the github api).

Even after you create a session on a repo you have access to, you may lose access to it if the installation is deleted, you lose access to the repo, or the repo is removed from the installation. We handle this like so:

- Routes to get a session, post messages, get a websocket token, etc. all check for access to the repo using `repo-session-accesss.ts`
  a. If we don't know the repo's installation_id, we have to look it up using `github-app.ts#findInstallationForRepoId`. This first checks D1 `installation_repos` table, then falls back to the github api.
  b. Check the `github_user_repo_access_cache` for this (user_id, repo_id, installation_id) (5 minute TTL)
  c. If no cache value, look up the repo using github the github api (the same route we use to fetch user-accessible repos). This path is slow, since we have to enumerate a user's repos, which is also why we cache it.

We use a D1 table `github_user_repo_access_cache` to cache user access to a repo within an installation. The cache TTL is 5 minutes.
Values are put to the cache when a user creates a session, or calls get /repos to list the repos they have access to.

If a fresh value is found in the cache, we return true in the access check.
If an installation is deleted, or repo is removed from the installation, we clear the relevant values from the cache.