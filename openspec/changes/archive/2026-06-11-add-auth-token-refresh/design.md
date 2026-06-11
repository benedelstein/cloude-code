# Design: Auth Token Refresh

## Context

- Server auth today: GitHub OAuth → `POST /auth/token` exchanges `{code, state}` for one opaque UUID session token (30-day row in `auth_sessions`, validated per request by `auth.middleware.ts` via D1 lookup). No refresh endpoint. Web app stores the token in a cookie and proxies requests.
- iOS today: `APIClient` (Modules/API) accepts an optional `authProvider: any AuthTokenProviding` (`authToken() async throws -> String?`) and attaches `Authorization: Bearer`; it is currently constructed with no provider. This change **removes** auth from `APIClient` (see D5a). No keychain code. `RootView` unconditionally shows Home.
- Reference patterns: `Session.restore()` keychain restore with userId, `APIAuthorizer` actor single-flight refresh; gallery — token-provider protocol injected via Needle, SessionStore singleton.

## Goals / Non-Goals

**Goals:**

- Short-lived access token + rotating refresh token for native clients; instant revocation preserved.
- Web client untouched (no `client` field → byte-identical legacy behavior).
- iOS: keychain-persisted session, startup restore without network when possible, eager timer refresh + on-demand stale refresh sharing one single-flight mutex, auth-gated root view.
- `Modules/API` stays networking-only: keychain/persistence/auth state live in app target `CloudeCode/Core/Auth/`.

**Non-Goals:**

- Login UI (ASWebAuthenticationSession) — later change; DEBUG token injection only.
- JWT access tokens — deferred, not rejected: planned eventual switch (server-only; see D1). v1 stays opaque/DB-backed.
- Migrating web to refresh tokens.
- Hashing access tokens in `auth_sessions` (pre-existing plaintext PK; follow-up).

## Decisions

### D1. Opaque DB-backed access tokens (not JWT)

The middleware already does a per-request D1 lookup; keeping access tokens as short-lived `auth_sessions` rows means zero middleware changes and instant revocation — which the rotation/reuse-detection design depends on. Client only ever sees `accessToken` + `expiresAt`, so flipping to JWT later is a server-only change. Alternative considered: JWT + signature verification — rejected for v1 (key management, revocation loss, two validation paths, no DB read actually saved while revocation checks exist).

**Planned direction**: we intend to switch access tokens to JWT eventually (stateless verification). To keep that migration server-only, the iOS client MUST treat the access token as an opaque string and use `accessTokenExpiresAt` from the response for staleness — never decode token contents (unlike aircut, which parses JWT expiry from the token itself). Refresh tokens stay opaque DB-backed even post-JWT (revocation anchor).

### D2. Session family model

A native session = one `auth_refresh_sessions` "family" row + one current short-lived `auth_sessions` row linked by `refresh_session_id`. Refresh = rotate family's refresh token hash + replace the access row. Web sessions are simply `auth_sessions` rows with `refresh_session_id IS NULL`.

```sql
-- migrations/0022_auth_refresh_sessions.sql
CREATE TABLE auth_refresh_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  refresh_token_hash TEXT NOT NULL UNIQUE,        -- SHA-256 hex of current token
  previous_refresh_token_hash TEXT,               -- rotated-out hash (reuse detection)
  previous_rotated_at TEXT,                       -- grace-window anchor
  refresh_expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
ALTER TABLE auth_sessions ADD COLUMN refresh_session_id TEXT;
CREATE INDEX idx_auth_sessions_refresh_session ON auth_sessions(refresh_session_id);
CREATE INDEX idx_auth_refresh_sessions_user ON auth_refresh_sessions(user_id);
-- lookups match current OR previous hash; UNIQUE only indexes the current one
CREATE INDEX idx_auth_refresh_sessions_prev_hash ON auth_refresh_sessions(previous_refresh_token_hash);
```

No FK cascade (D1 ALTER limitations); the repository deletes family + access rows in one `database.batch` (existing pattern: `revokeAllSessionsByGithubId`).

### D3. TTLs, rotation, reuse detection

