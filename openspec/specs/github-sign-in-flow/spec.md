# github-sign-in-flow Specification

## Purpose
Define the shared API-side GitHub sign-in attempt lifecycle for web and native clients, including protected claim credentials, OAuth and installation navigation, and client-specific session completion.

## Requirements
### Requirement: Client-bound GitHub sign-in attempts
The API SHALL create GitHub sign-in attempts through explicit web and native start routes. The selected route SHALL bind the attempt to that client type, and neither start request SHALL accept a client-type or repository-setup selector.

#### Scenario: Web route creates a web attempt
- **WHEN** the web BFF sends a valid request to `/auth/github/web/start`
- **THEN** the API creates a web-bound sign-in attempt and returns its authorization URL, attempt ID, and claim token

#### Scenario: Native route creates a native attempt
- **WHEN** iOS sends a valid request to `/auth/github/native/start`
- **THEN** the API creates a native-bound sign-in attempt and returns its authorization URL, attempt ID, and claim token

#### Scenario: Wrong completion route
- **WHEN** a client presents a valid native attempt to the web completion route or a valid web attempt to the native completion route
- **THEN** the API rejects it as `INVALID_SIGN_IN_ATTEMPT` and issues no session

### Requirement: Attempt credentials and redirect targets are protected
The API SHALL generate independent random attempt IDs and claim tokens, store only a cryptographic hash of each claim token, and bind validated completion/final redirect targets at attempt creation. Callback parameters SHALL NOT replace a stored redirect target.

#### Scenario: Claim token is persisted safely
- **WHEN** a sign-in attempt is stored
- **THEN** its raw claim token is returned only to the initiating client adapter and is absent from the database row, redirect URLs, and logs

#### Scenario: Unapproved web origin
- **WHEN** the web start route receives an origin outside the production, development, and preview allowlists
- **THEN** the API rejects the start request without creating an attempt

#### Scenario: Unapproved native redirect
- **WHEN** the native start route receives a redirect URI outside the exact native allowlist
- **THEN** the API rejects the start request without creating an attempt

### Requirement: Sign-in attempt lifetimes are client-bound and fixed
The API SHALL expire web sign-in attempts 10 minutes after creation and native sign-in attempts 30 minutes after creation. It SHALL NOT extend either deadline when OAuth or installation navigation changes the attempt state. OAuth-state rows SHALL expire 10 minutes after creation, and installation callback-state rows SHALL expire 30 minutes after creation.

#### Scenario: Web attempt reaches its deadline
- **WHEN** 10 minutes have elapsed since a web sign-in attempt was created
- **THEN** the API rejects completion as `INVALID_SIGN_IN_ATTEMPT` even if OAuth previously made the identity ready

#### Scenario: Native attempt remains valid through installation navigation
- **WHEN** a native attempt is identity-ready and less than 30 minutes old while GitHub App setup is still in progress
- **THEN** its valid claim credentials remain eligible for native completion

#### Scenario: Attempt transitions do not extend expiry
- **WHEN** OAuth or installation navigation changes the state of a sign-in attempt
- **THEN** its original web or native expiration timestamp remains unchanged

### Requirement: OAuth state is one-time and distinct from the sign-in attempt
Each sign-in attempt SHALL receive a fresh one-time OAuth state referencing the attempt. The GitHub OAuth callback SHALL consume that state before code exchange and SHALL NOT reuse it as a sign-in completion or installation callback credential.

#### Scenario: Valid OAuth callback
- **WHEN** GitHub returns a code with a valid unconsumed state for an awaiting attempt
- **THEN** the API consumes the state and exchanges the code exactly once

#### Scenario: OAuth state replay
- **WHEN** the same OAuth state is presented after it has been consumed
- **THEN** the API rejects the callback and performs no second code exchange

#### Scenario: Expired OAuth state
- **WHEN** GitHub returns after the OAuth state or referenced attempt has expired
- **THEN** the API rejects the callback and issues no session

### Requirement: OAuth completion establishes a claimable identity
After a valid OAuth exchange, the API SHALL upsert the GitHub identity, persist encrypted GitHub credentials, attach the user to the attempt, and mark the attempt `identity_ready` before optional installation navigation.

#### Scenario: Identity becomes ready
- **WHEN** GitHub OAuth succeeds for an awaiting sign-in attempt
- **THEN** the attempt becomes claimable for its bound client even if GitHub App installation has not completed

#### Scenario: OAuth exchange fails
- **WHEN** GitHub rejects the authorization code
- **THEN** the attempt does not become identity-ready and no web or native session can be claimed

#### Scenario: User denies OAuth
- **WHEN** GitHub returns an OAuth denial with the attempt's valid state
- **THEN** the API consumes the state, marks the attempt failed, and redirects without issuing a session: web uses `<bound-origin>/api/auth/github/complete?attemptId=<id>&error=OAUTH_DENIED`, while native uses `<bound-custom-scheme>?attemptId=<id>&error=OAUTH_DENIED`

### Requirement: Missing installation is handled automatically
After OAuth succeeds, the API SHALL check whether the GitHub user has an App installation. It SHALL continue the same browser journey to GitHub App installation when none exists and SHALL proceed directly toward client completion when one exists.

