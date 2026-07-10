## Why

Cached iOS transcripts are projected before the session WebSocket supplies the Durable Object's provider, so provider-specific tools briefly collapse into a generic "Used N tools" group. Inferring a provider from tool names is heuristic and can become incorrect as providers evolve; the immutable session provider should instead be available with the cached session summary.

## What Changes

- Persist the selected provider as a denormalized field on the existing D1 `sessions` row, while keeping Durable Object state authoritative.
- Include the provider in session summary HTTP and WebSocket payloads and cache it in the iOS session summary entity.
- Stage cached transcript messages until a known provider is available, then build provider-specific display data once; remove provider inference from tool normalization.
- Preserve compatibility for the small number of existing sessions by leaving their new summary field null without backfilling or reconciling it.

## Capabilities

### New Capabilities

- `session-provider-summary`: Defines how a session provider is persisted, exposed, and consumed for deterministic cached transcript rendering.

### Modified Capabilities

- `ios-chat-tool-rendering`: Requires cached assistant tool traces to use an authoritative provider and forbids heuristic provider inference.
- `user-sessions-stream`: Adds the provider to session summary snapshots and invalidation-driven updates.

## Impact

- D1 `sessions` schema and session repository create/read paths.
- Shared API contracts, generated Swift CoreAPI models, and API-to-domain mappings.
- iOS `SessionSummary` domain/entity/model persistence, AgentSession dependency wiring, and transcript bootstrap behavior.
- Server, codegen, cache persistence, and transcript state tests.
