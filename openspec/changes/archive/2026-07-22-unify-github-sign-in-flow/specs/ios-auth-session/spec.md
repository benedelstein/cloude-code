## ADDED Requirements

### Requirement: iOS uses the explicit native GitHub sign-in contract
The iOS unauthenticated auth API SHALL start GitHub sign-in through `/auth/github/native/start` and complete it through `/auth/github/native/complete`. Its app-facing start value SHALL contain only the authorization URL, attempt ID, and claim token; iOS SHALL NOT exchange the GitHub authorization code directly. `SessionStore` SHALL keep the attempt ID and raw claim token only in memory for the active sign-in operation and SHALL NOT write them to Keychain, `UserDefaults`, other persistence, analytics, or logs.

#### Scenario: Native sign-in starts
- **WHEN** `SessionStore` requests a GitHub sign-in attempt
- **THEN** `UnauthenticatedAuthAPI` returns a native attempt value with an authorization URL, attempt ID, and claim token

#### Scenario: Native sign-in completes
- **WHEN** `SessionStore` completes an identity-ready native attempt
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
The custom-scheme callback SHALL include the non-secret attempt ID. `SessionStore` SHALL verify that it equals the attempt it started before sending the stored attempt ID and claim token to native completion.

#### Scenario: Matching callback
- **WHEN** the custom-scheme callback carries the current attempt ID
- **THEN** `SessionStore` completes that attempt and adopts the returned session through `TokenCoordinator`

#### Scenario: Mismatched callback
- **WHEN** the custom-scheme callback carries a different or missing attempt ID
- **THEN** `SessionStore` rejects the callback, adopts no session, and presents a retryable sign-in error

#### Scenario: OAuth denial callback
- **WHEN** the custom-scheme callback carries the current attempt ID and `error=OAUTH_DENIED`
- **THEN** `SessionStore` adopts no session and presents a retryable sign-in error

### Requirement: Browser dismissal recovers completed OAuth
When `ASWebAuthenticationSession` reports `.canceledLogin`, `SessionStore` SHALL try native completion with the current attempt credentials. It SHALL adopt a returned session when the stored attempt has `status == "identity_ready"`. When the stored attempt has `status == "awaiting_oauth"`, the API SHALL return `error.code == "SIGN_IN_NOT_READY"`, which iOS SHALL treat as cancellation before OAuth rather than as a sign-in failure.

#### Scenario: Installation is dismissed after OAuth
- **WHEN** OAuth made the attempt identity-ready and the user dismisses GitHub App setup
- **THEN** native completion succeeds and the app enters its normal signed-in state

#### Scenario: Organization approval remains pending
- **WHEN** OAuth made the attempt identity-ready but installation cannot finish without organization approval
- **THEN** the app can adopt the native session and show its normal signed-in repository-empty state

#### Scenario: User cancels before OAuth
- **WHEN** the browser closes while the attempt is still awaiting OAuth
- **THEN** native completion returns `SIGN_IN_NOT_READY` and the app remains signed out without showing a failure toast

#### Scenario: OAuth callback is still racing cancellation
- **WHEN** cancellation recovery initially receives `SIGN_IN_NOT_READY` while the OAuth callback is completing
- **THEN** `SessionStore` performs only a short bounded retry for that error code and adopts the session if the attempt becomes ready

### Requirement: Repository access does not gate native authentication
After native completion, the iOS app SHALL enter its normal signed-in state even if the repository API returns no repositories. Repository management SHALL remain available through a separate authenticated action labeled **Manage repositories on GitHub**.

#### Scenario: Signed in with no repositories
- **WHEN** a native session is adopted and the refreshed repository list is empty
- **THEN** the repository picker renders its normal empty state with the separate management action

#### Scenario: Repository access changes later
- **WHEN** the user returns from repository management or a webhook updates installation scope
- **THEN** the active repository listing and search are refreshed without repeating sign-in

## MODIFIED Requirements

### Requirement: Auth-gated root view
The root view SHALL switch on auth state: loading indicator while restoring, the Home experience when refreshing or signed in, and a production GitHub sign-in view when signed out. A successful native sign-in attempt SHALL be adopted through `TokenCoordinator`; repository installation status SHALL NOT introduce another root authentication state.

#### Scenario: State transitions drive the UI
- **WHEN** the session store's state changes between loading, refreshing, signedIn, and signedOut
- **THEN** the root view renders the corresponding loading, Home, or GitHub sign-in experience

#### Scenario: Signed in without repository access
- **WHEN** OAuth succeeds and the native session is adopted before installation approval or repository availability
- **THEN** the root view renders Home rather than an installation-pending authentication screen
