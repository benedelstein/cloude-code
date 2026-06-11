# Add Auth Token Refresh

## Why

The iOS app needs auth, and the current contract can't support it well: the api-server issues a single opaque 30-day session token with no refresh endpoint, so a leaked token is valid for a month and clients have no way to hold short-lived credentials. Mobile-standard auth is a short-lived access token + long-lived rotating refresh token stored in the keychain. The iOS app currently has no token storage, no auth state, and `APIClient` sends unauthenticated requests.

## What Changes

- **Server**: new `POST /auth/refresh` endpoint; native clients (opt-in via `client: "native"` on `POST /auth/token`) receive a 30-minute access token + 60-day rotating refresh token. Refresh rotates the refresh token (60s grace window for retries; reuse outside grace revokes the whole session family). Logout revokes the family. Web client behavior is unchanged (no `client` field → existing 30-day token, byte-identical response).
- **Contract** (`packages/api-contract`): additive `TokenRequest.client`, optional native fields on `TokenResponse`, new `RefreshRequest`/`RefreshResponse`; regenerated Swift types.
- **iOS**: `Session` domain struct (access + refresh tokens + expiries + userId); keychain persistence via Valet; `TokenCoordinator` actor (single-flight refresh mutex, eager refresh timer, on-demand refresh when stale) implementing the existing `AuthTokenProviding` so every `APIClient` request carries a fresh Bearer token; `SessionStore` (`@MainActor @Observable`) with startup restore (keychain → refresh if stale → user from cache, network if missing); root view switches signed-in/signed-out. **No login UI this pass** — DEBUG-only token injection; ASWebAuthenticationSession comes later.
- All auth/session state and keychain code lives in the app target (`CloudeCode/Core/Auth/`), not `Modules/API` (API stays networking-only).

## Capabilities

### New Capabilities
- `auth-token-refresh`: server-side native session issuance, refresh rotation, reuse detection, and revocation semantics.
- `ios-auth-session`: iOS session lifecycle — keychain persistence, startup restore, eager + on-demand refresh with single-flight coordination, auth-gated root view.

### Modified Capabilities
<!-- none: existing specs (user-sessions-stream, voice-input) are unaffected; web auth requirements unchanged -->

## Impact

- `services/api-server`: auth module (service, repository, routes, schema), new D1 migration (`auth_refresh_sessions` table + `auth_sessions.refresh_session_id` column), `docs/auth.md`.
- `packages/api-contract/src/auth.ts` + regenerated `apps/ios/Modules/CoreAPI/.../Auth.generated.swift`.
- `apps/ios`: `Modules/Domain` (Session struct), `Modules/API` (refresh endpoint on AuthAPI only), app target `Core/Auth/` (new), `Core/DI/ApplicationComponent`, `App/RootView`, new `Features/SignedOut/`; new SPM dependency square/Valet (app target).
- `apps/web`: no changes (regression-tested).
