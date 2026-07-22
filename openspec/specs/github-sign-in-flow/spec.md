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
The API SHALL generate independent random attempt IDs, claim tokens, and completion codes; store only cryptographic hashes of claim and completion secrets; and bind validated completion/final redirect targets at attempt creation. Callback parameters SHALL NOT replace a stored redirect target. The raw completion code SHALL appear only in the necessary final callback URL and SHALL NOT be stored in installation callback state.

#### Scenario: Claim token is persisted safely
- **WHEN** a sign-in attempt is stored
- **THEN** its raw claim token is returned only to the initiating client adapter and is absent from the database row, redirect URLs, and logs

#### Scenario: Completion code is persisted safely
- **WHEN** an identity-ready attempt reaches its actual final browser handoff
- **THEN** the API stores only its completion-code hash and returns the raw code exactly once in that final callback URL

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
- **THEN** its setup callback remains eligible to issue the one-time completion code without extending expiry

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

### Requirement: OAuth completion establishes an identity before final handoff
After a valid OAuth exchange, the API SHALL upsert the GitHub identity, persist encrypted GitHub credentials, attach the user to the attempt, and mark the attempt `identity_ready` before optional installation navigation. Identity readiness alone SHALL NOT permit session completion.

#### Scenario: Identity becomes ready
- **WHEN** GitHub OAuth succeeds for an awaiting sign-in attempt
- **THEN** the attempt becomes identity-ready but remains unclaimable until the API issues a completion code at the final handoff

#### Scenario: OAuth exchange fails
- **WHEN** GitHub rejects the authorization code
- **THEN** the attempt becomes failed, no completion code is issued, and no web or native session can be claimed

#### Scenario: User denies OAuth
- **WHEN** GitHub returns an OAuth denial with the attempt's valid state
- **THEN** the API consumes the state, marks the attempt failed, and redirects with the attempt ID and `error=OAUTH_DENIED` but no completion code

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
- **THEN** web remains signed in because it claimed before installation, while native remains silently signed out without a final callback and can start a fresh attempt

### Requirement: Installation callback state is separate and non-authoritative
GitHub installation navigation SHALL use dedicated one-time installation-state purposes for post-claim web sign-in, chained native sign-in finalization, and authenticated repository management. State SHALL bind the initiating user, validated return information, expiration, and an attempt only when native finalization requires it. Consuming state SHALL NOT treat browser setup parameters as installation evidence. A web installation return SHALL remain independent of the claimed or expired web attempt.

#### Scenario: Valid native sign-in installation callback
- **WHEN** a validated unconsumed native sign-in installation state returns while its attempt is unexpired and identity-ready
- **THEN** the API issues the completion code once and redirects to the attempt's allowlisted custom scheme

#### Scenario: Valid web installation callback after claim
- **WHEN** a validated web sign-in installation state returns after the web attempt was claimed or expired
- **THEN** the API returns to the stored web route without reading or finalizing the attempt

#### Scenario: Forged setup parameters
- **WHEN** a callback includes an `installation_id`, `setup_action`, or repository values not established by webhook processing or a fresh GitHub listing
- **THEN** those values do not create or authorize any local installation, repository record, completion code, or session

#### Scenario: Installation state replay
- **WHEN** a consumed or expired installation state is presented again
- **THEN** the API rejects the callback and does not issue another completion code or redirect to a client-controlled target

### Requirement: Web completion returns only a web session
`POST /auth/github/web/complete` SHALL require an attempt ID, initiator claim token, and callback completion code for an unexpired completion-ready web attempt, create the existing opaque web session, and return the token, user, and server-selected redirect URL.

#### Scenario: Web completion succeeds
- **WHEN** the BFF presents the matching claim token and completion code for a completion-ready web attempt
- **THEN** the API returns an opaque web session token and never includes native access or refresh-token fields

#### Scenario: Web completion selects installation navigation
- **WHEN** the web attempt has a pending chained installation flow
- **THEN** the completion response's redirect URL is that server-generated GitHub installation URL

#### Scenario: Web completion selects final return
- **WHEN** the web attempt has no pending installation flow
- **THEN** the completion response's redirect URL is the validated final web return URL

### Requirement: Native completion returns only a native session
`POST /auth/github/native/complete` SHALL require an attempt ID, initiator claim token, and callback completion code for an unexpired completion-ready native attempt and create the existing native refresh-session family and signed access token.

#### Scenario: Native completion succeeds
- **WHEN** iOS presents the matching claim token and completion code after the final custom-scheme callback
- **THEN** the API returns an access token, refresh token, refresh-token expiry, and user without web-token or redirect fields

#### Scenario: No callback means no session
- **WHEN** OAuth established an identity but the native browser is dismissed before the final callback
- **THEN** no completion code is available and the API issues no native session

### Requirement: Sign-in completion is at-most-once and callback-bound
The API SHALL verify both presented secret hashes before disclosing attempt state. Only an unexpired, correctly client-bound `completion_ready` attempt with the matching claim token and completion code SHALL atomically transition to `claimed` and issue a session. All other completion failures SHALL return `INVALID_SIGN_IN_ATTEMPT` without a readiness oracle.

#### Scenario: Duplicate completion
- **WHEN** a successful attempt completion is submitted again
- **THEN** the API rejects it as `INVALID_SIGN_IN_ATTEMPT` and creates no second session

#### Scenario: Authorization link is transferred
- **WHEN** the starter holds only the claim token and the callback receiver holds only the completion code
- **THEN** neither party can claim the session independently

#### Scenario: Secrets from different attempts
- **WHEN** a claim token and completion code from different attempts are combined
- **THEN** completion returns `INVALID_SIGN_IN_ATTEMPT` and issues no session

#### Scenario: Concurrent completion
- **WHEN** two valid completion requests race for the same completion-ready attempt
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
