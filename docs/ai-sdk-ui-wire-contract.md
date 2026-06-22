# AI SDK UI Wire Contract

This repo stores and streams AI SDK UI state, but it does not expose raw AI SDK
TypeScript types directly as the cross-platform API contract. The client-facing
contract is defined by app-owned `WireUIMessage`, `WireUIMessagePart`, and
`WireUIMessageChunk` schemas in `packages/api-contract/src/ui-message/`.

The wire JSON intentionally mirrors AI SDK `UIMessage` and `UIMessageChunk`
JSON. The point is ownership and portability, not protocol divergence.

## Why not just use AI SDK types?

AI SDK's `UIMessage`, `UIMessagePart`, and `UIMessageChunk` are TypeScript
library types. They are useful inside TypeScript packages, but they are not a
complete API boundary for this app.

We need app-owned wire schemas because:

- **Swift needs Codable models.** The iOS app consumes generated CoreAPI Swift
  types. AI SDK does not provide Swift `Codable` decoders for its UI message
  JSON.
- **The API needs a stable contract package.** `@repo/api-contract` is the
  source of truth for HTTP, WebSocket, client state, and Swift codegen. A third
  party TypeScript type is not enough metadata for that pipeline.
- **Unknown future variants must survive.** Older clients should decode and
  preserve unknown message parts/chunks instead of failing when AI SDK adds a
  new variant.
- **Known variants still need shape checks.** A known chunk like
  `text-delta` must include required fields such as `id` and `delta`; it should
  not be accepted as an opaque unknown object just because parsing failed.
- **Codegen needs discriminator metadata.** Swift generation needs case names,
  exact discriminator values, prefix cases like `data-*`, and unknown raw JSON
  preservation. Zod and AI SDK TypeScript types do not carry all of that in the
  shape the generator needs.

AI SDK runtime validators are still useful for compatibility tests and
TypeScript-side behavior. They do not replace the app-owned API contract.

## What the wire schemas are for

Use the `Wire*` schemas for API boundary work:

- Defining client-facing HTTP, WebSocket, and client-state payloads.
- Generating Swift CoreAPI `Codable` models.
- Decoding WebSocket JSON on iOS and mapping known chunks to SwiftAISDK.
- Validating that raw AI SDK UI JSON is structurally safe to send over the API.
- Preserving additive fields and unknown future variants at the wire boundary.
- Filtering known wire chunks before passing them into AI SDK stream readers.

The main runtime helpers are:

- `validateWireCompatibleMessage(value)` - throws if the value is not safe for
  the API boundary; does not return parsed output.
- `validateWireCompatibleChunk(value)` - same for stream chunks.
- `aiMessageFromWire(message)` - maps known wire message parts to AI SDK
  TypeScript rendering state.
- `aiChunkFromWire(chunk)` - returns a known AI SDK chunk or `undefined` for an
  unknown future chunk.

Use validation as a guard:

```ts
validateWireCompatibleChunk(rawChunk);
store(rawChunk);
broadcast(rawChunk);
```

Current server guard points are `AgentTurnCoordinator.handleChunks(...)` before
writing fresh chunks to the pending-chunk WAL, and
`SessionSyncService.buildSyncResponse()` before returning stored messages or
pending chunks to clients. Those paths validate compatibility but keep the
original AI SDK JSON as the stored and transported value.

Do not make parsed wire output canonical:

```ts
const parsed = WireUIMessageChunkSchema.parse(rawChunk);
store(parsed); // wrong for storage paths
```

## What the wire schemas are not for

The `Wire*` schemas are not a storage format converter. Storage remains AI SDK
UI JSON as emitted by the agent/runtime.

Do not use the wire schemas to:

- Normalize messages before inserting into SQLite.
- Strip or canonicalize additive AI SDK fields.
- Convert the pending chunk WAL into app-owned DTO output.
- Replace the server `MessageAccumulator` state machine.
- Define model-call inputs. Use AI SDK `ModelMessage` concepts only for model
  calls, not UI transcript state.
- Invent a Cloude-specific transcript protocol.

## Data flow

```text
Storage:
  AI SDK UIMessage / UIMessageChunk JSON, preserved as emitted

Transport:
  same JSON shape, optionally guarded by Wire validation before send

Swift CoreAPI:
  generated WireUIMessage / WireUIMessageChunk / WireUIMessagePart models

iOS API layer:
  maps Wire -> domain models and known Wire chunks -> SwiftAISDK chunks

Web:
  can render AI SDK UIMessage directly; filters Wire chunks before
  readUIMessageStream
```

## Open unions

`UI_MESSAGE_PART_OPEN_UNION` and `UI_MESSAGE_CHUNK_OPEN_UNION` describe open
discriminator unions. They are intentionally more than a list of valid types.

They provide:

- The runtime rule: known discriminator values validate against their full
  schema; unknown discriminator values preserve raw JSON.
- Prefix-case support for AI SDK shapes such as `data-*` and `tool-*`.
- Swift codegen metadata: case names, Swift type names, discriminator values,
  prefix cases, and unknown raw-value behavior.
- Known-vs-unknown checks for adapters such as `aiChunkFromWire`.

This is why those configs duplicate some schema names today. If that gets too
hard to maintain, the right refactor is to make the open-union config the
single source of truth and derive the runtime schema/type helpers from it. The
behavior should remain the same.
