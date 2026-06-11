# Spec: ios-auth-session

## ADDED Requirements

### Requirement: Session persists in the keychain
The iOS app SHALL persist the session (access token, refresh token, both expiries, and userId) in the device keychain via Valet with `.afterFirstUnlock` accessibility. Signing out SHALL clear it.

#### Scenario: Session survives relaunch
- **WHEN** the app is killed and relaunched after signing in
- **THEN** the session is restored from the keychain without re-authentication

#### Scenario: Sign-out clears the keychain
- **WHEN** the user signs out
- **THEN** no session data remains in the keychain and the app shows the signed-out state

### Requirement: Startup restore
On launch the app SHALL: load the session from the keychain; if absent, enter the signed-out state; if present with a stale access token, refresh before use; if present and valid, enter the signed-in state and load the current user from the local cache, fetching from the network only if missing.

#### Scenario: Valid session restores offline
- **WHEN** the app launches with a valid (non-stale) session and a cached user
- **THEN** the app shows the signed-in UI without any network request

#### Scenario: Stale access token at launch
- **WHEN** the app launches with a session whose access token is stale
- **THEN** the app refreshes via `/auth/refresh` before entering the signed-in state

#### Scenario: No stored session
- **WHEN** the app launches with an empty keychain
- **THEN** the app shows the signed-out view

### Requirement: Single-flight refresh coordination
All refresh paths (eager timer and on-demand) SHALL converge on one in-flight refresh: concurrent requests for a token while a refresh is running MUST await the same refresh task rather than issuing duplicate `/auth/refresh` calls.

#### Scenario: Concurrent stale requests
- **WHEN** multiple API requests ask the token provider for a token while the access token is stale
- **THEN** exactly one `/auth/refresh` request is issued and all callers receive the new access token

### Requirement: Eager refresh timer
While signed in, the app SHALL schedule a refresh ahead of access-token expiry (2-minute lead) using a deadline-anchored sleep, re-armed after every successful refresh and on session adoption.

#### Scenario: Token refreshed before expiry
- **WHEN** the access token approaches expiry while the app is foregrounded
- **THEN** the app refreshes proactively and API requests never observe a stale token

### Requirement: Stale-token requests refresh on demand
The token provider (`AuthTokenProviding` implementation) SHALL return the current access token when fresh, and trigger (or join) a refresh when stale, returning the refreshed token. Each API that requires auth SHALL hold the provider and attach `Authorization: Bearer` per request; the HTTP transport (`APIClient`) SHALL remain auth-unaware, and the refresh request itself SHALL carry no Authorization header.

#### Scenario: Request with stale token
- **WHEN** an API request asks for a token after the eager timer missed (e.g. app was suspended)
- **THEN** the provider refreshes first and the request proceeds with the new token

### Requirement: Terminal refresh failure signs out
A 401 from `/auth/refresh` (refresh token rejected) SHALL clear the keychain and flip the app to the signed-out state. Transient errors (network, 5xx) SHALL NOT destroy the session.

#### Scenario: Refresh token revoked server-side
- **WHEN** `/auth/refresh` returns 401
- **THEN** the session is cleared and the root view switches to signed-out

#### Scenario: Refresh fails with a network error
- **WHEN** `/auth/refresh` fails with a connectivity error
- **THEN** the session is retained and a later refresh attempt may succeed

### Requirement: Auth-gated root view
The root view SHALL switch on auth state: loading indicator while restoring, the Home experience when signed in, and a signed-out placeholder view otherwise. DEBUG builds SHALL provide a token-injection affordance in the signed-out view for testing (no production login UI in this change).

#### Scenario: State transitions drive the UI
- **WHEN** the session store's state changes between loading, signedIn, and signedOut
- **THEN** the root view renders the corresponding screen