#### Scenario: Installation already exists
- **WHEN** OAuth succeeds and GitHub reports at least one App installation
- **THEN** the API creates no installation flow and continues toward the bound client's completion target

#### Scenario: Installation is missing
- **WHEN** OAuth succeeds and GitHub reports no App installation
- **THEN** the API creates a one-time GitHub installation flow and uses its URL as the next browser navigation

#### Scenario: Installation is canceled or awaiting approval
- **WHEN** OAuth has succeeded but installation is canceled, selects no repositories, or remains pending organization approval
- **THEN** the sign-in attempt remains identity-ready and can still produce the bound client session

### Requirement: Installation callback state is separate and non-authoritative
GitHub installation navigation SHALL use a dedicated one-time installation-state row in the existing temporary auth-state store, distinguished from OAuth state by purpose. It SHALL bind the initiating user, validated final redirect, expiration, and optional sign-in attempt. Consuming that state SHALL only authorize the return redirect and listing refresh; it SHALL NOT prove installation or repository access.

#### Scenario: Valid installation callback
- **WHEN** the configured setup callback receives a valid unconsumed installation state
- **THEN** the API consumes the state, clears relevant repository-listing synchronization metadata, and redirects to the stored target

#### Scenario: Forged setup parameters
- **WHEN** a callback includes an `installation_id`, `setup_action`, or repository values not established by webhook processing or a fresh GitHub listing
- **THEN** those values do not create or authorize any local installation or repository record

#### Scenario: Installation state replay
- **WHEN** a consumed or expired installation state is presented again
- **THEN** the API rejects the callback and does not redirect to a client-controlled target

### Requirement: Web completion returns only a web session
`POST /auth/github/web/complete` SHALL accept attempt credentials for an identity-ready web attempt, create the existing opaque long-lived web session, and return a concrete web completion response containing the token, user, and server-selected redirect URL.

#### Scenario: Web completion succeeds
- **WHEN** valid attempt credentials for an identity-ready web attempt are presented
- **THEN** the API returns an opaque web session token and never includes native access or refresh-token fields

#### Scenario: Web completion selects installation navigation
- **WHEN** the web attempt has a pending chained installation flow
- **THEN** the completion response's redirect URL is that server-generated GitHub installation URL

#### Scenario: Web completion selects final return
- **WHEN** the web attempt has no pending installation flow
- **THEN** the completion response's redirect URL is the validated final web return URL

### Requirement: Native completion returns only a native session
`POST /auth/github/native/complete` SHALL accept attempt credentials for an identity-ready native attempt, create the existing native refresh-session family and signed access token, and return a concrete native completion response.

#### Scenario: Native completion succeeds
- **WHEN** valid attempt credentials for an identity-ready native attempt are presented
- **THEN** the API returns an access token, refresh token, refresh-token expiry, and user without web-token or redirect fields

#### Scenario: Native completion is not ready
- **WHEN** valid credentials are presented while the native attempt is still awaiting OAuth
- **THEN** the API returns `SIGN_IN_NOT_READY` and issues no session

### Requirement: Sign-in completion is at-most-once
The API SHALL locate the attempt by ID and verify its claim-token hash with a constant-time comparison before disclosing its status. Only after token verification SHALL it evaluate expiry, client binding, and claimability before session issuance. It SHALL consume a successful claim so concurrent or repeated completions cannot issue additional sessions. Only an unexpired, correctly client-bound attempt with a valid claim token MAY return `SIGN_IN_NOT_READY`; all token mismatches SHALL return `INVALID_SIGN_IN_ATTEMPT` regardless of the stored status.

#### Scenario: Duplicate completion
- **WHEN** a successful attempt completion is submitted again
- **THEN** the API rejects it as `INVALID_SIGN_IN_ATTEMPT` and creates no second session

#### Scenario: Claim-token mismatch
- **WHEN** an attempt ID is paired with an incorrect claim token
- **THEN** the API rejects completion and does not reveal whether the attempt otherwise exists or is ready

#### Scenario: Concurrent completion
- **WHEN** two valid completion requests race for the same identity-ready attempt
- **THEN** exactly one request can create a session

### Requirement: Repository availability remains independent from authentication
Completing a sign-in attempt SHALL enter the normal authenticated state regardless of installation completion. Repository selection and repository-backed session creation SHALL continue to depend on the authoritative repository listing.

#### Scenario: Pending organization approval
- **WHEN** a signed-in user's GitHub App request is awaiting organization approval and `/repos` returns no repositories
- **THEN** the client shows its normal signed-in repository-empty state rather than an authentication-pending state

#### Scenario: Repository becomes available later
- **WHEN** webhook processing and a refreshed listing make a repository available after sign-in
- **THEN** the repository can be selected without repeating GitHub OAuth

### Requirement: Superseded sign-in contracts are removed
The system SHALL remove the generic GitHub sign-in start/direct-code-exchange and native continuation contract rather than maintain a compatibility path.

#### Scenario: New clients use explicit routes
- **WHEN** web and iOS are built after this change
- **THEN** they reference only the explicit web/native sign-in start and completion routes

#### Scenario: Removed continuation fields
- **WHEN** API contract code generation runs
- **THEN** generated TypeScript and Swift sign-in types contain no `continueToInstallation`, `continuationToken`, or `NativeLoginContinuationRequest`
