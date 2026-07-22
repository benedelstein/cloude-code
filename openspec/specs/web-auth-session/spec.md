# web-auth-session Specification

## Purpose
Define the web BFF GitHub sign-in journey, including same-tab navigation, temporary claim-cookie handling, web session establishment, installation returns, and recoverable failures.

## Requirements
### Requirement: Web sign-in uses same-tab navigation
The web client SHALL start GitHub sign-in by navigating the current top-level page to a same-origin BFF start route. It SHALL NOT require a popup, secondary tab, opener reference, popup polling, or `postMessage` to complete authentication.

#### Scenario: User selects Sign in
- **WHEN** a user activates the web GitHub sign-in action
- **THEN** the current page navigates to the BFF start route and is redirected to GitHub

#### Scenario: Popup APIs are unavailable
- **WHEN** the browser blocks or disables `window.open`
- **THEN** GitHub sign-in remains functional because the flow uses ordinary top-level redirects

### Requirement: The BFF securely starts a web attempt
The BFF start route SHALL validate a relative same-origin `returnTo`, call the API's web start route using the existing API origin allowlist, store the returned attempt ID and claim token in an HttpOnly cookie with `Max-Age=600` seconds, and redirect to the returned authorization URL. The cookie lifetime SHALL equal the API's 10-minute web-attempt lifetime. The relative `returnTo` validation and persistence are new; production, local-development, and preview-origin validation are reused.

#### Scenario: Valid return path
- **WHEN** the start route receives a valid relative application path
- **THEN** the BFF binds it to the attempt and begins GitHub authorization

#### Scenario: External return target
- **WHEN** the start route receives an absolute, protocol-relative, or otherwise cross-origin return target
- **THEN** the BFF rejects or replaces it with the default same-origin signed-in route

#### Scenario: Attempt cookie attributes
- **WHEN** the BFF stores web attempt credentials
- **THEN** the cookie is HttpOnly, Secure outside local development, SameSite=Lax, narrowly scoped, and has `Max-Age=600` seconds

### Requirement: OAuth returns through web completion
After the API completes OAuth for a web attempt, it SHALL redirect to the attempt's allowlisted origin at the BFF completion route with only the non-secret attempt ID. The raw claim token SHALL remain only in the BFF cookie. An OAuth denial SHALL use the same route with the attempt ID and `error=OAUTH_DENIED`.

#### Scenario: OAuth callback reaches the originating preview
- **WHEN** a web attempt was started from an allowlisted preview origin
- **THEN** the API returns to that exact preview's completion route

#### Scenario: Attempt IDs differ
- **WHEN** the completion query attempt ID does not match the BFF attempt cookie
- **THEN** the BFF refuses completion, sets no web session cookie, preserves the different active attempt cookie, and returns that tab to the retry surface

#### Scenario: OAuth denial reaches the BFF
- **WHEN** GitHub denies OAuth for a web attempt
- **THEN** the API redirects to `<bound-origin>/api/auth/github/complete?attemptId=<id>&error=OAUTH_DENIED`, and the BFF clears the matching attempt cookie and returns to the signed-out retry surface

### Requirement: Web session is established before installation navigation
The BFF completion route SHALL first process a claim cookie whose attempt ID matches the query, even when a valid normal web session already exists; successful completion replaces that session cookie. If no matching claim cookie exists, the route SHALL redirect a request with a valid normal web session to the default signed-in app route. If neither condition holds, it SHALL render the retryable signed-out error surface. After a successful claim, it SHALL clear the temporary attempt cookie before redirecting to the API-selected next URL.

#### Scenario: Consumed completion URL is revisited
- **WHEN** the browser revisits a completion URL after successful sign-in and presents a valid normal web session cookie but no claim cookie
- **THEN** the BFF redirects to the default signed-in app route without calling attempt completion or rendering a signed-out error

#### Scenario: Installation already exists
- **WHEN** web completion returns the final application URL
- **THEN** the BFF sets the session cookie and redirects directly to that application URL

#### Scenario: Installation is missing
- **WHEN** web completion returns a GitHub App installation URL
- **THEN** the BFF sets the session cookie before redirecting the same tab to GitHub installation

#### Scenario: Installation is abandoned
- **WHEN** the user leaves or cancels GitHub App installation after web completion
- **THEN** returning to the web application finds the user already authenticated

#### Scenario: Two tabs start sign-in
- **WHEN** two tabs start web sign-in on the same browser origin before either completes
- **THEN** the later start replaces the claim cookie, an older mismatched callback reaches the retry surface without clearing that cookie, and the later attempt remains completable

### Requirement: Web installation returns to the intended application route
The GitHub installation setup callback SHALL return a chained web flow to its server-stored final URL, where the previously established session cookie authorizes the user.

#### Scenario: Installation callback completes
- **WHEN** GitHub returns a valid installation state after setup
- **THEN** the browser returns to the validated `returnTo` route in the same tab

#### Scenario: Organization approval is pending
- **WHEN** setup returns but the installation is awaiting approval
- **THEN** the signed-in application loads normally and renders repository availability from the repository API

### Requirement: Web authentication failures return to a recoverable UI
When no valid normal web session exists, the BFF SHALL clear matching temporary attempt state and return the browser to a same-origin signed-out error surface when start or completion fails. It SHALL preserve a nonmatching active attempt cookie because it belongs to a newer flow. It SHALL NOT leave the application in a permanent loading state.

#### Scenario: OAuth is denied
- **WHEN** GitHub returns an OAuth denial or the callback cannot complete the attempt
- **THEN** the user returns to the signed-out UI with a retryable sign-in error

#### Scenario: Attempt expires
- **WHEN** the BFF attempts to complete an expired sign-in attempt
- **THEN** it clears the temporary cookie and returns the user to a fresh sign-in action
