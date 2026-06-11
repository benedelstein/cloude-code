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
  |                            |                            #   { state, redirect_origin,
  |                            |                            #     purpose }
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
  |                            |   (middleware validates app session
  |                            |    and returns user identity only)
  |                            |                            |
  |                            |<-- response ---------------|
  |<-- response ---------------|                            |
```

## Key Design Decisions

- **HTTP-only cookie**: The session token is stored as an HTTP-only, secure, sameSite=lax cookie. Client JS cannot access it, mitigating XSS token theft.
- **Server-side sessions**: Session tokens are random UUIDs stored in D1, not JWTs. This makes them revocable (delete the row to log out).
- **BFF proxy**: The Next.js `/api/[...path]` catch-all extracts the cookie and forwards it as a `Bearer` token. The API server only deals with Bearer auth.
- **Identity-only app auth**: Auth middleware validates only the app session token and returns user identity (`id`, GitHub profile fields). It does not join, decrypt, validate, or refresh GitHub credentials.
- **Encrypted GitHub tokens**: GitHub access/refresh tokens are stored separately in `user_github_credentials` and encrypted with `TOKEN_ENCRYPTION_KEY`.
- **GitHub credential provider**: Routes and services that need GitHub user-scoped access explicitly resolve credentials with `getValidGitHubCredentialByUserId(...)`. Missing, revoked, or unrefreshable credentials return `GITHUB_AUTH_REQUIRED`; transient refresh/API failures return `GITHUB_UNAVAILABLE`.
- **State token (nonce)**: A random single-use state token with 10-min expiry prevents CSRF on the OAuth callback. Consumed atomically via `DELETE ... RETURNING`.
- **Origin-bound state**: The state row carries a `redirect_origin` column. The browser passes its `window.location.origin` on `/auth/github`; the server validates it (see allowlist below) and records it against the state. The api-server's `/auth/callback` reads this origin to decide where to 302 the popup. The redirect target is therefore never trusted from URL parameters — only from server-recorded state.
- **Preview-origin allowlist**: `PREVIEW_ORIGIN_ALLOWLIST_REGEX` pins the Vercel project name *and* team slug as literals (e.g. `^https://cloude-code-[a-z0-9][a-z0-9-]*-benedelsteins-projects\.vercel\.app$`). Vercel team slugs are globally unique, so no other team can produce a URL matching the regex. The prod origin (`WEB_ORIGIN`) is exempt. Validated both on write (when state is created) and on read (at callback time) for defense-in-depth.
- **Allowlist**: Only GitHub logins in `ALLOWED_GITHUB_LOGINS` can authenticate.
- **GitHub reauth without app logout**: Authenticated reauth endpoints (`POST /auth/github/reauth/start`, `POST /auth/github/reauth/token`) run the GitHub OAuth flow again, verify the returned GitHub user id matches the current app user, and update only `user_github_credentials`. They do not create or replace an app auth session.

## Native Client Sessions (Access + Refresh Tokens)

Native clients (the iOS app) opt in by sending `client: "native"` on `POST /auth/token`. Web behavior is unchanged: requests without the `client` field get the legacy 30-day session token and a byte-identical response shape.

The native path returns a short-lived access token plus a long-lived rotating refresh token:

- `token` — opaque access token, 30-minute TTL (an `auth_sessions` row, validated by the same middleware as web tokens; `accessTokenExpiresAt` is returned alongside).
- `refreshToken` — opaque 32-byte base64url token, 60-day sliding TTL. Stored only as a SHA-256 hash in `auth_refresh_sessions`; the raw value is returned exactly once per rotation.

A native session is a "family": one `auth_refresh_sessions` row plus the current `auth_sessions` row linked via `auth_sessions.refresh_session_id` (NULL for web sessions).

### Refresh rotation

`POST /auth/refresh` accepts `{ refreshToken }` with no Authorization header (the refresh token is the credential) and is registered without auth middleware. A valid refresh:

1. Rotates the refresh token: the new hash becomes current, the presented hash is kept as `previous_refresh_token_hash` with `previous_rotated_at`.
2. Replaces the family's access-token row (the old access token stops authenticating immediately).
3. Extends the refresh expiry (sliding 60 days).
4. Returns `{ accessToken, accessTokenExpiresAt, refreshToken, refreshTokenExpiresAt }`.

Invalid, expired, or reused tokens return `401` with `INVALID_REFRESH_TOKEN`.

### Grace window and reuse detection

The previous refresh token stays valid for 60 seconds after rotation so a client that lost the response to a network failure can retry. Presenting the previous token *outside* that window is treated as token theft: the whole family is revoked (refresh token and current access token both die).

### Logout

`POST /auth/logout` with a native access token revokes the family (refresh token included). Legacy web tokens keep single-row deletion.

Access tokens stay opaque DB-backed rows for now; a later switch to JWT access tokens would be server-only (clients never decode the token and use `accessTokenExpiresAt` for staleness).

### Dev: minting a native session locally

The real exchange needs a GitHub OAuth code, so for local testing insert a session family directly into local D1 (server can be running; D1 state is shared):

