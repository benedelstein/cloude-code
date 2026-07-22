## Why

The current sign-in claim token is sufficient after any browser completes GitHub OAuth for the attempt, so transferring an authorization URL can bind the starter's session to another person's GitHub account. Session issuance must require proof held by both the initiating client and the browser that reached the server-controlled final callback.

## What Changes

- **BREAKING** Require `attemptId`, initiator-held `claimToken`, and callback-delivered one-time `completionCode` for web and native sign-in completion.
- Add `completion_ready` between identity establishment and at-most-once claim, storing only the completion-code hash under the attempt's original fixed expiry.
- Issue the raw completion code only at the final handoff: the web BFF callback, the native custom-scheme callback, or the native GitHub App setup callback.
- Preserve one `ASWebAuthenticationSession` across native OAuth and optional GitHub App installation; cancellation always remains silently signed out and never polls completion.
- Keep web session creation before optional installation navigation and keep authenticated repository-management installation behavior separate.
- Remove `SIGN_IN_NOT_READY` and callback-free completion recovery with no compatibility shim.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `github-sign-in-flow`: Bind session issuance to both the initiating client secret and a one-time final-callback secret.
- `web-auth-session`: Require a matching encrypted attempt cookie and callback-delivered completion code before BFF completion.
- `ios-auth-session`: Complete only after a matching custom-scheme callback carrying the completion code, with silent cancellation and one browser session.

## Impact

This changes the client contract, D1 sign-in-attempt schema/state machine, API auth services/routes, web BFF callback, generated Swift CoreAPI, iOS auth API/session store, and their regression tests and documentation. Existing in-flight attempts stop completing at deployment; App Attest and unofficial-client impersonation remain out of scope.
