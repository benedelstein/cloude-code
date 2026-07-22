# Authentication

The iOS app uses a native session containing a short-lived access token and a
rotating refresh token. `TokenCoordinator` is the single owner of that session.
It serializes token rotation, persists each new token pair, and supplies access
tokens to authenticated API clients. `SessionStore` translates coordinator
results and events into the UI-facing authentication state.

## Credential model

`Domain.Session` stores one atomic credential pair:

- `accessToken`: a server-verified JWT attached to authenticated requests as
  `Authorization: Bearer <token>`.
- `accessTokenExpiresAt`: used locally to decide when the access token is stale.
- `refreshToken`: a rotating credential sent only in the body of the native
  refresh and logout requests.
- `refreshTokenExpiresAt`: the server-issued refresh-token expiry.
- `userId`: non-secret identity metadata used to restore the cached user before
  a network request completes.

The client does not treat the access and refresh tokens as independent values.
A successful refresh returns a new `Session`, and the old refresh token must not
be used again after the new pair is adopted.

`KeychainSessionPersistence` JSON-encodes the complete `Session` and stores it
under `auth.session` in a bundle-scoped Valet keychain with
`afterFirstUnlock` accessibility. It can migrate a session from the legacy app
group keychain, then removes the legacy value. Tokens must not be placed in
`UserDefaults`, SwiftData, logs, or analytics.

## Responsibilities

| Type | Responsibility |
| --- | --- |
| `SessionStore` | Owns the main-actor UI state, starts local restoration, observes auth events, loads the cached/current user, and runs the GitHub sign-in attempt. |
| `GitHubInstallationStore` | Opens authenticated GitHub App repository management from the repository picker and validates its native callback. |
| `TokenCoordinator` | Actor that owns the in-memory session, keychain writes, refresh scheduling and retry, single-flight rotation, logout, and auth events. |
| `KeychainSessionPersistence` | Loads, saves, migrates, and clears the complete session in Keychain. |
| `UnauthenticatedAuthAPI` | Calls sign-in start/complete, refresh, and logout endpoints without a Bearer header. The attempt claim token or refresh token in the request body is the credential. |
| `AuthTokenProviding` | Boundary used by authenticated API types to obtain Bearer headers. `TokenCoordinator` implements it. |
| `RootView` | Chooses the signed-out screen or Home from `SessionStore.State`. |
| `HomeViewModel` | Loads cached Home data, then starts fetch/socket work whose API authorization awaits `TokenCoordinator` when refresh is required. |

`ApplicationComponent` creates one shared coordinator and injects it into every
authenticated API surface. Features must not load, save, refresh, or attach
tokens directly.

## Startup and UI state

`AppDelegate` starts the SwiftData cache before calling `SessionStore.start()`.
Session restoration itself is local-only: `TokenCoordinator.restore()` reads
Keychain and returns one of three results without waiting for the network.

| Restore result | `SessionStore.State` | Root UI | Network behavior |
| --- | --- | --- | --- |
| No readable session | `signedOut` | Sign-in screen | No authenticated work. |
| Session with a usable access token | `signedIn(userId:)` | Home | Cached data loads, then authenticated refresh/socket work starts. |
| Session with a stale access token | `refreshing(userId:)` | Home | Cached data renders immediately; startup refresh runs in the background and authenticated requests await the coordinator's refresh task. |

The complete state machine is:

```text
loading
  ├─ no stored session ───────────────────────────────> signedOut
  ├─ stored session + usable access token ────────────> signedIn
  └─ stored session + stale access token ─> refreshing
                                                  ├─ refresh succeeds ─> signedIn
                                                  ├─ transient error ──> refreshing + retry
                                                  └─ refresh rejected ─> signedOut
```

During `refreshing`, the app has enough local identity to render cached Home
content, but it does not claim that authenticated network access is ready:

- `RootView` renders Home for both `refreshing` and `signedIn`.
- `HomeViewModel.start()` begins on appearance without inspecting the UI auth
  state. It loads the cache first, then its authenticated API calls obtain
  Bearer headers through the coordinator and await an in-flight refresh when
  necessary.
- `authUserPublisher` publishes `nil`, so work such as FCM token upload remains
  gated until `signedIn`.
- Every other authenticated request follows the same `AuthTokenProviding` path
  and awaits the same single-flight refresh.

`SessionStore` treats the coordinator's `AsyncStream<AuthEvent>` as the source
of truth after restoration. A `.refreshed` event promotes `refreshing` to
`signedIn`; `.signedIn` handles a newly adopted OAuth session; `.signedOut`
clears UI user state and publishes the sign-out event used by cache cleanup.

## Refresh lifecycle

All refresh paths converge on `TokenCoordinator.refresh()`:

1. **Startup:** a stored session whose access token is stale enters
   `refreshing` and starts a refresh.
2. **Eager timer:** after adopting a session, the coordinator schedules refresh
   for two minutes before access-token expiry using a `ContinuousClock`
   deadline.
3. **On demand:** `authToken()` refreshes when the access token is stale. A token
   is considered stale 60 seconds before its recorded expiry.
4. **Retry:** a transient refresh failure retries up to three total attempts
   with exponential backoff from one second, capped at 30 seconds. An
   unauthenticated response bypasses retry and follows the terminal path.

Only one refresh request may be in flight. Concurrent timer, startup, retry,
and API-request callers await the same task. Before adopting a response, the
coordinator verifies that the session still contains the refresh token used to
start that request. This prevents an older response from overwriting a newer
session.

On success, the coordinator adopts the returned token pair in memory, saves the
complete `Session` to Keychain, schedules the next eager refresh, and emits
`.refreshed`.

