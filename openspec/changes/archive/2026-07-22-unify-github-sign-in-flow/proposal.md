## Why

GitHub sign-in is currently orchestrated differently by each client: web finishes OAuth and then opens a second popup for GitHub App installation, while iOS reuses OAuth state as a native-only continuation so both steps fit in one system browser session. This duplicates the same product flow, makes repository setup look like an authentication requirement, and exposes client-specific continuation behavior in the shared contract.

## What Changes

- Add one server-owned GitHub sign-in attempt that exchanges the OAuth code, persists the GitHub identity and credentials, and decides whether to continue the same browser journey to GitHub App installation.
- Always continue to GitHub App installation when the authenticated GitHub user has no installation; remove the unused option to skip repository setup during GitHub sign-in.
- Add explicit web and native start/complete API paths. The route binds the attempt's client type, and each completion path returns one concrete response shape: an opaque web session token or a native access/refresh token pair.
- Replace web popup orchestration with a same-tab redirect through a web BFF start route. The BFF claims and stores the web session cookie after OAuth and before redirecting to optional installation, so abandoning installation does not discard the completed login.
- Keep iOS in one `ASWebAuthenticationSession`; complete the native attempt after the custom-scheme callback, or recover the already-completed OAuth login when installation is dismissed.
- Keep authenticated repository-management navigation separate from sign-in and treat webhooks plus repository listing as the authority for actual GitHub App access.
- **BREAKING**: remove the generic sign-in start and direct code-exchange routes used by the current web/native implementations, along with `continueToInstallation`, `continuationToken`, `NativeLoginContinuationRequest`, and native-continuation OAuth purposes. This change uses a coordinated hard cutover rather than compatibility wrappers.

## Capabilities

### New Capabilities

- `github-sign-in-flow`: Server-owned GitHub OAuth attempts, explicit web/native route contracts, installation chaining, claim security, and callback behavior.
- `web-auth-session`: Same-tab web sign-in navigation, BFF session claiming, cookie establishment, and return-to-app behavior.

### Modified Capabilities

- `ios-auth-session`: Replace native code exchange and continuation semantics with explicit native sign-in attempts while preserving one web-auth presentation, token-pair adoption, and cancellation recovery.

## Impact

- `services/api-server`: auth routes, schemas, services, repositories, OAuth-state handling, GitHub installation navigation, tests, and a D1 migration for sign-in attempts.
- `packages/api-contract`: explicit GitHub web/native start and completion schemas; regenerated Swift wire types.
- `apps/web`: BFF start/completion routes, session-cookie handling, sign-in navigation, auth hooks, and tests; popup messaging and polling are removed.
- `apps/ios`: unauthenticated auth API, `SessionStore`, generated CoreAPI types, auth tests, and auth documentation.
- `docs/auth.md` and `apps/ios/docs/auth.md`: shared attempt lifecycle, distinct OAuth and installation callback state, and repository setup semantics.
- No new runtime dependencies.
