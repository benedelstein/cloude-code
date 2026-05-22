## ADDED Requirements

### Requirement: Shared normalization maps raw tool parts to a fixed kind taxonomy

`@repo/shared` SHALL export a function `normalizeToolPart(part: DynamicToolUIPart, providerId: ProviderId): NormalizedToolAction[]` that maps any tool part from the given provider into one or more actions with a `kind` from the fixed set: `read | edit | write | bash | search | web | todo | plan | other`. Each provider's normalizer MUST consider the raw tool name first, and for ambiguous Codex tools MUST inspect `input.type` (`commandExecution` / `fileChange`). Unknown tools MUST fall back to a single `kind: "other"` action with raw input/output preserved on the payload. Each returned action MUST carry the part's `state`, optional `errorText`, and a back-pointer to the source `toolCallId` so renderers can produce stable keys.

#### Scenario: Claude Read maps to read
- **WHEN** `normalizeToolPart` receives a part with `toolName="Read"` and `input={ file_path: "/x/y.ts" }`
- **THEN** it returns a single action with `kind="read"` and `payload.paths=["/x/y.ts"]`

#### Scenario: Claude MultiEdit fans out to multiple edit actions
- **WHEN** a `MultiEdit` part has two entries in `input.edits`
- **THEN** the function returns two actions, both `kind="edit"`, each with its own diff

#### Scenario: Codex exec maps to bash
- **WHEN** a part with `toolName="exec"` has `input.type="commandExecution"` and `input.command="ls"`
- **THEN** the result is a single action with `kind="bash"` and `payload.command="ls"`

#### Scenario: Codex patch with mixed changes fans out
- **WHEN** a `patch` part has `changes[0].kind.type="update"` and `changes[1].kind.type="add"`
- **THEN** the function returns two actions: one `kind="edit"` (using the provided `diff` string) and one `kind="write"` with `payload.isNew=true`

#### Scenario: Codex update_plan maps to todo
- **WHEN** a part has `toolName="update_plan"`
- **THEN** the result is a single action with `kind="todo"`

#### Scenario: MCP tool falls back to other
- **WHEN** a part has `toolName="mcp__github__list_prs"`
- **THEN** the result is a single action with `kind="other"` and the raw input/output preserved

### Requirement: Normalization is extensible via a per-provider protocol with exhaustive `providerId` dispatch

Provider-specific mapping logic SHALL live in per-provider modules under `tool-normalization/providers/`, one file per `ProviderId`. Each module SHALL export a `ToolPartNormalizer` whose `normalize(part)` is a pure function returning `NormalizedToolAction[]`. Tool names a provider does not recognize MUST be returned as a single `kind: "other"` action via the shared `fallbackOtherAction` helper.

A single `getToolNormalizer(providerId: ProviderId): ToolPartNormalizer` factory in `tool-normalization/index.ts` SHALL switch on `providerId` and dispatch to the correct module. The switch MUST end with a `default` arm that assigns `providerId` to `never` and throws (the standard exhaustiveness pattern used elsewhere in this codebase, e.g. `services/api-server/src/lib/providers/provider-credential-adapter.ts`). This makes adding a new `ProviderId` without a corresponding case a compile-time error.

Adding a new provider MUST require only:
1. Adding the new id to `ProviderId` in `packages/shared/src/types/providers/`.
2. Creating `tool-normalization/providers/<provider>.ts` exporting a `ToolPartNormalizer`.
3. Adding one case to the `getToolNormalizer` switch.
4. Tests for the new provider's tool shapes.

It MUST NOT require edits to the public types, the fallback module, the renderer, the consumer call site, or any other provider's module. The TypeScript exhaustiveness check on the existing switch MUST refuse to compile until step 3 is done.

#### Scenario: Compile-time enforcement when adding a provider
- **WHEN** a developer adds a new value to `ProviderId` without updating the `getToolNormalizer` switch
- **THEN** TypeScript fails to compile because the `never` assignment in the `default` arm rejects the new union member

#### Scenario: Adding Gemini in three local edits plus tests
- **WHEN** a developer creates `providers/gemini.ts`, adds a case `case "gemini": return geminiToolNormalizer;` to the switch, and adds the id to `ProviderId`
- **THEN** Gemini tool parts normalize correctly with no edits to `types.ts`, `fallback.ts`, the renderer, or any other provider module

#### Scenario: Unknown tool routes through shared fallback
- **WHEN** a provider's `normalize` is called with a tool name it does not recognize
- **THEN** it returns `[fallbackOtherAction(part)]` and the result is consistent with the fallback used by every other provider

#### Scenario: Public dispatch lives in one place
- **WHEN** inspecting the codebase
- **THEN** there is exactly one `switch (providerId)` for tool normalization, in `tool-normalization/index.ts`, and `fallback.ts` and `types.ts` contain no references to specific tool names, provider ids, or `input.type` discriminators

### Requirement: Normalization runs at render time over assembled parts, not at stream time over chunks

`normalizeToolPart` SHALL accept an already-assembled `DynamicToolUIPart`. It MUST NOT consume raw stream chunks or hold any state across calls. The server (`MessageAccumulator`, the DO, vm-agent) MUST NOT call this function during streaming and MUST NOT transform the persisted part shape; tool parts are persisted exactly as the AI SDK produces them. Render-time recomputation is the intended usage model.

#### Scenario: Renderer normalizes a part still in input-available state
- **WHEN** a tool part has `state="input-available"` and no `output` yet
- **THEN** `normalizeToolPart` returns a valid action (with `state="input-available"`) and the renderer can show the summary line before the output arrives

#### Scenario: Server does not transform tool parts during streaming
- **WHEN** chunks for a tool part flow through `MessageAccumulator`
- **THEN** the resulting `DynamicToolUIPart` retains its raw provider `toolName`, `input`, and `output` shapes; no normalized fields are written by the server
