## MODIFIED Requirements

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

### Requirement: Installation callback state is separate and non-authoritative
GitHub installation navigation SHALL use dedicated one-time installation-state purposes for post-claim web sign-in, chained native sign-in finalization, and authenticated repository management. State SHALL bind the initiating user, validated return information, expiration, and an attempt only when native finalization requires it. Consuming state SHALL NOT treat browser setup parameters as installation evidence. A web installation return SHALL remain independent of the claimed or expired web attempt.

#### Scenario: Valid native sign-in installation callback
- **WHEN** a validated unconsumed native sign-in installation state returns while its attempt is unexpired and identity-ready
- **THEN** the API issues the completion code once and redirects to the attempt's allowlisted custom scheme

#### Scenario: Valid web installation callback after claim
- **WHEN** a validated web sign-in installation state returns after the web attempt was claimed or expired
- **THEN** the API returns to the stored web route without reading or finalizing the attempt

#### Scenario: Forged setup parameters
- **WHEN** a callback includes `installation_id`, `setup_action`, browser, or repository values not established by webhook processing or a fresh GitHub listing
- **THEN** those values do not create or authorize any local installation, repository record, completion code, or session

#### Scenario: Installation state replay
- **WHEN** a consumed or expired installation state is presented again
- **THEN** the API rejects the callback and does not issue another completion code or redirect to a client-controlled target

### Requirement: Web completion returns only a web session
`POST /auth/github/web/complete` SHALL require an attempt ID, initiator claim token, and callback completion code for an unexpired completion-ready web attempt, create the existing opaque web session, and return the token, user, and server-selected redirect URL.

#### Scenario: Exact web pair succeeds
- **WHEN** the BFF presents the matching claim token and completion code for a completion-ready web attempt
- **THEN** the API returns one opaque web session and no native token fields

#### Scenario: Web installation is pending
- **WHEN** the web attempt prepared an installation URL before the completion code handoff
- **THEN** successful web completion returns that installation URL after creating the web session

### Requirement: Native completion returns only a native session
`POST /auth/github/native/complete` SHALL require an attempt ID, initiator claim token, and callback completion code for an unexpired completion-ready native attempt and create the existing native refresh-session family and signed access token.

#### Scenario: Exact native pair succeeds
- **WHEN** iOS presents the matching claim token and completion code after the final custom-scheme callback
- **THEN** the API returns one access/refresh token pair and user without web-token or redirect fields

#### Scenario: No callback means no session
- **WHEN** OAuth established an identity but the native browser is dismissed before the final callback
- **THEN** no completion code is available and the API issues no native session

### Requirement: Sign-in completion is at-most-once and callback-bound
The API SHALL verify both presented secret hashes before disclosing attempt state. Only an unexpired, correctly client-bound `completion_ready` attempt with the matching claim token and completion code SHALL atomically transition to `claimed` and issue a session. All other completion failures SHALL return `INVALID_SIGN_IN_ATTEMPT` without a readiness oracle.

#### Scenario: Authorization link is transferred
- **WHEN** the starter holds only the claim token and the callback receiver holds only the completion code
- **THEN** neither party can claim the session independently

#### Scenario: Secrets from different attempts
- **WHEN** a claim token and completion code from different attempts are combined
- **THEN** completion returns `INVALID_SIGN_IN_ATTEMPT` and issues no session

#### Scenario: Duplicate or concurrent completion
- **WHEN** duplicate valid completions race or a claimed attempt is retried
- **THEN** exactly one request creates a session and all others return `INVALID_SIGN_IN_ATTEMPT`

#### Scenario: Uniform invalid outcomes
- **WHEN** an attempt is pending, failed, expired, wrong-client, already claimed, or supplied either wrong or missing secret
- **THEN** completion returns `INVALID_SIGN_IN_ATTEMPT` and reveals no readiness distinction
