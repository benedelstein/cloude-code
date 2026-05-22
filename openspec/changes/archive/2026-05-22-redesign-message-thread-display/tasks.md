## 1. Shared types & timing in `@repo/shared`

- [x] 1.1 Add `packages/shared/src/types/message-timing.ts` exporting `PartTiming { startedAt?: number; endedAt?: number }`, `MessageTiming` (alias for the same on `metadata`), and `getPartTiming(part: unknown): PartTiming` helper.
- [x] 1.2 Update `packages/shared/src/utils/message-accumulator.ts`:
  - On the first `process(chunk)` call for the instance, if `this.startedAt` is unset, record it; surface it via `metadata.startedAt` when the message is built.
  - On `text-start` for the *first* opening chunk where no part-creating chunk has run yet, also stamp `startedAt` (covers streams that start with text directly).
  - On `reasoning-start`: stamp `startedAt` on the new reasoning part. On `reasoning-end`: stamp `endedAt`.
  - On `tool-input-start` or `tool-input-available` (whichever comes first per `toolCallId`): stamp `startedAt` on the tool part. On `tool-output-available` / `tool-output-error`: stamp `endedAt`.
  - In `finalizePendingParts`: stamp `endedAt = Date.now()` on any part still missing it.
  - On `finish` / `abort` / `error` and in `forceAbort()`: shallow-merge `messageMetadata` into existing metadata, preserving an existing `startedAt`, and set `metadata.endedAt`.
- [x] 1.3 Add unit tests for the accumulator covering: fresh message stamps `startedAt`; finish sets `endedAt` and preserves `startedAt`; reasoning lifecycle; tool lifecycle (both with and without `tool-input-start`); abort path; provider `messageMetadata` merge.
- [x] 1.4 Verify no DO storage migration is needed by reading `services/api-server/src/durable-objects/session-agent-do.ts` persistence path; confirm extra fields round-trip through the existing serializer. If the serializer strips unknown keys, add timing fields to whatever schema gates persistence.

## 2. Tool normalization in `@repo/shared` (per-provider, exhaustive switch)

Pattern reference: `services/api-server/src/lib/providers/provider-credential-adapter.ts`.

- [x] 2.1 Create directory `packages/shared/src/tool-normalization/` with `types.ts` exporting:
  - `ToolKind` union (`"read" | "edit" | "write" | "bash" | "search" | "web" | "todo" | "plan" | "other"`).
  - Per-kind payload interfaces (`ReadAction`, `EditAction`, `WriteAction`, `BashAction`, `SearchAction`, `WebAction`, `TodoAction`, `PlanAction`, `OtherAction`).
  - `NormalizedToolAction` with `kind`, `toolName`, `toolCallId`, `state`, `errorText?`, and `payload` discriminated by `kind`.
  - `ToolPartNormalizer` interface: `{ normalize(part: DynamicToolUIPart): NormalizedToolAction[] }`.
- [x] 2.2 Add `tool-normalization/fallback.ts` exporting `fallbackOtherAction(part): NormalizedToolAction` producing `{ kind: "other", payload: { toolName, input, output } }`. **No tool-name or provider knowledge in this file.**
- [x] 2.3 Add `tool-normalization/utils/diff.ts` — small dependency-free unified line diff (`lineDiff(oldText, newText): string`).
- [x] 2.4 Add `tool-normalization/providers/claude.ts` exporting `claudeToolNormalizer: ToolPartNormalizer`. Internal handler map keyed by tool name covers `Read`, `Edit`, `MultiEdit`, `Write`, `Bash`, `Grep`, `Glob`, `WebFetch`, `WebSearch`, `TodoWrite`, `ExitPlanMode`. Unknown tool names return `[fallbackOtherAction(part)]`. Uses `utils/diff.ts` for `Edit`/`MultiEdit` diffs.
- [x] 2.5 Add `tool-normalization/providers/codex.ts` exporting `codexToolNormalizer: ToolPartNormalizer`. Detection by tool name *or* `input.type` discriminator: `exec` / `commandExecution` → bash; `patch` / `fileChange` → fan out one action per `input.changes[i]` (update→edit using provided `change.diff`; add→write isNew; delete→write deleted); `update_plan` → todo. Unknown → `[fallbackOtherAction(part)]`.
- [x] 2.6 Add `tool-normalization/index.ts` exporting:
  - `getToolNormalizer(providerId: ProviderId): ToolPartNormalizer` — single switch with `case "claude-code"` / `case "openai-codex"` and a `default` arm asserting `providerId: never` and throwing. Mirrors `provider-credential-adapter.ts:getProviderCredentialAdapter`.
  - `normalizeToolPart(part, providerId)` — thin wrapper calling `getToolNormalizer(providerId).normalize(part)`.
  - Re-exports of all public types.
- [x] 2.7 Re-export the public surface from `packages/shared/src/index.ts`.
- [x] 2.8 Unit tests:
  - `providers/__tests__/claude.test.ts`: Read, Edit (diff produced), MultiEdit fan-out, Write, Bash, Grep, Glob, WebFetch, WebSearch, TodoWrite, ExitPlanMode, unknown → fallback `other`.
  - `providers/__tests__/codex.test.ts`: exec → bash; patch update → edit with provided diff; patch add → write isNew; patch delete → write deleted; mixed patch fan-out; update_plan → todo; unknown → fallback `other`.
  - `__tests__/index.test.ts`: `getToolNormalizer("claude-code")` returns the Claude normalizer; `getToolNormalizer("openai-codex")` returns the Codex normalizer; the type-system rejects an unknown id (compile-time check via a `// @ts-expect-error` test fixture asserting the never-arm).

