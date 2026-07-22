## Context

GitHub authentication and GitHub App installation are separate grants with separate lifecycles. A Cloude Code account and GitHub user credential are established by OAuth; repository-backed sessions additionally require repositories visible through a GitHub App installation. Repository access is therefore not an authentication gate.

The current implementation expresses that product flow differently per client:

- Web opens an OAuth popup, bounces the authorization code to the originating Next.js BFF, exchanges the code for an opaque session, and opens a second popup if installation is missing.
- iOS calls the generic GitHub authorization route with a native redirect and `continueToInstallation=true`. The API exchanges the OAuth code, consumes and recreates the same OAuth-state identifier as a native continuation, optionally redirects the same `ASWebAuthenticationSession` to installation, and later issues a token pair from `/auth/native/complete`.

The native continuation solves the two-system-prompt problem, but it is a client-specific orchestration encoded in the shared API contract. Reusing OAuth state after OAuth has completed also obscures the difference between OAuth CSRF validation, sign-in completion authorization, and GitHub installation callback correlation.

The API server already owns GitHub OAuth exchange, user and credential persistence, web-session issuance, native refresh-session issuance, redirect allowlists, and GitHub installation checks. The web BFF is the only component that can establish the HttpOnly cookie on the current web origin. The iOS app is the only component that can adopt a native token pair into Keychain. The design keeps those delivery responsibilities at the edges while moving the browser journey and identity transition into one server-owned flow.

The clients deliberately claim the completed identity at different points. The web BFF regains control immediately after OAuth, so it can claim the web session before sending the browser to GitHub App installation. `ASWebAuthenticationSession` gives iOS no control between those browser navigations, so native can claim only when the browser reaches the final custom-scheme callback or when the user dismisses the presentation.

## Goals / Non-Goals

**Goals:**

- Give web and iOS one server-owned GitHub sign-in state machine and one OAuth code exchange path.
- Bind client type through explicit web/native routes rather than a request field.
- Give each client a concrete completion response instead of a polymorphic response.
- Use one same-tab browser journey on web and one `ASWebAuthenticationSession` on iOS for OAuth plus installation when installation is missing.
- Make a completed OAuth identity claimable before installation completes, so cancellation or organization approval does not discard authentication.
- Separate OAuth state, sign-in claim credentials, and GitHub installation callback state in the data model and terminology.
- Preserve the existing web opaque-session and native access/refresh-token security models.
- Remove the superseded sign-in contracts in the same change without compatibility wrappers.

**Non-Goals:**

- Changing native refresh rotation, native logout, web-session validation, or GitHub credential reauthorization.
- Treating a browser installation callback as proof of repository access or replacing webhook/listing reconciliation.
- Adding another identity provider or building a generic external-auth workflow engine.
- Combining app sign-in attempts with `provider_auth_attempts`, which represents authorization for AI providers by an already authenticated app user.
- Changing session creation rules beyond preserving the existing requirement that a repository must be selected.

## Decisions

### D1. Routes establish client type and return concrete contracts

The public API will expose separate route pairs:

```text
POST /auth/github/web/start
POST /auth/github/web/complete

POST /auth/github/native/start
POST /auth/github/native/complete
```

The start routes share the same response shape because both return an authorization URL, attempt ID, and claim token. They accept different validated inputs:

```ts
WebGitHubSignInStartRequest = {
  origin: string;
  returnTo: string;
};

NativeGitHubSignInStartRequest = {
  redirectUri: string;
};

GitHubSignInStartResponse = {
  authorizeUrl: string;
  attemptId: string;
  claimToken: string;
};
```

Both completion routes accept `{ attemptId, claimToken }`, but their response schemas are deliberately separate:

```ts
WebGitHubSignInCompleteResponse = {
  token: string;
  user: UserInfo;
  redirectUrl: string;
};

NativeGitHubSignInCompleteResponse = {
  accessToken: string;
  refreshToken: string;
  refreshTokenExpiresAt: string;
  user: UserInfo;
};
```

The server records `client_type` when the start route creates the attempt. A completion route rejects an attempt belonging to the other client type. There is no `clientType`, `sessionType`, or installation-policy field in either request: the route and GitHub sign-in product behavior determine those values.

Alternative considered: one start/complete route with a delivery discriminator and a union response. Rejected because every caller already knows the credential type it requires, and explicit routes give TypeScript and Swift one concrete completion contract.

### D2. A sign-in attempt persists the identity transition beyond OAuth

Add a `sign_in_attempts` table and repository. An attempt contains:

