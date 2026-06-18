## Context

The web chat transcript renders AI SDK `UIMessage` parts by walking each message's parts in order, normalizing provider-specific tool parts through `@repo/shared`, grouping adjacent compatible actions, and then dispatching to concrete renderers. iOS already receives the same raw AI SDK-compatible wire shapes through CoreAPI and reduces streaming chunks into Domain `SessionMessage` values, but assistant rendering currently treats most non-text parts as placeholder strings.

Server-derived todos and plan state remain durable client state outside the transcript. This design covers transcript rendering only: it maps the raw tool parts already present in each `SessionMessage` into an iOS-local normalized action model for display.

## Goals / Non-Goals

**Goals:**

- Provide a provider-aware iOS normalization layer for assembled `SessionMessage.Part.tool` and `.dynamicTool` values.
- Make provider coverage explicit so adding a new provider requires adding a corresponding normalizer case.
- Preserve raw transcript wire compatibility; normalized actions are a display projection, not the stored transcript.
- Keep unknown provider/tool behavior resilient by falling back to generic tool actions at runtime.
- Mirror representative web normalizer behavior with Swift tests.
- Replace placeholder assistant part rendering with ordered render items that support text, reasoning, tool actions, and fallbacks.

**Non-Goals:**

- Do not change `WireUIMessage`, `WireUIMessageChunk`, WebSocket messages, or HTTP transcript response shapes.
- Do not move durable todo or plan extraction from the server to iOS.
- Do not transpile TypeScript normalizer code into Swift.
- Do not require visual parity with every web tool renderer in the first implementation.

## Decisions

### Keep normalized transcript actions out of `api-contract`

`api-contract` remains the source of truth for raw client-facing wire data. Normalized transcript actions are produced locally from assembled message parts and are not currently emitted by the server. Adding only the normalized structs to `api-contract` would generate Swift data shapes but would not generate the provider-specific mapping logic, so iOS would still duplicate the important part.

Alternative considered: promote `NormalizedToolAction` to `api-contract`. This is only appropriate if the server becomes the producer of normalized transcript actions, either as a parallel message projection or as additional stream events. That is not this change.

### Keep provider identity in Domain and transcript normalization in AgentSession

Add a small Domain provider identity type:

- `AgentProviderID` with cases for Claude Code, OpenAI Codex, and unknown values

CoreAPI already generates `ProviderId`, but CoreAPI wire types should not escape the API package. The API layer should map `CoreAPI.ProviderId` and `CoreAPI.AgentSettings` into a Domain `AgentProviderID` enum instead of flattening provider ids to `String`.

Put the transcript normalization model and provider implementations under the AgentSession feature because this is application/rendering logic isolated to the chat transcript:

```text
CloudeCode/Features/AgentSession/
  TranscriptRendering/
    AgentSessionTranscriptBuilder.swift
    AgentSessionRenderItem.swift
    ToolActions/
      NormalizedToolAction.swift
      NormalizableToolPart.swift
      ToolPartNormalizer.swift
      ClaudeCodeToolPartNormalizer.swift
      OpenAICodexToolPartNormalizer.swift
```

Those types can be `internal` to the app target. They do not need to become global Domain vocabulary unless another feature starts consuming normalized transcript actions.

Alternative considered: put all normalized action types in Domain. That would make package-level tests straightforward, but it would promote AgentSession rendering concepts into the app-wide domain layer before there is a second consumer.

### Use protocol-based normalizers behind an exhaustive provider switch

The public entry point should look like a single dispatch function, for example:

```swift
public enum AgentProviderID: Sendable, Equatable, Codable {
    case claudeCode
    case openAICodex
    case unknown(String)
}

enum ToolActionNormalizer {
    static func normalize(part: SessionMessage.Part, providerId: AgentProviderID?) -> [NormalizedToolAction]
}
```

Internally, provider-specific implementations conform to `ToolPartNormalizer`. The input to provider normalizers should be a small AgentSession wrapper around the two renderable tool-part cases, so provider code does not switch over all message part variants:

```swift
struct NormalizableToolPart: Sendable, Equatable {
    let toolName: String
    let toolCallId: String
    let state: String
    let input: JSONValue?
    let output: JSONValue?
    let errorText: String?
}

protocol ToolPartNormalizer: Sendable {
    func normalize(_ part: NormalizableToolPart) -> [NormalizedToolAction]
}
```

The central dispatch should be the only place that selects a provider normalizer:

```swift
enum ToolActionNormalizer {
    static func normalize(
        part: SessionMessage.Part,
        providerId: AgentProviderID?
    ) -> [NormalizedToolAction] {
        guard let toolPart = NormalizableToolPart(part) else {
            return []
        }

        switch providerId {
        case .claudeCode:
            return ClaudeCodeToolPartNormalizer().normalize(toolPart)
        case .openAICodex:
            return OpenAICodexToolPartNormalizer().normalize(toolPart)
        case .unknown, nil:
            return [.other(from: toolPart)]
        }
    }
}
```

The mapping from CoreAPI to Domain should stay in `Modules/API`, for example:

```swift
extension AgentProviderID {
    init(_ provider: CoreAPI.ProviderId) {
        switch provider {
        case .claudeCode:
            self = .claudeCode
        case .openaiCodex:
            self = .openAICodex
        case .unknown(let value):
            self = .unknown(value)
        }
    }
}
```

This keeps Domain independent from generated wire types while still making provider dispatch enum-based in the AgentSession rendering layer. A new CoreAPI provider should require updating this mapper and the normalizer dispatch tests.

Unknown provider ids and unknown tool names must not throw. They produce `other` actions with the original tool name, input, output, state, tool call id, and error text where available.

Alternative considered: model the entire normalizer as an enum without a protocol. That is acceptable for two providers, but a protocol keeps per-provider parsing isolated and mirrors the web `ToolPartNormalizer` shape.

### Keep grouping separate from normalization

Normalization maps one tool part to one or more normalized actions. Grouping is a rendering concern and should live with the AgentSession transcript builder. The grouping behavior should match web's current policy: adjacent read, search, web, bash, and other actions can group; edit, write, todo, and plan render as standalone items.

### Use focused parity tests

Add Swift tests that cover representative action families from the web normalizer: file read/edit/write, command execution, search/web, todo/plan, fan-out, provider dispatch, and fallback. Do not clone every web fixture one-for-one; add targeted provider-specific cases only when parsing behavior is subtle or likely to drift.

## Risks / Trade-offs

- Drift from web provider mappings -> Mitigate with focused parity tests for action families and targeted cases for subtle provider parsing.
- Provider ids are currently flattened to strings while mapping CoreAPI to Domain -> Mitigate by adding a Domain `AgentProviderID` enum and mapping generated `CoreAPI.ProviderId` at the API boundary.
- `JSONValue` parsing can become verbose -> Mitigate with small private helpers for object/string/number/array extraction inside each normalizer.
- Initial UI may not render every payload richly -> Mitigate by always preserving `other` actions and rendering unsupported details through a generic tool row.
- Streaming parts can be incomplete -> Mitigate by allowing empty/default payload fields and updating rows as the accumulated `SessionMessage` changes.