```bash
cd services/api-server

# 1. Generate a token pair + hashes
python3 - <<'EOF'
import secrets, hashlib, base64, uuid, datetime
b64url = lambda b: base64.urlsafe_b64encode(b).rstrip(b'=').decode()
access, refresh = b64url(secrets.token_bytes(32)), b64url(secrets.token_bytes(32))
now = datetime.datetime.now(datetime.timezone.utc)
print("access token: ", access)
print("refresh token:", refresh)
print("refresh hash: ", hashlib.sha256(refresh.encode()).hexdigest())
print("family id:    ", uuid.uuid4())
print("access exp:   ", (now + datetime.timedelta(minutes=30)).strftime('%Y-%m-%dT%H:%M:%S.000Z'))
print("refresh exp:  ", (now + datetime.timedelta(days=60)).strftime('%Y-%m-%dT%H:%M:%S.000Z'))
EOF

# 2. Find your user id
pnpm exec wrangler d1 execute cloude-code-db --local \
  --command "SELECT id, github_login FROM users"

# 3. Insert the family + access row (substitute values from steps 1-2)
pnpm exec wrangler d1 execute cloude-code-db --local --command "
INSERT INTO auth_refresh_sessions (id, user_id, refresh_token_hash, refresh_expires_at)
VALUES ('<family-id>', '<user-id>', '<refresh-hash>', '<refresh-exp>');
INSERT INTO auth_sessions (token, user_id, expires_at, refresh_session_id)
VALUES ('<access-token>', '<user-id>', '<access-exp>', '<family-id>');
"

# 4. Verify
curl -s http://localhost:8787/auth/me -H "Authorization: Bearer <access-token>"
curl -s -X POST http://localhost:8787/auth/refresh \
  -H "Content-Type: application/json" -d '{"refreshToken":"<refresh-token>"}'
```

Paste the refresh token + user id into the iOS Dev scheme's signed-out DEBUG form to sign the simulator in (the app refreshes immediately, so the rotated-out raw tokens above stop mattering).

## GitHub Reauth Flow

GitHub remains the only app identity provider, but app auth and GitHub API credentials are separate runtime concerns.

- Login state uses `purpose = "github_login"` and creates both an app session row and GitHub credential row.
- Reauth state uses `purpose = "github_reauth"` plus the current `user_id`.
- `/auth/callback` peeks the state purpose and bounces login callbacks to `/api/auth/finalize`, but reauth callbacks to `/api/auth/github/reauth/finalize`.
- Login finalize sets the app session cookie. Reauth finalize posts a reauth popup message and does not set the session cookie.
- Reauth token exchange rejects a GitHub account mismatch before updating credentials.
- Revoking GitHub App user authorization deletes the stored GitHub credentials, not the app session.

After credentials are missing or revoked, identity-only routes still work: `/auth/me`, `/auth/logout`, sidebar/session list, settings shell, and other routes that need only `user.id`. GitHub-dependent routes return `GITHUB_AUTH_REQUIRED` until the user reauthenticates.

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
| `services/api-server/src/modules/auth/routes/auth.routes.ts` | OAuth endpoints: `GET /auth/github`, `GET /auth/callback` (302 bouncer), `POST /auth/token`, GitHub reauth endpoints, logout |
| `services/api-server/src/modules/auth/middleware/auth.middleware.ts` | App session validation and identity attachment |
| `services/api-server/src/modules/auth/services/user-session.service.ts` | App session lookup plus explicit GitHub credential resolution/refresh helpers |
| `services/api-server/src/modules/auth/utils/preview-origin.util.ts` | Validates redirect origin against `WEB_ORIGIN` and `PREVIEW_ORIGIN_ALLOWLIST_REGEX` |
| `services/api-server/src/modules/session-agent/routes/agent.routes.ts` | Session WebSocket upgrade token validation and repo-access gate |
| `services/api-server/src/modules/sessions/routes/sessions.routes.ts` | User sessions stream token validation and token mint routes |
| `services/api-server/src/modules/sessions/services/session-websocket-token.service.ts` | Per-session WebSocket token signing and verification |
| `services/api-server/src/modules/sessions/services/user-sessions-websocket-token.service.ts` | User-scoped sidebar stream token signing and verification |
| `services/api-server/src/modules/github/services/github-app.service.ts` | GitHub App OAuth helpers |
| `services/api-server/src/shared/repositories/oauth-state-repository.ts` | State nonce CRUD; `peek` for the api-server callback |
| `services/api-server/src/shared/utils/crypto.ts` | Token encryption/decryption |
| `apps/web/app/api/auth/finalize/route.ts` | Exchanges code for session token, sets cookie, posts opener |
| `apps/web/app/api/auth/github/reauth/finalize/route.ts` | Exchanges reauth code, updates GitHub credentials, posts opener without setting app session cookie |
| `apps/web/app/api/[...path]/route.ts` | BFF proxy, cookie -> Bearer translation |
| `apps/web/hooks/use-auth.ts` | Client-side auth hook (login, logout, popup management) |
| `apps/web/hooks/use-github-reauth.ts` | Client-side GitHub reauth popup management |
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
- GitHub user access tokens cannot be generated server-side from only the app private key or an installation id. The app can exchange a fresh user authorization code or refresh an existing valid refresh token. If no stored credential exists and no refresh is possible, GitHub user-scoped routes fail with `GITHUB_AUTH_REQUIRED` while the app auth session remains valid.
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
