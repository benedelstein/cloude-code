# Authentication Flow

## Overview

GitHub OAuth via a GitHub App, with server-side session tokens stored in an HTTP-only cookie. The Next.js web app acts as a BFF (backend-for-frontend) proxy so the session token never touches client-side JavaScript.

The GitHub App's "User authorization callback URL" is `https://api.cloudecode.dev/auth/callback` — pinned to the api-server, not the web app. The api-server owns the OAuth state and decides which web origin the popup lands on for cookie-set. This is how sign-in works on Vercel preview branches as well as prod.

## Flow

```
Browser                    Next.js (web)                API Server              GitHub
  |                            |                            |                      |
  |-- Click "Sign in" -------->|                            |                      |
  |-- (popup opens) ---------->|                            |                      |
  |                            |-- GET /auth/github -------># validate origin       |
  |                            |   ?origin=<window.origin>  # (prod or preview      |
  |                            |                            #  allowlist regex)     |
  |                            |                            # insert oauth_states   |
  |                            |                            #   { state, redirect_origin }
  |                            |<-- { url, state } ---------|                      |
  |                            |                            |                      |
  |-- Set popup.location = url ------------------------------------------------------|
  |                                                                                 |
  |                  (user authorizes on GitHub)                                    |
  |                                                                                 |
  |<-- Redirect to api.cloudecode.dev/auth/callback?code=X&state=Y -----------------|
  |                                                         |                      |
  |                                                         # peek redirect_origin  |
  |                                                         # (does not consume)    |
  |                                                         # re-validate against   |
  |                                                         #   allowlist           |
  |<-- 302 <recorded-origin>/api/auth/finalize?code=X&state=Y -----------------------|
  |                            |                            |                      |
  |-- GET /api/auth/finalize ->|                            |                      |
  |                            |-- POST /auth/token ------->|                      |
  |                            |   { code, state }          | consumeValid(state)  |
  |                            |                            | (atomic, single-use) |
  |                            |                            |-- exchange code ---->|
  |                            |                            |<-- tokens, user -----|
  |                            |                            | encrypt tokens       |
  |                            |                            | upsert user          |
  |                            |                            | create 30-day session|
  |                            |<-- { token, user, ... } ---|                      |
  |<-- Set session_token cookie ----------------------------                        |
  |    + HTML script: postMessage(opener), window.close()                           |
```

Prod and preview take the same path. On prod, the 302 lands the popup back at `cloudecode.dev/api/auth/finalize`; on a preview, it lands at `<preview>.vercel.app/api/auth/finalize`. The cookie is always set on the origin that started the flow.

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
- **Origin-bound state**: The state row carries a `redirect_origin` column. The browser passes its `window.location.origin` on `/auth/github`; the server validates it (see allowlist below) and records it against the state. The api-server's `/auth/callback` reads this origin to decide where to 302 the popup. The redirect target is therefore never trusted from URL parameters — only from server-recorded state.
- **Preview-origin allowlist**: `PREVIEW_ORIGIN_ALLOWLIST_REGEX` pins the Vercel project name *and* team slug as literals (e.g. `^https://cloude-code-[a-z0-9][a-z0-9-]*-benedelsteins-projects\.vercel\.app$`). Vercel team slugs are globally unique, so no other team can produce a URL matching the regex. The prod origin (`WEB_ORIGIN`) is exempt. Validated both on write (when state is created) and on read (at callback time) for defense-in-depth.
- **Allowlist**: Only GitHub logins in `ALLOWED_GITHUB_LOGINS` can authenticate.
- **Token refresh**: The auth middleware transparently refreshes expired GitHub access tokens using the stored refresh token.

## Preview Branches

Vercel preview branches share one GitHub App with prod, which means one callback URL. The callback lives on the api-server (`api.cloudecode.dev/auth/callback`); GitHub redirects every sign-in there regardless of which web origin started it. The api-server reads the recorded origin from the state row and 302s the popup back to that origin's `/api/auth/finalize`, which sets the cookie scoped to that origin and posts the popup's opener (also on that origin, so the same-origin `postMessage` check in `use-auth.ts` passes).

Two browser rules force this hop:
- Cookies are origin-scoped — api-server on `api.cloudecode.dev` cannot Set-Cookie for `<preview>.vercel.app` (different registrable domain).
- `window.opener.postMessage` is rejected by the opener's same-origin check unless the popup ends on the opener's origin.

So whatever does the cookie-set + opener notification has to run on the originating origin. That's `/api/auth/finalize`.

## Websocket Auth

