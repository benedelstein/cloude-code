# Tasks: iOS Create New Session

## 1. API clients + plumbing

- [x] 1.1 Create `apps/ios/Modules/API/Sources/API/Repos/ReposAPI.swift` — `ReposAPIProviding` with `listRepos(limit:cursor:)`, `searchRepos(query:limit:)`, `branches(repoId:limit:cursor:)`, mirroring `SessionsAPI`'s request-struct pattern (generated types in `Repos.generated.swift`)
- [x] 1.2 Create `apps/ios/Modules/API/Sources/API/Models/ModelsAPI.swift` — `ModelsAPIProviding.models() -> ModelsResponse` for `GET /models`; `// TODO: caching`
- [x] 1.3 Expose `reposAPI` and `modelsAPI` as shared instances on `ApplicationComponent`
- [x] 1.4 Add UserDefaults keys to `CloudeCode/Core/Constants.swift` and create `CloudeCode/Core/Preferences/NewSessionPreferences.swift` (Codable `LastSelectedModel{providerId, modelId, displayName}` + `LastSelectedRepo{id, fullName, defaultBranch}`)
- [x] 1.5 `cd apps/ios/Modules/API && swift build && swift test`

## 2. View model draft mode

- [x] 2.1 Create `CloudeCode/Features/AgentSession/Draft/NewSessionDraft.swift` — `@MainActor @Observable`; state (`catalog`, `repos`, selected provider/model/repo/branch, loading/error flags); `load()` fetches `/models` + `/repos` concurrently and resolves persisted defaults with connection/selectable validation (branch resets to repo default on repo change); `createSession(content:attachmentIds:)` builds `CreateSessionRequest` (omit `branch` when default, omit `settings` when no model)
- [x] 2.2 Refactor `AgentSessionViewModel`: single `Context` enum (`session(SessionSummaryModel)` / `draft(NewSessionDraft)`), optional socket, injected `makeSocket` factory, `sessionSummaryStore` dep, derived `session`/`draft`/`isDraftMode`; guard all `session.id`/`socket` uses (`applySyncResponse`, `applyAgentFinish`, `applyUserMessage`, `acceptOptimisticUserMessage`, `loadCachedMessages`, `markReadIfNeeded`)
- [x] 2.3 Extract `bind()` body into `startSocketPipeline(socket:loadCache:)`; draft `bind()` calls `draft.load()` and sets `hasLoadedMessages = true`
- [x] 2.4 Draft branch in `submitDraft()`: shared optimistic steps first, then `draft.createSession(...)` → `adoptCreatedSession(response)` (mint `SessionSummary` with response id/title + draft repo fields, transition context to `.session`, `attachmentStore.adoptSessionId`, `makeSocket` + `startSocketPipeline(loadCache: false)`); failure → existing `recordSendError`. Ensure draft `canSubmitDraft` requires a selected repo, NOT `connectionState == .connected`
- [x] 2.5 Add `adoptSessionId(_:)` to `ImageAttachmentStore`
- [x] 2.6 Update `AgentSessionComponent`: `init(parent:session: SessionSummaryModel?)`, new deps on `AgentSessionDependency` (`sessionsAPI`, `reposAPI`, `modelsAPI`, `sessionSummaryStore`), construct exactly one view-model context (existing session or new draft), add `AgentSessionBuilder.buildNewSession()`
- [x] 2.7 Regenerate Needle: `cd apps/ios && needle generate CloudeCode/Generated/NeedleGenerated.swift CloudeCode/`

## 3. Views

- [x] 3.1 `AgentSessionView`: nil-safe navigation title (`session?.title ?? (isDraftMode ? "New session" : "Untitled session")`), draft empty state through the existing single-scrollview path, error toast via `.onChange(of: store.errorMessage)` (mirrors HomeView's toast)
- [x] 3.2 `PromptComposerView`: add generic defaulted `@ViewBuilder trailingAccessory` slot rendered immediately before `SendButton`
- [x] 3.3 Create `Features/AgentSession/Draft/ProviderIconView.swift` + asset catalog entries (`ProviderAnthropic`/`ProviderOpenai` template images; SF Symbol placeholders with TODO if brand assets unavailable)
- [x] 3.4 Create `ModelPickerButton.swift` + `ModelPickerSheet.swift` — capsule glass button (`<icon> <displayName>` / "Select model"); sheet `.presentationDetents([.medium])`, provider sections, rows disabled when `!connected || requiresReauth || !selectable`, persist on pick; `// TODO: effort level`
- [x] 3.5 Create `RepoBranchPickerBar.swift`, `RepoPickerSheet.swift`, and `BranchPickerSheet.swift` — intrinsic-width glass pill with repository first and a conditional base-branch segment; separate `.presentationDetents([.medium, .large])` sheets provide searchable repository selection and a branch list with the default preselected and pinned as the first row; `// TODO: edit/plan mode toggle`
- [x] 3.6 Wire `AgentSessionView+ComposerView.swift`: `VStack { if isDraftMode { RepoBranchPickerBar } ; PromptComposerView(trailingAccessory: ModelPickerButton when draft) }`

## 4. Navigation + FAB

- [x] 4.1 `HomeRouter`: `path: [HomeDestination]` (`case session(SessionSummaryModel)`, `case newSession(id: UUID)`), associate a created session id with its stable draft route for notification matching, update `presentationOptionsFor`/`handleNotificationTap` pattern matches, add `pushNewSession()`
- [x] 4.2 `HomeView`: `.navigationDestination(for: HomeDestination.self)` switching to `sessionBuilder.build(session:)` / `buildNewSession()`; `NavigationLink(value: .session(s))`; FAB `.overlay(alignment: .bottomTrailing)` with `plus.bubble.fill` in a 56pt glass circle
- [x] 4.3 `HomeComponent`: builder closure for the nil-session component

## 5. Verification

- [x] 5.1 Build app: `xcodebuild -project apps/ios/CloudeCode.xcodeproj -scheme "CloudeCode Dev" -destination 'platform=iOS Simulator,name=iPhone 16 Pro' build` (SwiftLint runs in Debug)
- [ ] 5.2 Simulator: FAB push → empty transcript + repo bar + model button; persisted defaults render immediately on relaunch
- [ ] 5.3 Simulator: model sheet gates disconnected providers; repo sheet search + branch default + large detent
- [ ] 5.4 Simulator: send → optimistic message + working indicator instantly; session created; response streams; repo bar collapses; title updates; Home list shows the session exactly once
- [ ] 5.5 Simulator: failure path (airplane mode) → message retracted, draft + attachments restored, toast shown; pre-create attachment uploads with nil sessionId and appears in the created session
- [ ] 5.6 Regression: existing session open/send/reconnect; notification-tap routing after the `HomeDestination` change, including a created draft that remains visible
