## Why

The chat thread is verbose, blocky, and hard to scan. Every tool call renders as a generic "exec" card with raw JSON input/output, and they remain expanded in the thread forever — even after the agent has finished and produced a final text response. Users want to see *what's happening* while the agent works, but only the final answer afterward, with the work hidden behind a single collapsible "Worked for Xm Ys" affordance (Cursor-style). Individual tool parts also need compact, type-aware representations ("Read 3 files", "Deleted proxy.ts", inline diff for edits) and adjacent same-tool calls should group. We also have two providers (Claude and Codex) with completely different tool names and payload shapes (Claude: `Read`/`Edit`/`Bash`/...; Codex: `exec` with `commandExecution`, `patch` with `fileChange`, `update_plan`). The renderer should not have to know about either — we need a shared normalization layer.

## What Changes

- Add a shared **tool normalization** layer in `@repo/shared` that maps a raw `DynamicToolUIPart` (from either provider) into a normalized `{ kind, payload }` action shape. Kinds: `read`, `edit`, `write`, `bash`, `search`, `web`, `todo`, `plan`, `other`. Knows about Claude's tool names and Codex's `commandExecution`/`fileChange`/`update_plan` payload shapes.
- Add **server-side timing** to `MessageAccumulator` in `@repo/shared`:
  - Stamp `message.metadata.startedAt` on the first chunk of an assistant message and `metadata.endedAt` on `finish` / `abort` / `error`.
  - Stamp per-reasoning-part `startedAt` / `endedAt` so the UI can render "Thought for 10s" on each reasoning block.
  - Stamp per-tool-part `startedAt` (on `tool-input-start` / `tool-input-available`) and `endedAt` (on `tool-output-available` / `tool-output-error`) for live "running 12s" indicators and historical durations.
- Replace the per-part blocky `ToolCallPart` rendering with type-aware compact part renderers (read/edit/write/bash/search/etc.), dispatched off the normalized `kind`, each with one-line summary + expand-to-detail.
- Group adjacent tool parts of the same `kind` into a single line ("Read 3 files", "Searched 2 patterns") with expand-to-list.
- Inline diff viewer for `edit`/`write` parts. Codex's `patch`/`fileChange` already provides a unified diff string in `input.changes[].diff`; Claude's `Edit` provides `old_string`/`new_string` and `MultiEdit` provides `edits[]`. The normalizer hands the renderer a uniform diff payload.
- Collapse settled assistant turns: once a turn produces a final text part and is no longer streaming, hide work parts behind a "Worked for {duration}" expander above the final text. Streaming turns render live.
- Reasoning parts render "Thought for {duration}" using their per-part timing.
- **BREAKING** (storage-shape additive only): `message.metadata` and select parts gain optional timing fields. Historical records without these fields render with a fallback ("Worked", "Thought") and are otherwise unaffected.

## Capabilities

### New Capabilities
- `message-thread-display`: Rules for how assistant turns, tool parts, reasoning, and final text are visually rendered, collapsed, grouped, and expanded in the chat thread.
- `tool-normalization`: A per-provider protocol in `@repo/shared` that maps an already-assembled `DynamicToolUIPart` into a fixed kind taxonomy plus structured payload. Each `ProviderId` has its own implementation file; a single `getToolNormalizer(providerId)` factory dispatches via a `switch` with a `never` exhaustiveness check (matching the existing `provider-credential-adapter.ts` pattern). Adding Gemini = new id + new file + new case; TypeScript refuses to compile until all three are present. Called at render time on the client; reusable by any future read-side consumer.
- `message-timing`: Server-side timestamps written by `MessageAccumulator` onto messages, reasoning parts, and tool parts to power duration displays.

### Modified Capabilities
<!-- none — no existing specs in openspec/specs/ -->

## Impact

- `packages/shared/src/utils/message-accumulator.ts` — add `startedAt`/`endedAt` on message metadata; add timing to reasoning/tool parts.
- `packages/shared/src/types/` — extend reasoning/tool/message metadata shapes with optional timing fields; add normalized tool action types.
- `packages/shared/src/tool-normalization/` (new directory) — `ToolPartNormalizer` interface, per-provider implementations under `providers/`, and a `getToolNormalizer(providerId)` factory using the exhaustive-switch pattern from `services/api-server/src/lib/providers/provider-credential-adapter.ts`. Called from the web renderer; no server caller in this change.
- `apps/web/components/chat/message-item.tsx` — turn collapse, "Worked for" header, grouping pass.
- `apps/web/components/parts/` — type-aware compact renderers dispatched off normalized kind + a shared `ExpandableSummary` primitive; replace `tool-call-part.tsx` with a generic fallback used only for `kind === "other"`.
- DO storage continues to persist whatever `MessageAccumulator` produces — no migration; new fields are optional.
- vm-agent: no changes. Raw provider tool parts pass through; normalization is purely a read-side concern.
- Visual regression risk for live sessions; no data migration.
