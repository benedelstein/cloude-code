## 1. Provider Identity Boundary

- [x] 1.1 Add a Domain `AgentProviderID` enum with Claude Code, OpenAI Codex, and unknown cases.
- [x] 1.2 Map generated `CoreAPI.ProviderId` / `CoreAPI.AgentSettings` into `AgentProviderID` at the API boundary.
- [x] 1.3 Update `SessionClientState.AgentSettings.provider` to expose `AgentProviderID` instead of a raw string.

## 2. AgentSession Normalization Model

- [x] 2.1 Add AgentSession-internal normalized tool action types for read, edit, write, bash, search, web, todo, plan, and other payloads.
- [x] 2.2 Add AgentSession helper accessors for extracting tool name, state, tool call id, input, output, and error text from `SessionMessage.Part.tool` and `.dynamicTool`.
- [x] 2.3 Add a `ToolPartNormalizer` protocol and central `ToolActionNormalizer.normalize(part:providerId:)` entry point with generic fallback behavior.

## 3. Provider Normalizers

- [x] 3.1 Implement Claude Code normalization for Read, Edit, MultiEdit, Write, Bash, Grep, Glob, WebFetch, WebSearch, TodoWrite, TaskCreate, TaskUpdate, TaskList, TaskGet, and ExitPlanMode.
- [x] 3.2 Implement OpenAI Codex normalization for exec command execution, patch file changes, update_plan todos, and unknown-tool fallback.
- [x] 3.3 Add provider dispatch coverage for `.claudeCode` and `.openAICodex`, with unknown or missing provider ids returning generic `other` actions.

## 4. Transcript Render Model

- [x] 4.1 Add an AgentSession transcript render-item builder that walks `SessionMessage.parts` in order and converts text, reasoning, and normalized tool actions into render items.
- [x] 4.2 Add grouping for adjacent read, search, web, bash, and other actions while preserving text/reasoning boundaries and standalone edit, write, todo, and plan actions.
- [x] 4.3 Wire the builder to use `clientState.agentSettings.provider` for assistant messages and streaming messages.

## 5. SwiftUI Rendering

- [x] 5.1 Replace placeholder assistant part rendering with render-item based views for text and reasoning.
- [x] 5.2 Add initial tool action views for todo, bash, read/search/web summaries, edit/write summaries, plan, and generic other actions.
- [x] 5.3 Ensure incomplete streaming tool parts render stable rows and update as the accumulated message changes.

## 6. Tests And Validation

- [x] 6.1 Add CloudeCodeTests coverage for Claude Code action families: file operations, command execution, search or web use, todo or plan use, fan-out, and fallback.
- [x] 6.2 Add CloudeCodeTests coverage for OpenAI Codex action families: command execution, file changes, todo or plan updates, fan-out, and fallback.
- [x] 6.3 Add tests for provider dispatch coverage and unknown-provider fallback behavior.
- [x] 6.4 Add tests for transcript render-item ordering and grouping behavior around text/reasoning boundaries.
- [x] 6.5 Run `swiftlint lint --strict --no-cache`.
- [x] 6.6 Run `xcodebuild -project CloudeCode.xcodeproj -scheme CloudeCode -configuration Debug -destination 'generic/platform=iOS Simulator' -derivedDataPath .build/DerivedData CODE_SIGNING_ALLOWED=NO build`.