- Random attempt ID.
- `client_type` (`web` or `native`).
- SHA-256 hash of a random claim token; the raw token is returned once to the initiating adapter and never logged.
- Validated completion and final return targets. Web reuses the existing allowlisted-origin validation and adds a relative same-origin `returnTo`; native stores an exact allowlisted custom-scheme URI.
- Status: `awaiting_oauth`, `identity_ready`, `claimed`, or `failed`.
- Nullable user ID, populated after OAuth.
- Expiration and timestamps.

Lifetimes are fixed at creation and are not extended by state transitions:

- Web sign-in attempts expire after 10 minutes, matching the existing OAuth-state budget because web claims the session before installation navigation.
- Native sign-in attempts expire after 30 minutes so one `ASWebAuthenticationSession` can cover OAuth, repository selection, and an organization-approval request before iOS claims the session.
- The OAuth-state row expires after the existing 10 minutes for both clients.

The attempt becomes `identity_ready` immediately after the API exchanges the OAuth code and persists the user credential. Installation progress is not an attempt status because it must not gate authentication.

The claim token is a bearer proof that authorizes the initiating adapter to claim the completed identity and issue its client-specific session. It does not confirm installation. It is separate from OAuth state, is verified with constant-time hash comparison, and makes completion at-most-once: concurrent or repeated successful claims cannot issue multiple sessions. Completion verifies the claim-token hash before disclosing attempt status. Only an unexpired, correctly client-bound attempt with a valid claim token may return the public error code `SIGN_IN_NOT_READY` when `status == "awaiting_oauth"`; an invalid, expired, already-claimed, token-mismatched, or wrong-client attempt returns `INVALID_SIGN_IN_ATTEMPT`.

Alternative considered: reuse `oauth_states` as the continuation record. Rejected because OAuth state should be consumed when the authorization response is validated, while the sign-in attempt must survive through optional installation and client session issuance.

Alternative considered: reuse `provider_auth_attempts`. Rejected because that table requires a known app user and belongs to AI-provider credentials, whereas a sign-in attempt exists before the user is known.

### D3. OAuth state remains single-purpose and one-time

The OAuth-state row receives a nullable `sign_in_attempt_id`. The start service creates a fresh OAuth state pointing to the new attempt. `/auth/callback` consumes that state exactly once before exchanging the GitHub code.

After exchange, the callback:

1. Upserts the GitHub identity.
2. Persists encrypted GitHub access/refresh credentials independently of web/native session issuance.
3. Records the user on the attempt and marks it `identity_ready`.
4. Checks whether GitHub reports at least one installation.
5. Creates GitHub installation navigation when none exists.
6. Redirects according to the attempt's bound client type.

The callback never forwards the GitHub authorization code to either client. Both web and native clients only complete a server-owned attempt.

If GitHub returns an OAuth denial, the callback consumes the OAuth state, marks the attempt `failed`, and redirects with the non-secret stable code `OAUTH_DENIED`. A web attempt returns to `<bound-origin>/api/auth/github/complete?attemptId=<id>&error=OAUTH_DENIED`; a native attempt returns to `<bound-custom-scheme>?attemptId=<id>&error=OAUTH_DENIED`. No client completion route can issue a session for a failed attempt.

### D4. Installation callbacks reuse the existing temporary state store

Do not add a `github_installation_flows` table. The existing `oauth_states` store already supports one-time state, user association, validated redirect targets, purpose, and expiration, and the existing installation path already distinguishes rows with `GITHUB_INSTALL_PURPOSE`. Add a nullable sign-in-attempt reference and generalize the repository/service terminology to temporary external-auth callback state; the physical table name may remain unchanged.

OAuth callback state and installation callback state remain distinct rows with distinct purposes and lifetimes. Installation callback state correlates an externally reachable GitHub setup callback with a server-initiated installation navigation and binds the callback to its user and return target. The callback consumes the row and redirects; it does not trust `installation_id`, `setup_action`, or other browser query parameters as authorization evidence.

Installation callback state expires after 30 minutes. This covers the GitHub App repository-selection and organization-approval-request journey for both chained sign-in and authenticated repository management without making the sign-in attempt itself authoritative for installation access.

Webhook processing and a fresh repository listing remain authoritative for actual installation/repository availability. The callback may clear listing synchronization metadata so the next repository request refreshes promptly, but it does not mark an installation or repository allowed.

`NativeGitHubInstallationService` becomes a platform-neutral `GitHubInstallationService` backed by the existing purpose-aware temporary state store. Standalone repository management remains authenticated and separate from sign-in, while reusing the same installation URL and callback validation mechanics.

### D5. Missing installation is fixed GitHub sign-in behavior

There is no `repositorySetup` or `continueToInstallation` option. After OAuth:

- If GitHub reports an installation, the browser proceeds to client completion/return.
- If GitHub reports no installation, the server creates an installation flow and continues the same browser journey to GitHub App setup.

