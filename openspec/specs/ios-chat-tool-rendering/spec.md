# ios-chat-tool-rendering Specification

## Purpose
TBD - created by archiving change add-ios-tool-normalization. Update Purpose after archive.
## Requirements
### Requirement: Provider-aware transcript tool normalization

iOS SHALL normalize assembled transcript tool parts into provider-agnostic tool actions inside the AgentSession chat rendering layer before rendering assistant work items. The normalizer MUST accept a `SessionMessage.Part` and the session provider id, and MUST return zero or more normalized actions without mutating the raw transcript message.

#### Scenario: Claude tool part normalizes to an action

- **WHEN** an assistant transcript contains a Claude Code dynamic tool part for a recognized file, shell, search, web, todo, or plan tool
- **THEN** iOS maps that part to the corresponding normalized action kind with the original tool call id, tool name, state, and available input or output details

#### Scenario: Codex tool part normalizes to an action

- **WHEN** an assistant transcript contains an OpenAI Codex dynamic tool part for command execution, file changes, or plan updates
- **THEN** iOS maps that part to the corresponding normalized bash, edit, write, or todo action with the original tool call id, tool name, state, and available input or output details

#### Scenario: Multi-action tool part fans out

- **WHEN** a single provider tool part describes multiple normalized actions, such as a multi-edit or a patch with multiple file changes
- **THEN** iOS returns multiple normalized actions in provider order

### Requirement: Explicit provider normalizer coverage

iOS SHALL route AgentSession tool normalization through an explicit provider dispatch point using a Domain provider enum mapped from generated CoreAPI provider ids. Every known supported provider MUST have a corresponding normalizer implementation or test-covered fallback decision so adding a provider exposes the required mapping work.

#### Scenario: Supported provider dispatches to normalizer

- **WHEN** the session provider id is `claude-code` or `openai-codex`
- **THEN** iOS dispatches transcript tool parts to the matching provider-specific normalizer

#### Scenario: CoreAPI provider maps to Domain provider

- **WHEN** the API layer receives generated `CoreAPI.ProviderId` values in session client state
- **THEN** it maps them into Domain provider enum cases before transcript rendering reads the provider

#### Scenario: Unknown provider uses fallback

- **WHEN** the session provider id is missing or not recognized
- **THEN** iOS renders transcript tool parts as generic `other` actions rather than dropping the parts or failing the transcript render

### Requirement: Unknown tool fallback rendering

iOS SHALL preserve unknown tool parts as generic tool actions. The fallback action MUST include the tool name, tool call id, state, input, output, and error text when those fields are available.

#### Scenario: Recognized provider with unknown tool

- **WHEN** a supported provider emits a tool part whose tool name has no provider-specific handler
- **THEN** iOS returns one `other` normalized action preserving available raw details

#### Scenario: Tool part is incomplete during streaming

- **WHEN** a streamed tool part has a tool call id and state but incomplete input or output
- **THEN** iOS still returns a stable normalized action suitable for incremental rendering

### Requirement: Ordered chat render items

iOS SHALL build assistant transcript render items from message parts in original part order. Text and reasoning parts MUST remain ordered relative to normalized tool actions, and adjacent compatible tool actions MAY be grouped only when grouping does not reorder text, reasoning, or non-groupable actions.

#### Scenario: Text separates tool groups

- **WHEN** a message contains tool parts, then text, then additional tool parts
- **THEN** iOS renders the first tool actions, then the text, then the later tool actions in that order

#### Scenario: Adjacent compatible actions group

- **WHEN** adjacent normalized actions are groupable read, search, web, bash, or other actions of the same kind
- **THEN** iOS can render them as a grouped work item with a stable key based on the first action

#### Scenario: Non-groupable actions remain standalone

- **WHEN** normalized actions are edit, write, todo, or plan actions
- **THEN** iOS renders them as standalone work items even when adjacent to actions of the same kind

### Requirement: Focused normalization parity tests

iOS SHALL include focused tests for representative Claude Code and OpenAI Codex normalizer behavior. The tests MUST cover action families, multi-action fan-out, fallback behavior, and provider dispatch without requiring one Swift fixture for every web fixture.

#### Scenario: Claude action-family parity

- **WHEN** Swift tests construct representative Claude Code tool parts for file operations, command execution, search or web use, todo or plan use, fan-out, and fallback
- **THEN** the normalized action kinds and key payload fields match the expected web behavior for those action families

#### Scenario: Codex action-family parity

- **WHEN** Swift tests construct representative OpenAI Codex tool parts for command execution, file changes, todo or plan updates, fan-out, and fallback
- **THEN** the normalized action kinds and key payload fields match the expected web behavior for those action families

#### Scenario: Provider coverage test

- **WHEN** the generated API contract lists supported provider ids
- **THEN** Swift tests verify the iOS normalizer dispatch covers each known provider id or intentionally falls back with a documented assertion

