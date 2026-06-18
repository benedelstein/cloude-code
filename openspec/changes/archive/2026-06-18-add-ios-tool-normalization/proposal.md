## Why

iOS currently renders assistant transcript parts as mostly flat placeholder text, while web maps provider-specific tool parts into provider-agnostic actions before rendering. The iOS chat surface needs the same transcript-level normalization so Claude Code and OpenAI Codex tool use can render consistently during streaming and after sync.

## What Changes

- Add an iOS transcript tool-normalization layer that maps assembled `SessionMessage.Part` tool parts into provider-agnostic actions such as read, edit, write, bash, search, web, todo, plan, and other.
- Use a provider-dispatched normalizer API so each supported provider has an explicit mapping implementation and adding a provider exposes the missing mapping work.
- Keep normalization local to iOS Domain/UI rendering rather than adding normalized transcript actions to the API contract, because the server continues to send raw AI SDK-compatible message parts and durable todo/plan state separately.
- Add Swift tests that mirror representative web normalizer fixtures for Claude Code and OpenAI Codex to reduce drift.
- Replace placeholder assistant tool rendering with ordered transcript render items that preserve message part order, group adjacent compatible tool actions, and fall back to generic tool rows for unknown providers or tools.

## Capabilities

### New Capabilities
- `ios-chat-tool-rendering`: iOS renders raw transcript message parts through provider-aware normalized tool actions while preserving raw wire compatibility and fallback behavior.

### Modified Capabilities

## Impact

- Affected iOS modules: `Modules/Domain`, `Modules/API` tests where provider state is mapped, and `CloudeCode/Features/AgentSession` rendering.
- No API wire-shape change is expected for this proposal.
- No server durable client-state changes are expected; existing server-derived `todos` and `plan` remain separate from transcript rendering.
- Test impact: new Domain/API-focused unit tests plus existing iOS build, lint, and typecheck validation.
