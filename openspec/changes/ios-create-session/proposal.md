# iOS: Create New Session

## Why

The iOS app can only view sessions created on the web — there is no way to start one. The backend already supports everything needed (`POST /sessions` with an initial message, `GET /models`, `GET /repos`), and the iOS API layer already ships `SessionsAPI.createSession`; only the client UI and wiring are missing.

## What Changes

- Glass FAB (bottom-right) on the Home sessions list that pushes a **draft session screen** — the existing `AgentSessionView` scaffold operating without a session id (one transcript scrollview the whole time; zero rows in draft).
- `AgentSessionViewModel` becomes id-optional: optional `session`, socket created lazily via an injected factory, a `NewSessionDraft` coordinator owning catalog/repo state.
- Composer gains, in draft mode only:
  - a **repo/branch picker bar** above the main composer rect in its own glass rect (half sheet, medium + large detents, with search; branch list per repo). Disappears once the session is created.
  - a **model/provider picker button** to the right of the send button showing `<provider icon> <model name>` or "Select model" (half sheet, no search; disconnected providers rendered disabled; no connect flow).
- On send: the user message is inserted optimistically with the working indicator shown immediately, then `POST /sessions` fires with the message as `initialMessage` (same as web). On success, the VM adopts the session id and starts the normal socket pipeline; on failure, the optimistic message is retracted and draft text/attachments restored, with an error toast.
- Last selected model and repo persist in UserDefaults, validated against `/models` connection state on load.
- New networking clients in `Modules/API`: `ReposAPI` (`GET /repos`, `/repos/search`, `/repos/{id}/branches`) and `ModelsAPI` (`GET /models`).
- `HomeRouter.path` element type changes from `SessionSummaryModel` to a `HomeDestination` enum (session / newSession) — internal refactor, notification-tap routing preserved.
- Deferred with TODOs: effort-level picker, edit/plan mode toggle, `/models` response caching.

## Capabilities

### New Capabilities
- `ios-session-creation`: creating a session from the iOS app — draft session screen lifecycle, optimistic first message, create-request semantics, failure/reset behavior, post-create adoption (socket connect, Home list consistency).
- `ios-session-composer-pickers`: draft-mode composer pickers — repo/branch picker (search, branch default), model/provider picker (connection gating, disabled states), last-selection persistence and validation.

### Modified Capabilities

_None — existing specs (auth, transcript rendering, sessions stream, notifications) keep their requirements; the `HomeRouter` path change is implementation-internal._

## Impact

- **iOS app target** (`apps/ios/CloudeCode`): `Features/AgentSession/*` (view model, view, composer adapter, component/DI, new `Draft/` views), `Features/Home/*` (router, view, component), `Core/Styling/Components/PromptComposer/PromptComposerView.swift` (trailing accessory slot), `Core/Attachments/ImageAttachmentStore.swift` (session-id adoption), new `Core/Preferences/NewSessionPreferences.swift`, asset catalog (provider icons), regenerated Needle DI graph.
- **iOS packages** (`apps/ios/Modules/API`): new `ReposAPI`, `ModelsAPI` clients (networking-only, per layering rule). Generated `CoreAPI` types already exist — no codegen changes.
- **Server / contracts**: none — all endpoints and schemas already exist.
