## Context

A sign-in attempt currently has one secret, `claimToken`, retained by its initiator. OAuth marks the attempt identity-ready, while the final browser callback contains only a public attempt ID. If the authorization URL is transferred, the starter can poll completion after another browser authorizes and receive that browser user's My Machines session. Native cancellation recovery makes the missing callback especially explicit, but web is vulnerable to the same cross-browser split.

The flow must retain the existing fixed 10-minute web and 30-minute native attempt deadlines, one native `ASWebAuthenticationSession`, optional GitHub App setup, web cookie-before-install behavior, and repository access as separate from authentication.

## Goals / Non-Goals

**Goals:**

- Require independent proof from the initiating client and the browser that receives the final callback.
- Preserve at-most-once session issuance and uniform invalid-attempt errors.
- Mint completion proof only at the actual final handoff and keep raw secrets memory-only outside the necessary callback URL.
- Preserve a single native browser presentation across OAuth and optional installation.

**Non-Goals:**

- App Attest, device attestation, or preventing an unofficial client from impersonating the official app.
- Treating GitHub setup query parameters as installation or repository-access evidence.
- Enabling GitHub's `request_oauth_on_install` behavior or merging OAuth and installation conceptually.
- Supporting old clients or in-flight attempts across deployment.

## Decisions

### D1. Completion uses two independent one-time secrets

The start response continues to return a random `claimToken` only to the initiator. The final callback carries a separately generated 32-byte `completionCode`. Completion requires the exact attempt ID, claim-token hash, completion-code hash, route-bound client type, unexpired deadline, and `completion_ready` status. D1 stores only SHA-256 hashes. A single secret, mixed secrets from different attempts, wrong client, wrong state, expiry, failure, or replay all return `INVALID_SIGN_IN_ATTEMPT`.

Using callback state or attempt ID as the second factor was rejected because both already travel in transferable URLs and are not secret at final claim time.

### D2. The state machine separates identity from final handoff

Attempts transition `awaiting_oauth -> identity_ready -> completion_ready -> claimed`, with `failed` terminal for OAuth denial/failure. `markIdentityReady` attaches the user. `issueCompletionCode` atomically changes only an unexpired `identity_ready` attempt to `completion_ready`, stores the generated code hash, and returns the raw code once. Claim atomically consumes only `completion_ready`. No transition extends the original attempt expiry.

`SIGN_IN_NOT_READY` is removed because a client without a final callback never possesses a completion code and therefore never has a legitimate polling path.

### D3. Completion proof is minted at the final handoff

- Web issues the code after OAuth and optional installation URL preparation, then redirects to the BFF completion route with `attemptId` and `completionCode`. The BFF combines that code with the encrypted HttpOnly cookie claim, completes the API attempt, sets the web session cookie, clears the attempt cookie, and only then follows an optional installation URL.
- Native with an existing installation issues the code after OAuth and returns directly to the allowlisted custom scheme.
- Native without an installation stores a dedicated native-sign-in installation state and continues to GitHub in the same browser presentation. Its validated one-time setup callback issues the code and returns to the attempt's allowlisted custom scheme.
- If installation preparation fails after identity establishment, the service issues the code and returns directly to the client.

The raw code is never stored in installation state or installation return targets. Web installation state stores a final application route that remains usable after the shorter web attempt is claimed or expires. Native installation state references the attempt and finalizes it only on consumption. Authenticated repository management retains its existing distinct purpose.

### D4. Native cancellation never completes

Any `ASWebAuthenticationSessionError.canceledLogin`, whether before or after OAuth, silently leaves iOS signed out. Retry creates a fresh attempt; GitHub commonly fast-paths the already granted OAuth authorization. This deliberately trades automatic post-OAuth recovery for the invariant that no callback means no session.

### D5. Validation ordering limits disclosure and secret lifetime

The completion endpoint hashes both presented secrets and verifies both before considering state, expiry, or client binding; every failed completion returns the same stable error. The web BFF requires a matching callback attempt, encrypted claim cookie, and nonempty completion code before calling the API, while preserving a newer mismatched cookie. iOS validates callback attempt ID, error absence, and completion-code presence before completion. Secrets are excluded from logs and analytics; only the completion code's necessary final callback URL contains it, and successful flows immediately redirect away from that URL.

## Risks / Trade-offs

- **[Native dismissal after OAuth loses the immediate login]** -> Stay silently signed out and start a fresh attempt on retry; do not weaken callback binding.
- **[A final callback or completion response is lost]** -> The one-time code/claim cannot be recovered or replayed; surface the normal retry action.
- **[Web callback URL briefly contains a secret]** -> Keep it only in the server-side BFF request, never cookie it, and immediately redirect to a clean application or installation URL.
- **[Installation callback consumes state before finalization fails]** -> Return an invalid/expired flow; no alternative path can mint another code, preserving at-most-once behavior.
- **[Hard cutover invalidates in-flight clients]** -> Deploy API, web, generated contract, and iOS together; attempts are short-lived and safe to abandon.

## Migration Plan

1. Add migration 0028 with nullable `completion_code_hash`; old rows remain unclaimable under the new state machine.
2. Update the shared contract, generated Swift, repository, services, callbacks, routes, and focused server tests.
3. Update the web BFF and iOS adapters/tests, then remove readiness polling and stale documentation.
4. Deploy as a coordinated breaking change. Rollback may leave the nullable column in place because older code ignores it.

## Open Questions

None.