The refresh and logout routes deliberately use `UnauthenticatedAuthAPI`; they
must not call `authToken()` or attach an access-token header, because that would
make refresh re-enter itself.

## Failure and sign-out behavior

| Outcome | Behavior |
| --- | --- |
| Refresh returns `APIError.unauthenticated` | Treat as terminal: clear the in-memory and keychain session, cancel timers/retries, and emit `.signedOut`. |
| Refresh fails transiently | Keep the session and UI state, schedule a retry, and let callers receive the original error. |
| A refresh response is stale | Discard it rather than overwriting the newer session. |
| Explicit sign-out | Clear the local session and emit `.signedOut` first, then attempt server revocation as best effort. |
| Keychain load fails | Log only the error type/context and restore as signed out. |
| Keychain save fails after rotation | Keep using the new in-memory session and log the persistence failure. The durable copy may still contain the previous refresh token. |

The last case is important for rotating credentials. There is an unavoidable
ambiguity if the server rotates a refresh token but the app is suspended or
terminated before it receives and persists the response. A persistence failure
creates a similar stale-disk condition. On the next launch, retrying the older
token may be reported by the server as refresh-token reuse. The client reduces
ordinary reuse through single-flight refresh and atomic whole-session storage,
but recovery from a lost rotation response also depends on the server's token
family/grace policy.

Do not log token values. `TokenCoordinator` logs only user id, expiry dates,
lifecycle events, and errors.

## Sign-in flow

Sign-in is a server-owned attempt. The app never sees or exchanges a GitHub
authorization code; it starts an attempt and later claims the completed
identity.

`SessionStore.signIn(using:)`:

1. `POST /auth/github/native/start { redirectUri }` returns
   `{ authorizeUrl, attemptId, claimToken }`.
2. Open `authorizeUrl` in one `ASWebAuthenticationSession` using the configured
   callback scheme.
3. The API exchanges the OAuth code, persists the GitHub identity and
   credentials, marks the attempt `identity_ready`, and — only when the GitHub
   user has no App installation — navigates the same browser session to GitHub
   App setup before returning to the custom scheme.
4. At the actual final handoff, the API issues a one-time `completionCode` and
   returns it with the `attemptId` on the custom-scheme callback. Verify the
   attempt matches, the code is nonempty, and the callback carries no `error`.
5. `POST /auth/github/native/complete { attemptId, claimToken,
   completionCode }` returns the access/refresh pair and user.
6. Seed `UserStore` with the returned user, then ask `TokenCoordinator` to
   adopt and persist the `Session`.
7. Handle the emitted `.signedIn` event using that canonical cached user.

### Attempt credentials

`attemptId` is non-secret and travels on the custom-scheme callback.
`claimToken` is held by the initiating app call; `completionCode` is delivered
only to the browser that reaches the final callback. The server requires both,
so a transferred authorization URL cannot be claimed by either party alone.
Both secrets stay in local function memory only — never Keychain,
`UserDefaults`, other persistence, analytics, or logs. D1 stores only SHA-256
hashes under the attempt's original fixed expiry. If the app is terminated
mid-flow the attempt is abandoned and the next sign-in starts a new attempt.

Completion is at-most-once on the server, so a lost completion response cannot
be retried into a second session. That case surfaces as an ordinary sign-in
failure and the (short) flow is restarted.

### Cancellation

One system presentation covers OAuth and repository setup, so a dismissal can
happen on either side of OAuth. Any `.canceledLogin` is a silent signed-out
outcome and makes no completion request. Even when OAuth already established
the identity, no final callback means no `completionCode` and therefore no
session. A retry starts a fresh attempt; GitHub will usually fast-path the
authorization already granted. This tradeoff preserves callback binding rather
than letting the initiator poll for another browser's identity.

The sign-in start, sign-in completion, refresh, and logout endpoints bypass
`AuthTokenProviding`.

## GitHub App installation

Authentication creates the Cloude Code account and stores the GitHub user
credential. Repository-backed work separately requires a repository available
through a GitHub App installation.

Repository access is not an authentication gate. A claimed attempt always enters
the normal signed-in UI, including when the user has zero repositories or an
organization installation is pending approval. Session creation remains
disabled until a repository is selected.

The repository picker's **Manage repositories on GitHub** action starts a
separate authenticated installation flow through
`POST /auth/github/install/start`. The API returns a GitHub installation URL
with a one-time state nonce whose stored redirect is paired with the app's
allowlisted OAuth callback. GitHub forwards that state to the configured web
setup page at `/github/install/complete`; the page sends states through
`/api/auth/github/install/callback`, and the API consumes the state before
redirecting to `cloudecode://github/install/complete` (or the development
scheme).

The callback only closes `ASWebAuthenticationSession`. It is not proof of an
installation: GitHub's setup query parameters are untrusted. The draft refreshes
`/repos` and its active search after returning and renders whatever access is
actually available. Cancelling, selecting no repositories, or awaiting approval
leaves the user in the normal signed-in UI with the same management action
available.

## Tests

Auth lifecycle coverage lives in:

- `CloudeCodeTests/SessionStoreTests.swift`: signed-out launch, explicit and
  terminal sign-out, stale-session startup, cached `refreshing` state, and
  transient startup retry.
- `CloudeCodeTests/SessionStoreSignInTests.swift`: callback attempt/code
  matching, missing or error callbacks, and silent dismissal before and after
  OAuth with zero completion calls. It drives sign-in
  through the `WebAuthenticating` seam instead of a real browser.
- `CloudeCodeTests/TokenCoordinatorTests.swift`: concurrent refresh callers
  sharing one token rotation.

When changing auth behavior, test the state transition separately from token
rotation. A UI state test should control when refresh completes; a coordinator
test should assert that repeated scheduling does not create overlapping token
uses.