Access 30 min; refresh 60 days sliding. Every `/auth/refresh` rotates: new refresh token, `previous_refresh_token_hash` kept valid for a 60s grace window (network-retry tolerance). Presenting the previous hash outside grace = reuse → revoke family (both tokens die). Tokens are 32 random bytes base64url; refresh tokens stored as SHA-256 (reuse the existing `sha256` helper in `src/shared/utils/crypto.ts:71` — no new helper).

```ts
// auth.service.ts (shape)
const ACCESS_TOKEN_TTL_MS = 30 * 60 * 1000;
const REFRESH_TOKEN_TTL_MS = 60 * 24 * 60 * 60 * 1000;
const ROTATION_GRACE_MS = 60_000;

async refreshSession(refreshToken: string): Promise<AuthServiceResult<RefreshResponse>> {
  const hash = await sha256Hex(refreshToken);
  const found = await repo.getRefreshSessionByTokenHash(hash);   // matches current OR previous
  if (!found || isExpired(found.refreshExpiresAt)) return err(401, "INVALID_REFRESH_TOKEN");
  if (found.matched === "previous" && outsideGrace(found.previousRotatedAt)) {
    await repo.revokeRefreshSession(found.id);                   // reuse detected
    return err(401, "INVALID_REFRESH_TOKEN");
  }
  const next = generateTokenPair();                              // access + refresh + expiries
  await repo.rotateRefreshSession({ ... });                      // batch: update family, swap access row
  return ok(next);
}
```

### D4. Web-compatible contract (additive only)

```ts
// packages/api-contract/src/auth.ts
export const TokenRequest = z.object({
  code: z.string(),
  state: z.string(),
  client: z.enum(["web", "native"]).optional(),   // absent → legacy path
});
export const TokenResponse = z.object({
  token: z.string(),                              // web session token OR native access token
  user: UserInfo,
  hasInstallations: z.boolean(),
  installUrl: z.string(),
  accessTokenExpiresAt: z.iso.datetime().optional(),  // native only ↓
  refreshToken: z.string().optional(),
  refreshTokenExpiresAt: z.iso.datetime().optional(),
});
export const RefreshRequest = z.object({ refreshToken: z.string() });
export const RefreshResponse = z.object({
  accessToken: z.string(),
  accessTokenExpiresAt: z.iso.datetime(),
  refreshToken: z.string(),
  refreshTokenExpiresAt: z.iso.datetime(),
});
```

`POST /auth/refresh` is registered **without** auth middleware (the refresh token is the credential). A server test pins the legacy response shape (no new keys when `client` is absent).

### D5. iOS placement — app target `Core/Auth/`, API stays transport

