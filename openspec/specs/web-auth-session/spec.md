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
After OAuth and optional installation URL preparation, the API SHALL issue a one-time completion code and redirect to the attempt's allowlisted BFF completion route with the non-secret attempt ID and completion code. The raw claim token SHALL remain only in the encrypted HttpOnly cookie. OAuth denial SHALL return the attempt ID and error without a completion code.

#### Scenario: OAuth callback reaches the originating preview
- **WHEN** a web attempt was started from an allowlisted preview origin
- **THEN** the API returns to that exact preview's completion route

#### Scenario: Attempt IDs differ
- **WHEN** the completion query attempt ID does not match the BFF attempt cookie
- **THEN** the BFF refuses completion, sets no web session cookie, preserves the different active attempt cookie, and returns that tab to the retry surface

#### Scenario: Matching callback and cookie
- **WHEN** the BFF receives a completion code and attempt ID matching its claim cookie
- **THEN** it combines the callback code with the cookie claim to request API completion

#### Scenario: Callback lacks completion code
- **WHEN** the BFF receives a non-error callback without a completion code
- **THEN** it does not call completion or clear a newer attempt cookie

#### Scenario: OAuth denial reaches the BFF
- **WHEN** GitHub denies OAuth for a web attempt
- **THEN** the API redirects to `<bound-origin>/api/auth/github/complete?attemptId=<id>&error=OAUTH_DENIED`, and the BFF clears the matching attempt cookie and returns to the signed-out retry surface

### Requirement: Web session is established before installation navigation
The BFF completion route SHALL require the matching encrypted claim cookie and callback completion code before API completion, even when a valid web session already exists. Successful completion SHALL replace the session cookie, clear the attempt cookie, and immediately redirect to a clean final or installation URL containing no completion code. Without the exact callback-and-cookie pair, it SHALL preserve existing-session back-button and concurrent-tab behavior.

#### Scenario: Consumed completion URL is revisited
- **WHEN** the browser revisits a completion URL after successful sign-in and presents a valid normal web session cookie but no claim cookie
- **THEN** the BFF redirects to the default signed-in app route without calling attempt completion or rendering a signed-out error

#### Scenario: Installation already exists
- **WHEN** web completion returns the final application URL
- **THEN** the BFF sets the session cookie and redirects directly to that application URL

#### Scenario: Installation is missing
- **WHEN** web completion returns a GitHub App installation URL
- **THEN** the BFF sets the session cookie before redirecting the same tab to GitHub installation

#### Scenario: Callback receiver lacks starter cookie
- **WHEN** a browser receives the completion callback without the matching claim cookie
- **THEN** it cannot claim, does not call API completion, and preserves any newer claim cookie

#### Scenario: Starter lacks callback code
- **WHEN** the initiating browser has the claim cookie but no completion code
- **THEN** it cannot claim and does not call API completion

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