The user can cancel setup, select no repositories, or leave an organization request pending without invalidating `identity_ready`. Repository UI later renders the actual `/repos` result and offers the separate **Manage repositories on GitHub** action.

Alternative considered: keep an `ifNeeded`/`skip` policy for possible future callers. Rejected because no current GitHub sign-in caller needs `skip`, and speculative policy makes the contract less clear.

### D6. Web uses same-tab navigation and claims before installation

The browser navigates to a same-origin BFF start route rather than calling `window.open`:

```text
GET /api/auth/github/start?returnTo=/requested/path
```

The BFF validates `returnTo` as a relative same-origin path, calls `/auth/github/web/start`, stores `{attemptId, claimToken}` in an `HttpOnly`, `Secure`, `SameSite=Lax` cookie with `Max-Age=600` seconds, and returns a redirect to `authorizeUrl`. The cookie lifetime exactly matches the 10-minute web attempt lifetime. The API continues using its existing production, local-development, and preview-origin allowlist; only the stored `returnTo` behavior is new. It is required because same-tab sign-in must restore callers such as `/discord/link` and `/integrations/link`, whereas the current popup implicitly leaves the calling page in place.

After OAuth, the API redirects web attempts to the attempt's allowlisted origin at:

```text
/api/auth/github/complete?attemptId=<id>
```

The BFF first checks whether the query attempt ID matches the claim cookie. A matching attempt is processed even when a valid web session already exists: denial is handled for that attempt, or `/auth/github/web/complete` claims it and replaces the normal web session cookie. If no matching claim cookie exists but the normal web session cookie is valid—for example, because the user navigated back to a consumed completion URL—the route redirects to the default signed-in app route. If neither condition holds, it returns the retryable signed-out error surface.

For a missing installation, `redirectUrl` is the GitHub App installation URL. Otherwise it is the validated final app route. Because the web session cookie is set before installation navigation, abandoning or delaying installation does not lose the authenticated session. A completed installation callback returns to the same final app route.

The BFF keeps one active web claim cookie per browser origin. Starting sign-in in a second tab overwrites the first attempt's cookie. If the older tab returns first, its attempt-ID mismatch sends that tab to the retry surface without clearing the newer attempt cookie; the newer tab can still complete normally. This last-start-wins behavior is intentional.

The web client removes popup names, popup polling, `postMessage` auth messages, second-popup behavior, and popup-blocker errors. A normal top-level navigation is more reliable and lets the browser preserve its normal tab behavior. Unsaved anonymous-page state is not preserved; only a validated return path is restored.

### D7. iOS claims after the custom-scheme callback or cancellation

`UnauthenticatedAuthAPI` starts only `/auth/github/native/start` and completes only `/auth/github/native/complete`. Its app-facing start value contains `authorizeUrl`, `attemptId`, and `claimToken`; it no longer exposes OAuth state or a continuation token. Direct native OAuth code exchange is removed.

`SessionStore` opens `authorizeUrl` in one `ASWebAuthenticationSession`. The API callback redirects directly to the configured custom scheme when installation already exists, or redirects through GitHub App setup and its setup callback before returning to that scheme. The final callback contains the attempt ID, which iOS verifies against the started attempt before completion.

`SessionStore` holds the attempt ID and raw claim token only in memory for the active sign-in call. It never writes them to Keychain, `UserDefaults`, other persistence, analytics, or logs. If the app is terminated mid-flow, the client abandons the attempt and the server deletes it after its fixed expiration; relaunch starts a new attempt.

If the web-auth session reports `.canceledLogin`, `SessionStore` calls native completion with the same attempt credentials:

- If the attempt has `status == "identity_ready"`, native completion returns the token pair, covering cancellation or pending approval after OAuth.
- If the attempt has `status == "awaiting_oauth"`, native completion returns `error.code == "SIGN_IN_NOT_READY"`; iOS remains signed out without presenting a sign-in failure.
- Invalid or expired attempts surface the normal sign-in failure.

The returned token pair is mapped to `Domain.Session` inside `Modules/API` and adopted through `TokenCoordinator`, preserving existing Keychain and refresh behavior.

### D8. Session issuance remains client-specific behind one flow service

Introduce `GitHubSignInFlowService` for attempt creation, OAuth completion, installation decision, and attempt validation. It delegates the final credential creation to existing session primitives:

- Web completion creates the existing opaque long-lived auth session and returns its token to the BFF.
- Native completion creates the existing refresh-session family and signed access token.

The service has client-specific completion methods rather than returning an internal credential union to routes. Shared identity exchange and credential persistence occur before either method. Route handlers parse external inputs and map typed `Result` errors to HTTP status codes.