`Modules/API` gains only the `auth/refresh` endpoint on `AuthAPI` (networking). The `Session` struct goes in `Modules/Domain` (pure Sendable). Everything stateful — keychain persistence, refresh coordination, auth state — lives in the app target under `CloudeCode/Core/Auth/`, with Valet (latest 5.1.0) added as an app-target SPM dependency. Alternative considered: new `Modules/Auth` package — rejected (3 files don't justify a package); putting Valet in Modules/API — rejected (API is networking-only).

```swift
// Modules/Domain/Sources/Domain/Session.swift
public struct Session: Sendable, Equatable, Codable {
    public let accessToken: String
    public let accessTokenExpiresAt: Date
    public let refreshToken: String
    public let refreshTokenExpiresAt: Date
    public let userId: String          // aircut pattern: lets startup load the user from cache

    public func isAccessTokenStale(margin: TimeInterval = 60, now: Date = Date()) -> Bool {
        now.addingTimeInterval(margin) >= accessTokenExpiresAt
    }
}
```

Access and refresh tokens are deliberately one struct: they're issued together, every refresh replaces both, and they're revoked together — one logical credential, one atomic keychain write. Separate storage (aircut uses separate keychain keys) only creates desync states to handle.

### D5a. Auth headers are a per-API concern, not transport
`APIClient` should not know about auth tokens — callers know which requests need which headers (gallery and aircut both work this way: each API holds the token provider and attaches the Bearer header per request). So: **remove `authProvider` from `APIClient`**; each API struct that needs auth takes `tokenProvider: any AuthTokenProviding` in its initializer and passes the header through the existing `APIRequest.headers`. This also makes "endpoints that must NOT carry auth" (`auth/refresh`, the future token exchange) natural — no second unauthenticated client needed. `AuthTokenProviding` stays in `Modules/API/Core` (it's the contract between APIs and whoever owns tokens); the implementation lives in the app target. Trade-off: a forgotten header is a runtime 401 rather than impossible-by-construction — mitigated by a one-line `bearerHeaders()` helper and the handful of API types.

```swift
// Modules/API/Sources/API/Core/AuthTokenProviding.swift (existing protocol, plus helper)
public protocol AuthTokenProviding: Sendable {
    func authToken() async throws -> String?
}

public extension AuthTokenProviding {
    /// `["Authorization": "Bearer <token>"]`, or throws if signed out.
    func bearerHeaders() async throws -> [String: String] {
        guard let token = try await authToken() else { throw APIError.unauthenticated }
        return ["Authorization": "Bearer \(token)"]
    }
}
```

Refresh gets its **own API type** with no token provider — it's the one auth call that must never carry a Bearer header, and keeping it separate breaks the DI cycle (the coordinator would otherwise need an `AuthAPI` that needs the coordinator):

```swift
// Modules/API/Sources/API/Auth/SessionRefreshAPI.swift (new — networking only)
private struct PostRefresh: APIRequest {
    typealias Body = CoreAPI.RefreshRequest
    typealias Response = CoreAPI.RefreshResponse
    var body: CoreAPI.RefreshRequest?
    var path: String { "auth/refresh" }
    var method: HTTPMethod { .post }
    // No auth header: the refresh token in the body is the credential.
}

public protocol SessionRefreshing: Sendable {
    func refresh(refreshToken: String, userId: String) async throws -> Session  // ISO → Date at boundary
}

public struct SessionRefreshAPI: SessionRefreshing {
    private let client: APIClient    // no token provider — structurally unauthenticated

    public func refresh(refreshToken: String, userId: String) async throws -> Session {
        let response = try await client.fetch(PostRefresh(body: .init(refreshToken: refreshToken)))
        // ISO strings → Date here; unparseable dates throw (decodingFailed),
        // never fabricate a session with bogus expiries.
        return try Session(from: response, userId: userId)
    }
}
```

```swift
// Modules/API/Sources/API/Auth/AuthAPI.swift (modified — authed endpoints only)
public struct AuthAPI: AuthAPIProviding {
    private let client: APIClient
    private let tokenProvider: any AuthTokenProviding

    public func me() async throws -> User {
        try await User(from: client.fetch(GetMe(headers: tokenProvider.bearerHeaders())))
    }
}
```

`SessionsAPI` (and future authed APIs) follow the same pattern: hold `tokenProvider`, pass `headers: try await tokenProvider.bearerHeaders()` into each request. Request structs gain a `headers` stored property (the `APIRequest` protocol already supports per-request headers).

### D6. TokenCoordinator actor — single-flight refresh (aircut's APIAuthorizer)

One actor owns the session value, keychain writes, the eager timer, and the idempotent mutex. Both refresh paths (timer + on-demand from `authToken()`) converge on `refresh()`; concurrent callers await the same in-flight `Task`. Re-entrancy is structurally impossible: `PostRefresh` carries no auth header (D5a), so refreshing never calls back into `authToken()`.

```swift
// CloudeCode/Core/Auth/TokenCoordinator.swift
enum AuthEvent: Sendable { case signedIn(Session), refreshed(Session), signedOut }

actor TokenCoordinator: AuthTokenProviding {
    private let persistence: any SessionPersisting
    private let refresher: any SessionRefreshing       // provider-free by construction
    private var session: Session?
    private var refreshTask: Task<Session, any Error>? // single-flight mutex
    private var timerTask: Task<Void, Never>?
    private let continuation: AsyncStream<AuthEvent>.Continuation
    nonisolated let events: AsyncStream<AuthEvent>

    /// Startup: keychain → nil = signed out; stale access → refresh; valid → arm timer.
    func restore() async -> Session? {
        guard let stored = try? persistence.load() else { return nil }
        session = stored
        if stored.isAccessTokenStale() {
            return try? await refresh()                // failure → signedOut event already emitted
        }
        scheduleEagerRefresh(for: stored)
        return stored
    }

    // AuthTokenProviding — every APIClient request lands here.
    func authToken() async throws -> String? {
        guard let session else { return nil }
        guard session.isAccessTokenStale() else { return session.accessToken }
        return try await refresh().accessToken
    }

    func refresh() async throws -> Session {
        if let inFlight = refreshTask { return try await inFlight.value }  // idempotent
        guard let current = session else { throw APIError.unauthenticated }
        let task = Task { [refresher] in
            try await refresher.refresh(refreshToken: current.refreshToken, userId: current.userId)
        }
        refreshTask = task
        defer { refreshTask = nil }
        do {
            let fresh = try await task.value
            adoptInternal(fresh)
            continuation.yield(.refreshed(fresh))
            return fresh
        } catch APIError.unauthenticated {             // refresh token rejected: terminal
            clearSession()
            continuation.yield(.signedOut)
            throw APIError.unauthenticated
        }                                              // other errors: transient, session kept
    }

    func adopt(_ new: Session) {                       // dev injection now, real login later
        adoptInternal(new)
        continuation.yield(.signedIn(new))
    }

    func signOut() {
        clearSession()
        continuation.yield(.signedOut)
    }

    private func adoptInternal(_ new: Session) {
        session = new
        try? persistence.save(new)
        scheduleEagerRefresh(for: new)
    }

    private func clearSession() {
        session = nil
        try? persistence.clear()
        timerTask?.cancel()
        timerTask = nil
    }

    private func scheduleEagerRefresh(for session: Session) {
        timerTask?.cancel()
        timerTask = Task { [weak self] in
            let fireIn = session.accessTokenExpiresAt.timeIntervalSinceNow - 120  // 2 min lead
            try? await Task.sleep(for: .seconds(max(1, fireIn)))
            guard !Task.isCancelled else { return }
            _ = try? await self?.refresh()             // transient failure → on-demand path covers
        }
    }
}
```

```swift
// CloudeCode/Core/Auth/SessionPersisting.swift
protocol SessionPersisting: Sendable {
    func load() throws -> Session?
    func save(_ session: Session) throws
    func clear() throws
}

// CloudeCode/Core/Auth/KeychainSessionPersistence.swift
// App-group Valet (gallery pattern) so widgets/extensions can share the session
// later. The group ID is per-environment, injected via Config/*.xcconfig →
// Info.plist (`AppGroupIdentifier`), same flow as APIBaseURL — e.g.
// group.llc.bze.CloudeCode (prod) / group.llc.bze.CloudeCode-Dev (dev).
// Requires the App Groups capability on the app target for both bundle IDs.
struct KeychainSessionPersistence: SessionPersisting {
    private let valet: Valet

    init(appGroup: String) {
        valet = Valet.sharedGroupValet(
            with: SharedGroupIdentifier(groupPrefix: "group", nonEmptyGroup: appGroup)!,
            accessibility: .afterFirstUnlock
        )
    }

    private static let key = "auth.session"

    func load() throws -> Session? {
        guard let data = try? valet.object(forKey: Self.key) else { return nil }
        return try JSONDecoder().decode(Session.self, from: data)
    }
    func save(_ session: Session) throws {
        try valet.setObject(JSONEncoder().encode(session), forKey: Self.key)
    }
    func clear() throws {
        try valet.removeObject(forKey: Self.key)
    }
}
```

### D7. SessionStore + root view gate

```swift
// CloudeCode/Core/Auth/SessionStore.swift
@MainActor @Observable
final class SessionStore {
    enum State: Equatable { case loading, signedIn, signedOut }

    private(set) var state: State = .loading
    private(set) var user: UserModel?
    private let coordinator: TokenCoordinator
    private let userStore: UserStore

    func start() async {
        guard let session = await coordinator.restore() else {
            state = .signedOut
            return
        }
        state = .signedIn
        // Cache first, network if missing (UserStore cascade).
        user = try? await userStore.get([session.userId], scopes: .all).first
        for await event in coordinator.events {
            switch event {
            case .signedIn(let session):
                state = .signedIn
                user = try? await userStore.get([session.userId], scopes: .all).first
            case .signedOut:
                user = nil
                state = .signedOut
            case .refreshed:
                break
            }
        }
    }

    func signOut() async { await coordinator.signOut() }

    #if DEBUG
    /// Adopts a placeholder session with an already-stale access token, then refreshes.
    func injectDevSession(refreshToken: String, userId: String) async { ... }
    #endif
}
```

```swift
// CloudeCode/App/RootView.swift
var body: some View {
    Group {
        switch sessionStore.state {
        case .loading: ProgressView()
        case .signedIn: HomeContainer()
        case .signedOut: SignedOutView()   // placeholder + DEBUG token paste; login seam later
        }
    }
    .task { await sessionStore.start() }
    .themedRoot()
}
```

```swift
// CloudeCode/Core/DI/ApplicationComponent.swift (additions; apiClient loses authProvider)
var apiClient: APIClient {
    shared { APIClient(baseURL: apiBaseURL) }          // pure transport
}
var tokenCoordinator: TokenCoordinator {
    shared {
        TokenCoordinator(
            persistence: KeychainSessionPersistence(appGroup: appGroupIdentifier),
            refresher: SessionRefreshAPI(client: apiClient)   // no provider — no cycle
        )
    }
}
var authAPI: any AuthAPIProviding {
    shared { AuthAPI(client: apiClient, tokenProvider: tokenCoordinator) }
}
var sessionsAPI: any SessionsAPIProviding {
    shared { SessionsAPI(client: apiClient, tokenProvider: tokenCoordinator) }
}
@MainActor var sessionStore: SessionStore {
    shared { SessionStore(coordinator: tokenCoordinator, userStore: userStore) }
}
```

Dependency graph is acyclic: `SessionRefreshAPI` → `APIClient`; `TokenCoordinator` → `SessionRefreshAPI` + persistence; authed APIs → `APIClient` + `TokenCoordinator`. (`appGroupIdentifier` reads `AppGroupIdentifier` from Info.plist, like `apiBaseURL`.)

WebSockets need no changes beyond `SessionsAPI` gaining the provider: `WebSocketTokenCache` → `SessionsAPI` (attaches Bearer) → coordinator, so WS upgrade tokens are always minted with a fresh access token.

## Risks / Trade-offs

- [Web regression] → opt-in `client` field only; test pins legacy JSON shape; manual web sign-in check.
- [D1 ALTER/FK limits] → no FK; batch deletes in repository (existing pattern).
- [Grace-window reuse detection is best-effort] → acceptable v1; no per-rotation history table.
- [Access tokens plaintext in `auth_sessions`] → pre-existing; hashing is a follow-up.
- [`Session.userId` derives from exchange/injection, not refresh] → refresh response carries no user; coordinator threads userId through (refresher signature takes it).
- [Keychain survives app deletion] → stale sessions may restore after reinstall; refresh failure path degrades cleanly to signed-out.
- [Per-API headers: a forgotten `bearerHeaders()` = runtime 401, not compile error] → shared helper, few API types, E2E checks cover every authed surface.

## Migration Plan

1. Land contract + codegen (additive; no consumer breaks).
2. Apply D1 migration; deploy server (legacy path untouched → safe).
3. Land iOS. Rollback = revert iOS; server endpoints are additive and can stay.

## Open Questions

- Dev token minting ergonomics: curl recipe vs `wrangler d1 execute` inserts — pick during implementation.
- Should `/auth/token` native path also return `user.id` separately? (It already returns `user`; iOS persists `user.id` into `Session.userId` — no change needed.)

