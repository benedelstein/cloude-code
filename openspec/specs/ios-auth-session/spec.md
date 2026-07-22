# ios-auth-session Specification

## Purpose
TBD - created by archiving change add-auth-token-refresh. Update Purpose after archive.
## Requirements
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
The root view SHALL switch on auth state: loading indicator while restoring, the Home experience when refreshing or signed in, and a production GitHub sign-in view when signed out. A successful native sign-in attempt SHALL be adopted through `TokenCoordinator`; repository installation status SHALL NOT introduce another root authentication state.

#### Scenario: State transitions drive the UI
- **WHEN** the session store's state changes between loading, refreshing, signedIn, and signedOut
- **THEN** the root view renders the corresponding loading, Home, or GitHub sign-in experience

#### Scenario: Signed in without repository access
- **WHEN** OAuth succeeds and the native session is adopted before installation approval or repository availability
- **THEN** the root view renders Home rather than an installation-pending authentication screen

### Requirement: iOS uses the explicit native GitHub sign-in contract
The iOS unauthenticated auth API SHALL start GitHub sign-in through `/auth/github/native/start` and complete it through `/auth/github/native/complete`. Its app-facing start value SHALL contain only the authorization URL, attempt ID, and claim token; iOS SHALL NOT exchange the GitHub authorization code directly. `SessionStore` SHALL keep the attempt ID, raw claim token, and callback completion code only in memory for the active sign-in operation and SHALL NOT write them to Keychain, `UserDefaults`, other persistence, analytics, or logs.

#### Scenario: Native sign-in starts
- **WHEN** `SessionStore` requests a GitHub sign-in attempt
- **THEN** `UnauthenticatedAuthAPI` returns a native attempt value with an authorization URL, attempt ID, and claim token

#### Scenario: Native sign-in completes
- **WHEN** `SessionStore` completes a callback-confirmed native attempt with both secrets
- **THEN** `UnauthenticatedAuthAPI` maps the concrete native completion response to a `Session` and user

#### Scenario: Legacy exchange API is absent
- **WHEN** the iOS API module is compiled after the change
- **THEN** `SignInProviding` has no direct OAuth-code exchange or continuation-token method

#### Scenario: App terminates during sign-in
- **WHEN** the app is terminated before the active native attempt is claimed
- **THEN** the app persists no attempt credentials, abandons that attempt, and starts a new attempt on the next sign-in while the abandoned server row expires normally

### Requirement: OAuth and installation share one system web-auth presentation
`SessionStore` SHALL open the native attempt's authorization URL in one `ASWebAuthenticationSession`. The server MAY navigate that same presentation from OAuth to GitHub App installation before returning to the configured custom scheme, but the app SHALL NOT start a second web-auth session automatically.

#### Scenario: Installation already exists
- **WHEN** OAuth completes for a user with an existing installation
- **THEN** the same web-auth session returns directly to the app callback

#### Scenario: Installation is missing
- **WHEN** OAuth completes for a user without an installation
- **THEN** the same web-auth session navigates to GitHub App setup and then returns to the app callback

### Requirement: Native callback matches the started attempt
The custom-scheme callback SHALL include the non-secret attempt ID and one-time completion code. `SessionStore` SHALL verify that the ID equals the attempt it started and the code is nonempty before sending the attempt ID, in-memory claim token, and callback code to native completion. Neither secret SHALL be persisted or logged.

#### Scenario: Matching callback
- **WHEN** the custom-scheme callback carries the current attempt ID and completion code
- **THEN** `SessionStore` sends both separated secrets and adopts the returned session through `TokenCoordinator`

#### Scenario: Mismatched callback
- **WHEN** the custom-scheme callback carries a different or missing attempt ID or completion code
- **THEN** `SessionStore` rejects the callback, adopts no session, and presents a retryable sign-in error

#### Scenario: OAuth denial callback
- **WHEN** the custom-scheme callback carries the current attempt ID and `error=OAUTH_DENIED`
- **THEN** `SessionStore` adopts no session and presents a retryable sign-in error

### Requirement: Browser dismissal is silent and cannot issue a session
When `ASWebAuthenticationSession` reports `.canceledLogin`, `SessionStore` SHALL remain signed out silently and SHALL NOT call native completion, whether dismissal happens before or after OAuth. A retry SHALL create a fresh attempt and one new web-auth presentation.

#### Scenario: Installation is dismissed after OAuth
- **WHEN** OAuth made the attempt identity-ready and the user dismisses GitHub App setup
- **THEN** the app remains signed out without a completion request because no final callback delivered a completion code

#### Scenario: Organization approval remains pending
- **WHEN** OAuth made the attempt identity-ready but installation cannot finish without organization approval
- **THEN** dismissal leaves the app silently signed out and retry starts a new attempt

#### Scenario: User cancels before OAuth
- **WHEN** the browser closes while the attempt is still awaiting OAuth
- **THEN** the app remains signed out without showing a failure or calling completion

#### Scenario: Retry after cancellation
- **WHEN** the user retries after a dismissal
- **THEN** `SessionStore` starts a new server attempt and opens exactly one new web-auth session

### Requirement: Repository access does not gate native authentication
After native completion, the iOS app SHALL enter its normal signed-in state even if the repository API returns no repositories. Repository management SHALL remain available through a separate authenticated action labeled **Manage repositories on GitHub**.

#### Scenario: Signed in with no repositories
- **WHEN** a native session is adopted and the refreshed repository list is empty
- **THEN** the repository picker renders its normal empty state with the separate management action

#### Scenario: Repository access changes later
- **WHEN** the user returns from repository management or a webhook updates installation scope
- **THEN** the active repository listing and search are refreshed without repeating sign-in
