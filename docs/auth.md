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

## WebSocket Auth

Browser WebSockets cannot use the normal BFF `Authorization` header path because `new WebSocket()` does not allow custom headers. WebSocket auth is therefore a two-step flow:

1. Use the normal cookie -> BFF -> Bearer-authenticated HTTP path to mint a short-lived WebSocket token.
2. Pass that token as `?token=...` on the WebSocket upgrade URL.

There are two WebSocket surfaces:

| Socket | Token endpoint | Upgrade URL | Token scope |
|--------|----------------|-------------|-------------|
| Session agent | `POST /sessions/{sessionId}/websocket-token` | `/agents/session/{sessionId}?token=...` | `type`, `sessionId`, `userId`, `exp` |
| User sessions sidebar stream | `POST /sessions/updates/token` | `/sessions/updates?token=...` | `type`, `userId`, `exp` |

Both token types are stateless HMAC-SHA256 tokens signed with `WEBSOCKET_TOKEN_SIGNING_KEY`. They expire after 5 minutes and return `{ token, expiresAt }` to the web app.

### Upgrade validation

- The session socket upgrade is handled by `agent.routes.ts`. It verifies the token signature, token type, expiration, and `sessionId`, then re-checks session repo access before routing to the session Durable Object.
- The user sessions stream upgrade is handled by `sessions.routes.ts`. It verifies the token signature, token type, and expiration, then forwards the request to the `UserSessionsDO` named by `userId`.

The token is only checked during the WebSocket upgrade. Once a socket is established, token expiry does not close it or revoke it. A socket opened with a 5-minute token can stay open past that 5-minute window.

### Refresh and reconnect

The web app does not refresh WebSocket tokens on a timer. `useWebSocketToken(...)` owns token minting, transient retry backoff, and terminal auth errors; the socket hooks decide when a fresh token is needed.

Current behavior:

- If no token exists, the token hook mints one before opening the socket.
- If a token is expired or within the 30-second client buffer, the socket hook refreshes before opening or reconnecting.
- If a WebSocket closes and the token is expired or near expiry, the socket hook refreshes instead of continuing with that token.
- Transient token-mint failures retry with exponential backoff, capped at 30 seconds.
- Token-mint `401`, `403`, or `404` responses are treated as terminal auth/access errors and do not retry automatically.

The session page can receive an initial session WebSocket token from session creation. The web app stores that token briefly in memory/sessionStorage and consumes it on first render to avoid an extra HTTP mint. Cached initial tokens are ignored if they are expired or within the 30-second buffer.

Short token TTL is leak mitigation, not socket lifetime control. Query strings are exposed in more places than headers, so the TTL limits the window in which a leaked URL can open a new socket.

### Keep-alive

We don't send app-level pings. Cloudflare answers protocol-level `ping` control frames automatically without waking the DO, but browser JS can't initiate protocol pings (the W3C WebSocket API doesn't expose them). An app-level `{type:"ping"}` message would work but would wake the DO every interval and defeat hibernation — only add it if we see real idle drops on specific networks.

## Relevant Files

| File | Purpose |
|------|---------|
| `services/api-server/src/modules/auth/routes/auth.routes.ts` | OAuth endpoints: `GET /auth/github`, `GET /auth/callback` (302 bouncer), `POST /auth/token`, logout |
| `services/api-server/src/modules/auth/middleware/auth.middleware.ts` | Session validation, token refresh |
| `services/api-server/src/modules/auth/utils/preview-origin.util.ts` | Validates redirect origin against `WEB_ORIGIN` and `PREVIEW_ORIGIN_ALLOWLIST_REGEX` |
| `services/api-server/src/modules/session-agent/routes/agent.routes.ts` | Session WebSocket upgrade token validation and repo-access gate |
| `services/api-server/src/modules/sessions/routes/sessions.routes.ts` | User sessions stream token validation and token mint routes |
| `services/api-server/src/modules/sessions/services/session-websocket-token.service.ts` | Per-session WebSocket token signing and verification |
| `services/api-server/src/modules/sessions/services/user-sessions-websocket-token.service.ts` | User-scoped sidebar stream token signing and verification |
| `services/api-server/src/modules/github/services/github-app.service.ts` | GitHub App OAuth helpers |
| `services/api-server/src/shared/repositories/oauth-state-repository.ts` | State nonce CRUD; `peekRedirectOrigin` for the api-server callback |
| `services/api-server/src/shared/utils/crypto.ts` | Token encryption/decryption |
| `apps/web/app/api/auth/finalize/route.ts` | Exchanges code for session token, sets cookie, posts opener |
| `apps/web/app/api/[...path]/route.ts` | BFF proxy, cookie -> Bearer translation |
| `apps/web/hooks/use-auth.ts` | Client-side auth hook (login, logout, popup management) |
| `apps/web/hooks/use-websocket-token.ts` | Shared client token mint/retry lifecycle |
| `apps/web/hooks/use-session-websocket-token.ts` | Session WebSocket token adapter and initial-token handoff |
| `apps/web/hooks/use-user-sessions-websocket-token.ts` | User sessions stream token adapter |
| `apps/web/hooks/use-cloudflare-agent.ts` | Session socket connection through `useAgent` / PartySocket |
| `apps/web/hooks/use-user-sessions-websocket.ts` | Sidebar stream raw WebSocket connection and reconnect loop |
| `apps/web/lib/websocket-token.ts` | Client-side token expiry buffer helpers |

## Authentication Rules

- You can only create a session on a repo if you have access to it via its github app installation.
  We first check the installation that the repo is associated with, and then use the user's github access token to verify that the user can access that repo via the installation.
  Even if a user can access a repo, they may not have access to it via the installation.
- You can only create a repo environment for a repo if the same `assertUserRepoAccess(...)` path confirms access. Session creation resolves the selected environment through `RepoEnvironmentsService.resolveEnvironmentSnapshot(...)` and stores that immutable snapshot in the session Durable Object.
- You can only view a session if you created it (for now).
- You can only install the github app on a repo if you have admin access to it (this is a limitation of the github api).

Even after you create a session on a repo you have access to, you may lose access to it if the installation is deleted, you lose access to the repo, or the repo is removed from the installation. We handle this like so:

- Routes to create/get a session, mint a websocket token, connect a websocket, and send `chat.message` all check for access to the repo using `services/api-server/src/modules/sessions/services/session-repo-access.service.ts`.
  a. If we don't know the repo's installation_id, we have to look it up using `github-app.service.ts#findInstallationForRepoId`. This first checks D1 `github_installation_repos`, then falls back to the GitHub API.
  b. Check the `github_user_repo_access_cache` for this (user_id, repo_id, installation_id) (5 minute TTL)
  c. If no cache value exists, look up the repo using the GitHub API (the same route we use to fetch user-accessible repos). This path is slow, since we have to enumerate a user's repos, which is also why we cache it.

We use a D1 table `github_user_repo_access_cache` to cache user access to a repo within an installation. The cache TTL is 5 minutes.
Values are put to the cache when a user creates a session, or calls get /repos to list the repos they have access to.

If a fresh value is found in the cache, we return true in the access check.
If an installation is deleted, or repo is removed from the installation, we clear the relevant values from the cache.