## 3. Web foundations

- [x] 3.1 Add `apps/web/components/parts/expandable-summary.tsx` — shared row primitive (icon slot, single-line text slot, optional right-aligned status, chevron, expandable detail panel; local `useState` for expansion).
- [x] 3.2 Add `apps/web/lib/duration.ts` — `humanizeDuration(ms)` returning "12s", "5m 15s", "1h 3m".
- [x] 3.3 Add `apps/web/lib/use-now.ts` — single shared hook `useNow(intervalMs)` returning `Date.now()` updated on a timer; cleans up on unmount.

## 4. Compact part renderers (web)

- [x] 4.1 Add `read-part.tsx` and `read-group-part.tsx` consuming `ReadAction` (group renderer accepts `ReadView[]`).
- [x] 4.2 Add `edit-part.tsx` consuming `EditAction`. Render the `payload.diff` string with line-by-line styling (red/green backgrounds), capped at 200 lines with "Show more".
- [x] 4.3 Add `write-part.tsx` consuming `WriteAction` — handles created/updated/deleted variants and shows content when present.
- [x] 4.4 Add `search-part.tsx` and `search-group-part.tsx` consuming `SearchAction`.
- [x] 4.5 Add `web-part.tsx` consuming `WebAction` (fetch vs search labels).
- [x] 4.6 Restyle existing `bash-part.tsx` to match the new compact one-line look. Update its props to consume `BashAction` instead of the raw part shape.
- [x] 4.7 Replace `tool-call-part.tsx` with `generic-tool-part.tsx` consuming `OtherAction` (compact line + raw JSON expand).

## 5. Reasoning rendering with timing

- [x] 5.1 Update `reasoning-part.tsx` to accept the part object (so it can read `startedAt`/`endedAt` via `getPartTiming`). Render "Thinking…" / "Thought for X" / "Thought" per the spec; expand to show reasoning text.

## 6. Grouping pass

- [x] 6.1 Add `apps/web/components/parts/group-actions.ts` — pure function over `NormalizedToolAction[]` that produces an array of either single actions or `{ kind, actions: [action, ...] }` groups, grouping only `read | search | web | other`. Unit-test the cases from the spec.
- [x] 6.2 Add `grouped-tool-part.tsx` — dispatches a group to the right group renderer.

## 7. `MessageItem` rewrite

- [x] 7.1 Compute `isSettled = !isStreaming`, `hasFinalText = parts.some(isTextUIPart && state==="done")`, `workParts = parts not text/image/step-start`.
- [x] 7.2 Thread the session's `providerId` from `MessageList` → `MessageItem` as a prop. (Source: the session record already carries `providerId`; pass it down from `chat-container.tsx`.)
- [x] 7.3 For each tool part, call `normalizeToolPart(part, providerId)` and concatenate the resulting actions into a flat `NormalizedToolAction[]`. Reasoning parts and todo/plan parts are interleaved as their own items in the same flat list (using a discriminated render-item type).
- [x] 7.3 If `isSettled` and `hasFinalText` and `workParts.length > 0`: pass the flat list through `group-actions.ts`; render `<TurnWorkHeader>` (collapsible, default collapsed) above the final text. Header reads "Worked for {humanize(metadata.endedAt - metadata.startedAt)}" or "Worked" if absent. While streaming, `useNow(1000)` drives the header value.
- [x] 7.4 Run the flat list through `group-actions.ts` in **both streaming and settled** states so adjacent same-kind groupable actions (read/search/web/other) collapse to a single row whose count grows in place as new parts arrive. Key the grouped row off the first child action's `toolCallId` so React keeps the row mounted as it grows. Aborted messages bypass collapsing and show "Interrupted".
- [x] 7.5 Dispatch each item to its renderer (`ReadPart`, `EditPart`, ..., `ReasoningPart`, `TodoToolPart`, `ExitPlanModePart`, `GroupedToolPart`).
- [x] 7.6 Continue filtering out `step-start` parts.

## 8. Wiring & cleanup

- [x] 8.1 Delete `apps/web/components/parts/tool-call-part.tsx` once `generic-tool-part.tsx` lands.
- [x] 8.2 Verify `todo-write-part.tsx` and `exit-plan-mode-part.tsx` visual weight aligns with new look; small style tweaks only.
- [x] 8.3 Confirm `chat-container.tsx` does not need any client-side timestamp shim — all timing comes from the server now.

## 9. Validation

- [x] 9.1 `pnpm build && pnpm typecheck && pnpm lint` from repo root.
- [x] 9.2 `pnpm --filter @repo/shared test` (or whichever runner is configured) to exercise accumulator + normalization tests.
- [ ] 9.3 Manual: open a settled long Claude turn (many reads + bash + edits) and verify "Worked for {duration}" header collapses correctly; expand restores all parts in order; reasoning shows "Thought for Xs".
- [ ] 9.4 Manual: open a Codex turn — verify `exec` parts render as bash rows and `patch` parts render as edit rows with the provided diff; confirm a `patch` with multiple changes fans out into multiple rows.
- [ ] 9.5 Manual: start a fresh turn — verify live duration ticking on the streaming "Worked for" header and on in-flight reasoning ("Thinking…"); after settle, header switches to fixed value.
- [ ] 9.6 Manual: trigger an interrupt mid-turn — verify message stays expanded with "Interrupted"; tool parts show `endedAt` set so durations are finite.
- [ ] 9.7 Manual: load an old session with messages persisted before this change — verify they render with "Worked" / "Thought" fallback labels and no errors.
- [ ] 9.8 Use `/screenshot` skill against a localhost session URL to capture before/after.