### D9. Hard cutover removes the superseded surface

Remove the sign-in uses of:

- `GET /auth/github`.
- `POST /auth/token`.
- `POST /auth/native/token`.
- The current continuation semantics of `POST /auth/native/complete`.
- `continueToInstallation`, `continuationToken`, `NativeLoginContinuationRequest`, and native-login OAuth/continuation purposes.

The new native complete route is `/auth/github/native/complete`; it accepts attempt credentials and the new concrete response contract. Native refresh/logout, authenticated GitHub reauthorization, and authenticated repository-management routes remain.

No compatibility wrappers or dual client behavior are retained. The native continuation flow has not shipped, while the current web popup flow has; a web sign-in already in flight during deployment may fail and ask the user to retry, but it holds no durable operation that requires migration. That negligible one-time retry window does not justify retaining the old routes. The migration schema is additive so a code rollback can ignore the new table and nullable column.

### D10. Security and observability

- Redirect targets are normalized and allowlisted at start, stored server-side, and never replaced by callback query parameters.
- OAuth state, installation state, attempt IDs, and claim tokens are independently generated.
- Claim tokens and session credentials are never placed in redirect URLs or logs.
- The web BFF start endpoint intentionally remains a state-changing `GET` so sign-in can begin with top-level navigation. A cross-site page can initiate that navigation, but it cannot set or read the same-origin `HttpOnly` claim cookie, cannot supply a cross-origin `returnTo`, and therefore cannot fix the resulting session to an attacker-controlled attempt or account. The accepted worst case is initiating sign-in for the victim's own GitHub account and a validated same-origin return path, matching the standard OAuth-start posture.
- Unauthenticated attempt creation can create temporary rows in bursts; fixed expirations and prune-on-create bound persistence duration but not burst volume. This is parity with the existing unauthenticated `GET /auth/github`, so a new route-specific rate limiter is deliberately out of scope for this change.
- Logs use structured attempt ID prefixes, client type, transition, duration, and outcome; no token or authorization code values are logged.
- Expiration is checked on every state/attempt read. Creation paths opportunistically delete expired temporary rows to bound storage.
- Tests exercise cross-client completion, token mismatch, expiry, duplicate claim, OAuth-state replay, installation-state replay, and untrusted GitHub setup parameters.

## Risks / Trade-offs

- **[Same-tab sign-in replaces the current in-place web experience]** → Preserve a validated `returnTo` route and keep the sign-in journey linear. Do not retain popup code as a second path.
- **[The web session is established before installation finishes]** → This is intentional: authentication and repository access are separate. Repository selection and session creation still depend on actual `/repos` results.
- **[A native browser dismissal races the OAuth callback]** → Return `SIGN_IN_NOT_READY` while OAuth is pending and let `SessionStore` make a short bounded retry only for that code.
- **[A completion response can be lost after an at-most-once claim]** → Report a sign-in failure and restart the short sign-in flow; do not make claim tokens reusable or issue duplicate sessions to mask the ambiguity.
- **[API and web route changes are breaking]** → Land API, web, iOS, generated contracts, and tests in one coordinated release. Native continuation has not shipped; the shipped web popup path has only short-lived in-flight sign-ins, which may fail once across deployment and recover through an ordinary retry, so no legacy runtime path is retained.
- **[Temporary rows can outlive their useful browser session]** → Enforce the fixed 10-minute OAuth/web-attempt and 30-minute native-attempt/installation-state TTLs, reject expired rows, and prune expired attempts and callback-state rows during creation.

## Migration Plan

1. Add the D1 migration for `sign_in_attempts` and the nullable sign-in-attempt reference on the existing `oauth_states` table.
2. Add explicit contract schemas, regenerate Swift CoreAPI types, and implement repositories plus `GitHubSignInFlowService`/`GitHubInstallationService` using the generalized purpose-aware temporary state store.
3. Replace API routes and callback dispatch with route-bound web/native attempts; add state-transition and security tests.
4. Replace web popup orchestration with BFF start/completion redirects and web integration tests.
5. Replace iOS authorize/code-exchange/continuation APIs with native start/complete, update `SessionStore`, and add callback/cancellation tests.
6. Remove superseded types, routes, services, popup messages, and native continuation code.
7. Update auth documentation and run contract codegen, build, lint, typecheck, server/web tests, SwiftLint, and the iOS simulator build/tests.

Rollback reverts the application/API code together. The additive migration may remain because no existing path depends on or writes the new tables after rollback.

## Open Questions

None. Route-selected client type, concrete completion contracts, automatic installation when missing, same-tab web navigation, and hard cutover are agreed decisions.
