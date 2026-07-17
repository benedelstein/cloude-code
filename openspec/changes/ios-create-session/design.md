# Design: iOS Create New Session

## Context

The iOS session screen (`AgentSessionView` + `AgentSessionViewModel`) assumes an existing session: the VM is constructed with a `SessionSummaryModel` and a `SessionSocket` bound to that id, `bind()` loads the disk cache and connects the socket, and `submitDraft()` sends over the socket with optimistic-message reconciliation. Session creation exists server-side (`POST /sessions` with required `repoId` + `initialMessage`) and in the iOS API layer (`SessionsAPI.createSession`), but no UI, no repos/models API clients, and no model picker exist on iOS.

Verified foundations this design relies on:

- `AgentSessionView` holds its VM in `@State` (`AgentSessionView.swift`) — survives `navigationDestination` re-evaluation, so a stateful draft VM needs no extra caching.
- The optimistic first message reconciles through the existing sync path: `applySyncResponse` → `messagesIncludingOptimisticUserMessages` keeps unconfirmed optimistic messages, and `upsertConfirmedUserMessage`/`isServerConfirmation` (role + text + image URLs) swap in the server echo. No `chatAccepted` accept-swap exists for an HTTP-created initial message, and none is needed.
- `ImageAttachmentStore.init(sessionId: String?)` and `AttachmentsAPI.uploadImages(_, sessionId: String?)` already accept nil — attachments upload pre-creation; ids ride in `initialMessage.attachmentIds`.
- Swift types are already generated in `Modules/CoreAPI`: `ModelsResponse`/`ProviderCatalogEntry` (Models.generated.swift), `Repo`/`ListReposResponse`/`Branch`/`SearchReposResponse` (Repos.generated.swift), `CreateSessionRequest`/`CreateSessionResponse` (SessionsAPI.generated.swift).
- Server routes: `GET /models`; `GET /repos` (`limit`,`cursor`), `GET /repos/search` (`q`,`limit`), `GET /repos/{repoId}/branches` (`limit`,`cursor`).
- Xcode 16 synced folders — new files need no pbxproj edits. The Needle DI graph (`CloudeCode/Generated/NeedleGenerated.swift`) is checked in and regenerated manually (`needle generate CloudeCode/Generated/NeedleGenerated.swift CloudeCode/` from `apps/ios`).
- `vm.errorMessage` is surfaced nowhere in the session screen today — the failure path needs a toast (mirror `HomeView`'s pattern).

## Goals / Non-Goals

**Goals:**
- Start a session from iOS with the same request semantics as web (one `POST /sessions` carrying the first message).
- One session screen that operates with or without a session id — a single transcript scrollview throughout; no parallel "empty screen" view tree.
- Instant-feeling send: optimistic user message + working indicator before the create round-trip; clean retraction on failure.
- Draft-mode composer pickers: repo/branch (searchable half sheet, medium+large detents) and model/provider (half sheet, connection-gated), with last-selection persistence.

**Non-Goals:**
- Effort-level picker, edit/plan mode toggle, `/models` caching, provider connect/reauth flows, repo install flow (`installUrl`), environment selection — all deferred with TODOs.
- Server or contract changes of any kind.

## Decisions

### 1. Explicit context enum on the existing VM

`AgentSessionViewModel` gains a `Context` enum with exactly two cases: `.session(SessionSummaryModel)` and `.draft(NewSessionDraft)`. `session`, `draft`, and `isDraftMode` are derived from that context. An injected `makeSocket: (String) -> SessionSocket` factory creates the socket immediately for `.session` and after successful creation for `.draft`.

- *Why an enum context?* Separate optional `session` and `draft` inputs allow invalid combinations where both are nil or both are set. The enum makes those states unrepresentable while preserving convenient computed optional accessors at guarded call sites.
- *Why not a separate draft VM/screen?* The requirement is the same scaffold with the same transcript machinery (optimistic rows, working indicator, streaming) live the moment the id binds — duplicating it would fork ~800 lines of transcript state handling.
- All `session.id`/`socket` uses (`applySyncResponse`, `applyAgentFinish`, `applyUserMessage`, `acceptOptimisticUserMessage`, `loadCachedMessages`, `markReadIfNeeded`) guard on nil — nothing persists to disk before an id exists.
- `bind()` body extracts into `startSocketPipeline(socket:loadCache:)`. Existing sessions: unchanged. Draft: `await draft?.load()` (concurrent `/models` + `/repos`, resolve persisted defaults) and set `hasLoadedMessages = true` so the view shows the empty state, not a spinner.
- `canSubmitDraft` in draft mode requires `draft?.selectedRepo != nil` instead of `connectionState == .connected` (no socket exists yet).

### 2. Keep the optimistic message; let the normal sync path reconcile

`submitDraft()` runs the shared optimistic steps first (clear composer, `appendPendingOptimisticUserMessage`, `isSending`/`isWaitingForResponse = true` — the working indicator appears immediately), then branches. Draft branch: `draft.createSession(content:attachmentIds:)` → on success `adoptCreatedSession(response)`:

1. Build a `SessionSummary` (id/title from the response, repo fields from `draft.selectedRepo`, `workingState: "responding"`) and transition `context` to `.session(sessionSummaryStore.putSnapshotsToDisk([summary])[0])` — the canonical model dedups with the `summaryCreated` user-sessions socket event Home already handles.
2. `attachmentStore.adoptSessionId(response.sessionId)` (new setter on `ImageAttachmentStore`).
3. `socket = makeSocket(response.sessionId)`; `startSocketPipeline(socket:loadCache: false)`. While setup is still
   running, the initial message lives in `ClientState.pendingUserMessage` and may not appear in the durable
   `syncResponse` history yet. Live-state hydration reconciles that server-authored pending message with the local
   optimistic row, and snapshot rebuilding includes the pending message without persisting it as durable history.
   The later `user.message` event confirms and caches the same server message id without duplicating the row.

- *Why not accept-swap like `chatAccepted`?* There is no `chatAccepted` for an HTTP-created initial message; the sync-response confirmation path already handles exactly this shape.
- *Why ignore `CreateSessionResponse.websocketToken`?* `SessionSocket` mints its own token via the existing `sessionWebSocketToken` path; reusing the response token adds a second token flow for one saved round-trip.

Failure path reuses `recordSendError` verbatim (removes the optimistic message, restores draft text + attachments, `resetPendingResponse()`); nothing was persisted. An `.onChange(of: store.errorMessage)` toast is added to `AgentSessionView` — which also fixes existing-session send errors being silent.

### 3. `NewSessionDraft` coordinator owns creation-time state

A `@MainActor @Observable` object (`Features/AgentSession/Draft/NewSessionDraft.swift`) holds `catalog: ModelsResponse?`, `repos: [Repo]`, selected provider/model/repo/branch, loading/error flags; `load()` fetches concurrently; `createSession(content:attachmentIds:)` builds the `CreateSessionRequest` (omit `branch` when equal to the repo default; omit `settings` when no model selected — server applies defaults). Keeps the transcript VM lean and gives the picker views one observable to bind to.

### 4. Navigation: `HomeDestination` enum, FAB overlay

`HomeRouter.path` becomes `[HomeDestination]` with `case session(SessionSummaryModel)` and `case newSession(id: UUID)` (UUID keeps repeated pushes distinct). `presentationOptionsFor`/`handleNotificationTap` resolve the active session id from either a session destination or a created-session association on a draft UUID. The FAB is a `.overlay(alignment: .bottomTrailing)` on Home content — `plus.bubble.fill` in a 56pt circle using the existing `glassBackground(in:tint:)`.

- *Why change the path element type instead of a second `navigationDestination`?* One path array keeps router logic (notification replace-path routing) in one place; a marker type alongside `SessionSummaryModel` would split `path.last` semantics. When a draft becomes a session, the router records the created session id against that draft UUID instead of replacing the navigation destination: replacing it would recreate the active transcript, while the association lets foreground notification suppression and tap routing recognize the visible live session.

### 5. Composer extension via a generic send-accessory slot

`PromptComposerView` gains a defaulted `@ViewBuilder trailingAccessory` generic parameter rendered immediately before `SendButton` — the component stays VM-free and reusable. The repo/branch control lives *outside* `PromptComposerView`, in the `ComposerView` adapter: `VStack { if isDraftMode { RepoBranchPickerBar } ; PromptComposerView(...) }`. It is an intrinsic-width glass capsule: the repository segment opens the searchable repository sheet, and the base-branch segment appears only after repository selection and opens its own branch sheet. The control disappears automatically when `session != nil` (existing `readSize`/`composerHeight` animates the shrink).

### 6. Model list from `GET /models`; persistence in the app target

New networking-only clients in `Modules/API` mirroring `SessionsAPI`'s request-struct pattern: `ReposAPI` (list/search/branches) and `ModelsAPI` (`models()`). `/models` returns display names, defaults, `connected`/`requiresReauth`, and per-model `selectable` — no hand-maintained registry.

Last selections persist in `CloudeCode/Core/Preferences/NewSessionPreferences.swift` (UserDefaults, Codable `LastSelectedModel{providerId, modelId, displayName}` + `LastSelectedRepo{id, fullName, defaultBranch}`) — app target, per the layering rule that `Modules/API` is networking-only. Validation on `load()`: a persisted model is valid iff its provider is in the catalog with `connected && !requiresReauth` and the model is `selectable`; else fall back to the first connected provider's default; else nil ("Select model" — send still allowed with nil settings). Persisted `displayName` renders immediately before `/models` returns, so returning users never see a "Select model" flash.

Provider icons: template assets in the asset catalog (`ProviderAnthropic`/`ProviderOpenai`) with SF Symbol placeholders + TODO if brand assets are unavailable.

## Risks / Trade-offs

- [`HomeRouter` path type change touches notification routing] → covered by an explicit regression pass on notification-tap navigation; the change is mechanical (`.session` pattern matches).
- [Needle regeneration is manual and easy to forget] → regenerate immediately after dependency-protocol changes; the build fails loudly if stale.
- [Draft `canSubmitDraft` gating on socket connection state by mistake] → called out in tasks; draft mode has no socket until after create.
- [Local `SessionSummary` mint could drift from the server's `summaryCreated` payload] → `putDisk` canonicalizes by id; the socket event overwrites local fields when it arrives.
- [Repo search is server-backed and unpaginated in v1 (single page + search)] → acceptable for typical repo counts; cursor pagination fields already exist for a follow-up.

## Open Questions

_None — deferred items (effort picker, edit/plan toggle, `/models` caching, provider connect flow) are explicitly out of scope with TODOs in code._
