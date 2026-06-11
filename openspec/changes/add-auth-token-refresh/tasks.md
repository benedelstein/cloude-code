# Tasks: add-auth-token-refresh

## 1. Contract + codegen

- [x] 1.1 Extend `packages/api-contract/src/auth.ts`: `TokenRequest.client`, optional native fields on `TokenResponse`, new `RefreshRequest`/`RefreshResponse` (per design D4); export from index
- [x] 1.2 Run `pnpm --filter @repo/api-contract codegen`; fix fixtures if `codegen:check` complains; commit regenerated `Auth.generated.swift`
- [x] 1.3 `pnpm --filter @repo/api-contract typecheck && test`

## 2. Server

- [x] 2.1 Migration `services/api-server/migrations/0022_auth_refresh_sessions.sql` (design D2); apply locally via wrangler d1
- [x] 2.2 Reuse existing `sha256` in `src/shared/utils/crypto.ts:71` for refresh-token hashing (add base64url token generator if none exists)
- [x] 2.3 Repository methods in `user-session.repository.ts`: `createRefreshSessionWithAccessToken`, `getRefreshSessionByTokenHash` (current OR previous hash, reports which), `rotateRefreshSession`, `revokeRefreshSession`, `getRefreshSessionIdByAccessToken`
- [x] 2.4 `auth.service.ts`: TTL constants, native branch in `exchangeGitHubAuthorizationCode`, `refreshSession()` with grace/reuse logic (design D3), family-aware `logout`
- [x] 2.5 Routes: `POST /auth/refresh` in `auth.schema.ts` + `auth.routes.ts`, registered without auth middleware
- [x] 2.6 Tests `tests/lib/auth-refresh.test.ts`: legacy-shape pin, native pair issuance, rotation invalidates old access token, grace retry, post-grace reuse revokes family, family logout (mock-D1 pattern from `tests/lib/user-session.service.test.ts`; extend the mock with `batch` support)
- [x] 2.7 `pnpm --filter @repo/api-server typecheck && lint && test`; update `docs/auth.md`

## 3. iOS — Domain + API (networking only)

- [x] 3.1 `Modules/Domain/Sources/Domain/Session.swift` (design D5) — `swift build` in Domain
- [x] 3.2 `Modules/API`: remove `authProvider` from `APIClient` (pure transport); add `AuthTokenProviding.bearerHeaders()` helper (design D5a)
- [x] 3.3 `Modules/API`: new `SessionRefreshAPI` (`SessionRefreshing` protocol, `PostRefresh` with no auth header, ISO→Date mapping; provider-free by construction — design D5a); `AuthAPI`/`SessionsAPI` take `tokenProvider: any AuthTokenProviding` and attach Bearer per authed request — `swift build` in API

## 4. iOS — Core/Auth (app target)

- [x] 4.1 Add square/Valet SPM dependency to the app target (CloudeCode.xcodeproj)
- [x] 4.2 App Groups: add capability/entitlements for both bundle IDs; per-env `AppGroupIdentifier` via Config/*.xcconfig → Info.plist (group.llc.bze.CloudeCode / -Dev)
- [x] 4.3 `CloudeCode/Core/Auth/SessionPersisting.swift` + `KeychainSessionPersistence.swift` using app-group Valet (design D6)
- [x] 4.4 `CloudeCode/Core/Auth/TokenCoordinator.swift`: actor with restore/authToken/refresh (single-flight mutex), eager timer (2-min lead, deadline-anchored), adopt/signOut, `events` stream (design D6)
- [x] 4.5 `CloudeCode/Core/Auth/SessionStore.swift`: @MainActor @Observable, start() startup flow (restore → user from cache→network via UserStore), event consumption, DEBUG `injectDevSession` (design D7)

## 5. iOS — wiring + UI

- [x] 5.1 `ApplicationComponent`: `tokenCoordinator`; `authAPI`/`sessionsAPI` constructed with `tokenProvider: tokenCoordinator`; `apiClient` stays providerless; `sessionStore`; regenerate Needle
- [x] 5.2 `Features/SignedOut/SignedOutView.swift`: placeholder + `#if DEBUG` refresh-token/userId paste form
- [x] 5.3 `RootView`: switch on `sessionStore.state` (loading/signedIn/signedOut), `.task { await sessionStore.start() }`
- [x] 5.4 `swiftlint lint --strict --no-cache` + `xcodebuild ... CloudeCode ... build` green

## 6. End-to-end verification

- [x] 6.1 Web regression: web typecheck + local sign-in still issues legacy 30-day token (no new response keys)
- [x] 6.2 Mint a dev native session against local server (curl `client:"native"` exchange or `wrangler d1 execute` inserts); document the recipe
- [ ] 6.3 Manual E2E on Dev scheme: signed-out → inject tokens → Home works (`/auth/me`, sessions, websockets); kill+relaunch restores from keychain without network
- [ ] 6.4 Shorten access TTL locally: verify eager refresh fires, and concurrent stale requests produce exactly one `/auth/refresh` (server logs)
- [ ] 6.5 Delete refresh row in D1 → next refresh flips app to signed-out