Websockets can't carry the session cookie — browsers don't let you set headers on `new WebSocket()`, and cross-origin cookie scoping doesn't cleanly apply to WS upgrades. So we mint a short-lived, stateless, signed token via `POST /sessions/{sessionId}/websocket-token` (authenticated via the normal cookie → Bearer BFF path), and the client passes it as a URL query param on the WS upgrade: `wss://.../agents/session/{id}?token=...`.

The token carries `sessionId`, `userId`, and `expiresAt`, signed with `WEBSOCKET_TOKEN_SIGNING_KEY`. It's verified at the upgrade handler (`agent.routes.ts`), which also re-checks session→repo access before forwarding to the Durable Object.

### Key properties

- **Verified only at the WS upgrade.** Once the socket is established, the token is stripped from the URL and never re-checked. The live socket is the auth. A connection opened at t=0 with a 5-minute token will keep working at t=1h.
- **Short TTL is leak mitigation, not session lifetime control.** Query strings are the leakiest place to put a credential (server access logs, browser history, referrer headers, proxy logs). A ~5-minute expiry caps the blast radius if the URL leaks — an attacker can use a stolen token to open a new socket only within that window. It does **not** expire in-flight connections.
- **No proactive token refresh on the client.** Because nothing rechecks after upgrade, a periodic timer-based refresh adds churn without adding safety — and in our stack it actually causes duplicate `sync.response` events, since changing the token changes the `usePartySocket` memo key and forces a fresh WS connection. Refresh only happens lazily on socket close if the cached token has already expired (`use-session-websocket-token.ts` / `use-cloudflare-agent.ts`).

### Keep-alive

We don't send app-level pings. Cloudflare answers protocol-level `ping` control frames automatically without waking the DO, but browser JS can't initiate protocol pings (the W3C WebSocket API doesn't expose them). An app-level `{type:"ping"}` message would work but would wake the DO every interval and defeat hibernation — only add it if we see real idle drops on specific networks.

## Relevant Files

| File | Purpose |
|------|---------|
| `services/api-server/src/routes/auth/auth.routes.ts` | OAuth endpoints: `GET /auth/github`, `GET /auth/callback` (302 bouncer), `POST /auth/token`, logout |
| `services/api-server/src/middleware/auth.middleware.ts` | Session validation, token refresh |
| `services/api-server/src/lib/auth/preview-origin.ts` | Validates redirect origin against `WEB_ORIGIN` and `PREVIEW_ORIGIN_ALLOWLIST_REGEX` |
| `services/api-server/src/lib/github/github-app.ts` | GitHub App OAuth helpers |
| `services/api-server/src/repositories/oauth-state-repository.ts` | State nonce CRUD; `peekRedirectOrigin` for the api-server callback |
| `services/api-server/src/lib/utils/crypto.ts` | Token encryption/decryption |
| `apps/web/app/api/auth/finalize/route.ts` | Exchanges code for session token, sets cookie, posts opener |
| `apps/web/app/api/[...path]/route.ts` | BFF proxy, cookie -> Bearer translation |
| `apps/web/hooks/use-auth.ts` | Client-side auth hook (login, logout, popup management) |

## Authentication Rules

- You can only create a session on a repo if you have access to it via its github app installation.
  We first check the installation that the repo is associated with, and then use the user's github access token to verify that the user can access that repo via the installation.
  Even if a user can access a repo, they may not have access to it via the installation.
- You can only view a session if you created it (for now).
- You can only install the github app on a repo if you have admin access to it (this is a limitation of the github api).

Even after you create a session on a repo you have access to, you may lose access to it if the installation is deleted, you lose access to the repo, or the repo is removed from the installation. We handle this like so:

- Routes to create/get a session, mint a websocket token, connect a websocket, and send `chat.message` all check for access to the repo using `services/api-server/src/lib/providers/repo-access-provider.ts`.
  a. If we don't know the repo's installation_id, we have to look it up using `github-app.ts#findInstallationForRepoId`. This first checks D1 `github_installation_repos`, then falls back to the GitHub API.
  b. Check the `github_user_repo_access_cache` for this (user_id, repo_id, installation_id) (5 minute TTL)
  c. If no cache value exists, look up the repo using the GitHub API (the same route we use to fetch user-accessible repos). This path is slow, since we have to enumerate a user's repos, which is also why we cache it.

We use a D1 table `github_user_repo_access_cache` to cache user access to a repo within an installation. The cache TTL is 5 minutes.
Values are put to the cache when a user creates a session, or calls get /repos to list the repos they have access to.

If a fresh value is found in the cache, we return true in the access check.
If an installation is deleted, or repo is removed from the installation, we clear the relevant values from the cache.
