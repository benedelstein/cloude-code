## Context

The web client renders an `assistant` `UIMessage` as a flat list of parts: text, reasoning, todo, exit-plan, bash, and a generic `ToolCallPart` fallback that prints a bordered card with raw JSON input/output. Most tool parts coming from the agent are `exec`/MCP tool calls, so the dominant visual is "exec / Completed" cards stacked end to end. There is no notion of a turn boundary in the UI: once parts arrive they stay rendered identically forever.

Messages are produced by `streamText` in vm-agent, converted to a `UIMessageStream`, forwarded to the DO, and accumulated by `MessageAccumulator` (`packages/shared/src/utils/message-accumulator.ts`). The accumulator inserts parts when their opening chunk arrives, mutates them in place as deltas/terminal chunks land, and writes message-level `metadata` from the `finish` chunk. The DO persists the finalized message to its sqlite store.

We support two agent providers — Claude Agent SDK and Codex CLI (via `ai-sdk-provider-codex-cli`). Their tool surfaces are completely different:

- **Claude**: `Read({ file_path })`, `Edit({ file_path, old_string, new_string })`, `MultiEdit({ file_path, edits[] })`, `Write({ file_path, content })`, `Bash({ command })`, `Grep({ pattern, ... })`, `Glob({ pattern })`, `WebFetch({ url })`, `WebSearch({ query })`, `TodoWrite({ todos })`, `ExitPlanMode({ plan })`, plus MCP tools `mcp__*`.
- **Codex**: A single `exec` tool whose input is a `commandExecution` object (`type: "commandExecution"`, `command`, `cwd`, `processId`, `commandActions[]`, ...); a `patch` tool whose input is a `fileChange` object (`type: "fileChange"`, `changes[]` with `path`, `kind: { type: "update" | "add" | "delete", ... }`, and a unified `diff` string per change); an `update_plan` tool for todos. Codex has no `ExitPlanMode` — it emits the plan as a text message instead.

The accumulator already mutates parts in place — it's the natural place to attach timing and to keep raw provider shapes unchanged for storage. Normalization is the renderer's concern.

## Goals / Non-Goals

**Goals:**
- One-line, type-aware summary for each tool part with click-to-expand detail, dispatched off a single normalized `kind` taxonomy.
- Group adjacent same-`kind` tool parts into a single line ("Read 3 files", "Searched 2 patterns").
- Provider-agnostic rendering: the web client must not branch on `providerId` or on raw tool names. All provider-specific knowledge lives in one shared module.
- Inline diff for `edit`/`write` parts using a uniform diff payload regardless of provider.
- Settled assistant turns collapse work parts behind a "Worked for {duration}" toggle above the final text. Streaming turns render live.
- Reasoning parts show "Thought for {duration}" using server-stamped per-part timing.
- All timing is server-side and persisted to the message store, so historical messages keep their durations after page reload.

**Non-Goals:**
- No vm-agent changes. Raw `DynamicToolUIPart`s pass through unmodified.
- No new wire protocol. Timing is added as optional fields on existing shapes.
- No data backfill of historical messages — fields are optional and old records render with fallback labels.
- No persistence of UI expansion state across reloads.
- Not redesigning text/markdown rendering or todo/plan parts content (only outer styling).
- No virtualization / windowing.

## Decisions

### 1. Server-side timing in `MessageAccumulator`

All durations are computed from server-stamped timestamps so they survive reload.

**Message-level**: when the accumulator's first chunk arrives for an assistant message (the `start` chunk, or the first chunk if no `start`), record `startedAt = Date.now()` into `metadata.startedAt`. On `finish` / `abort` / `error` (and `forceAbort`), record `metadata.endedAt = Date.now()`. The accumulator currently overwrites `metadata` from the `finish` chunk — change it to **merge**: preserve `startedAt`, record `endedAt`, and shallow-merge with provider-supplied `messageMetadata`.

**Reasoning parts**: stamp `startedAt` on `reasoning-start`, `endedAt` on `reasoning-end` (and on `finalizePendingParts` if the reasoning was still streaming when the message terminated).

**Tool parts**: stamp `startedAt` on the earliest of `tool-input-start` / `tool-input-available`, `endedAt` on `tool-output-available` / `tool-output-error` (and on `finalizePendingParts`).

These extra fields are attached to the part objects in place. We extend our shared types to include them as optional `startedAt?: number; endedAt?: number` (epoch ms). The AI SDK's `ReasoningUIPart` and `DynamicToolUIPart` are open-ended object types in practice — we stamp via a typed cast in the accumulator and surface the fields through a shared helper:

```ts
// packages/shared/src/types/message-timing.ts
export interface PartTiming { startedAt?: number; endedAt?: number; }
export function getPartTiming(part: unknown): PartTiming { ... }
```

Alternative considered: store all timings in `message.metadata.partTimings` as a side-channel keyed by part index. Rejected because part identity is index-based and can shift if anything ever filters/reorders, and it complicates reasoning about a part standalone. In-place stamping is simpler.

Alternative considered: client-side stamping. Rejected because it loses durations for any message reloaded from storage and creates two sources of truth.

### 2. Tool normalization layer — shared module, client-invoked

**Important: normalization runs at render time on the client, not at stream time on the server.** The server (vm-agent → DO via `MessageAccumulator`) never transforms tool chunks. Chunks arrive piecewise (`tool-input-start`, `tool-input-delta`, `tool-input-available`, `tool-output-available`/`-error`); transforming them mid-stream would require buffering until input is assembled and would force the renderer to wait for `output-available` before showing anything useful (we want "Read x.ts" visible as soon as `input-available` lands). Normalization is a **pure function over an already-assembled `DynamicToolUIPart`**, called by the renderer on every render, including while the part is still in `state: "input-available"`.

The module lives in `@repo/shared` for two reasons that are not "the server transforms chunks":
1. It is provider-agnostic logic that has nothing to do with the web app's UI; keeping it in shared keeps the web layer free of provider details and gives us one place to evolve as Codex/Claude add tools.
2. Future read-side consumers (e.g. a server-rendered transcript export, search indexing, an API that returns a "summary line" per tool call) can call the same function over persisted parts. They, too, would be operating on assembled parts read back from storage — never on chunks.

The DO continues to persist `DynamicToolUIPart`s in their raw provider shape. Re-running normalization on every render is cheap (each part is a few hundred bytes; the work is a small switch + payload extraction).

**Module shape — per-provider implementations, exhaustive dispatch by `providerId`.** This mirrors the existing `services/api-server/src/lib/providers/provider-credential-adapter.ts` pattern: a common interface, one implementation file per `ProviderId`, and a single factory that switches on `providerId` with a `never` exhaustiveness check. Adding a new provider (say Gemini) means: (a) add `"gemini"` to `ProviderId` in `packages/shared/src/types/providers/`, (b) create `providers/gemini.ts` exporting an implementation, (c) add the case to the dispatch switch — TypeScript's exhaustiveness check on the existing switch refuses to compile until you do.

```
packages/shared/src/tool-normalization/
  index.ts                    // public API: ToolKind, NormalizedToolAction, ToolPartNormalizer, getToolNormalizer, normalizeToolPart
  types.ts                    // ToolKind union, payload interfaces, NormalizedToolAction, ToolPartNormalizer interface
  fallback.ts                 // generic "other" action used when a provider's normalizer can't classify a part
  providers/
    claude.ts                 // claudeToolNormalizer (Claude Agent SDK tools)
    codex.ts                  // codexToolNormalizer (exec / patch / update_plan)
  utils/
    diff.ts                   // line-diff used by Claude Edit/MultiEdit
```

The protocol every provider implements:

```ts
// types.ts
export interface ToolPartNormalizer {
  /**
   * Map an assembled DynamicToolUIPart from this provider into one or more actions.
   * MUST be pure and side-effect-free. For tool names this provider does not
   * recognize, return a single `kind: "other"` action via the shared fallback —
   * never throw.
   */
  normalize(part: DynamicToolUIPart): NormalizedToolAction[];
}
```

The dispatch — one switch in one place, with the same `never` check used elsewhere in the codebase:

```ts
// index.ts
import type { ProviderId } from "../types/providers";
import { claudeToolNormalizer } from "./providers/claude";
import { codexToolNormalizer } from "./providers/codex";

export function getToolNormalizer(providerId: ProviderId): ToolPartNormalizer {
  switch (providerId) {
    case "claude-code":  return claudeToolNormalizer;
    case "openai-codex": return codexToolNormalizer;
    default: {
      const exhaustiveCheck: never = providerId;
      throw new Error(`Unhandled provider: ${exhaustiveCheck}`);
    }
  }
}

export function normalizeToolPart(
  part: DynamicToolUIPart,
  providerId: ProviderId,
): NormalizedToolAction[] {
  return getToolNormalizer(providerId).normalize(part);
}
```

Each provider owns its own internal dispatch — typically a small map keyed by tool name plus, where helpful, an `input.type` discriminator. Unknown-to-this-provider tool names route through the shared `fallbackOtherAction` so behavior is consistent across providers. Example:

```ts
// providers/claude.ts
const handlers: Record<string, (p: DynamicToolUIPart) => NormalizedToolAction[]> = {
  Read:         (p) => [{ kind: "read",  ..., payload: { paths: [p.input.file_path] } }],
  Edit:         (p) => [{ kind: "edit",  ..., payload: { path: p.input.file_path, diff: lineDiff(p.input.old_string, p.input.new_string) } }],
  MultiEdit:    (p) => p.input.edits.map((e) => ({ kind: "edit", ..., payload: { path: p.input.file_path, diff: lineDiff(e.old_string, e.new_string) } })),
  Write:        (p) => [...],
  Bash:         (p) => [...],
  Grep:         (p) => [...],
  Glob:         (p) => [...],
  WebFetch:     (p) => [...],
  WebSearch:    (p) => [...],
  TodoWrite:    (p) => [...],
  ExitPlanMode: (p) => [...],
};

export const claudeToolNormalizer: ToolPartNormalizer = {
  normalize(part) {
    const handler = handlers[part.toolName];
    return handler ? handler(part) : [fallbackOtherAction(part)];
  },
};
```

```ts
// providers/codex.ts
export const codexToolNormalizer: ToolPartNormalizer = {
  normalize(part) {
    if (part.toolName === "exec" || part.input?.type === "commandExecution") {
      return [{ kind: "bash", ..., payload: { command: part.input.command, ... } }];
    }
    if (part.toolName === "patch" || part.input?.type === "fileChange") {
      return part.input.changes.map(changeToAction);
    }
    if (part.toolName === "update_plan") {
      return [{ kind: "todo", ..., payload: { todos: part.input.plan ?? part.input.steps } }];
    }
    return [fallbackOtherAction(part)];
  },
};
```

**Adding Gemini in the future is mechanical:**

1. Add `"gemini"` to the `ProviderId` enum in `packages/shared/src/types/providers/index.ts` (and a corresponding `providers/gemini.ts` provider definition file, alongside the existing `claude.ts` / `openai-codex.ts`).
2. Create `tool-normalization/providers/gemini.ts` exporting `geminiToolNormalizer: ToolPartNormalizer`.
3. Add one case to the switch in `tool-normalization/index.ts`. The `never` exhaustiveness check makes the typechecker fail on step 1 until step 3 lands — extending the protocol is impossible to forget.
4. Add unit tests for the new provider's tool shapes.

No edits to types, fallback, the renderer, or any other provider's module.

**Why this over a register-and-try-each registry:** the credential adapter, the provider definitions, and the agent settings discriminated union all use this pattern in this codebase. Reusing it gives compile-time enforcement (no "I forgot to register"), explicit dispatch (no order-dependent fallback), and zero side-effectful imports.

**Threading `providerId` to the renderer:** the renderer needs to know which provider produced a message. Each session has a provider, and the message accumulator already has access to it (via the DO / workflow context). We pass the session's `providerId` from `MessageList` → `MessageItem` → tool renderer dispatch as a prop. This is a cheap one-line plumbing change in the chat container.

`packages/shared/src/tool-normalization/index.ts` exports:

```ts
type ToolKind = "read" | "edit" | "write" | "bash" | "search" | "web" | "todo" | "plan" | "other";

interface FileEditAction { path: string; diff: string; }    // unified diff text
interface FileWriteAction { path: string; content?: string; isNew?: boolean; }
interface BashView      { command: string; output?: string; exitCode?: number | null; status?: string; }
interface ReadView      { paths: string[]; }              // 1+ files
interface SearchView    { patterns: string[]; }
interface WebView       { kind: "fetch" | "search"; url?: string; query?: string; }
interface TodoView      { todos: unknown }                // forwarded to existing TodoToolPart
interface PlanView      { plan: string }
interface OtherView     { toolName: string; input?: unknown; output?: unknown }

interface NormalizedToolAction {
  kind: ToolKind;
  toolName: string;     // raw tool name retained for debug/expand
  payload: FileEditAction | FileWriteAction | BashView | ReadView | SearchView | WebView | TodoView | PlanView | OtherView;
  state: "input-streaming" | "input-available" | "output-available" | "output-error";
  errorText?: string;
}

export function normalizeToolPart(part: DynamicToolUIPart): NormalizedToolAction;
```

Each provider's mapping table lives **inside its own module** (`providers/claude.ts` and `providers/codex.ts`). The current coverage:

- **Claude** (`providers/claude.ts`): `Read → read`; `Edit → edit` (locally computed line diff); `MultiEdit → edit[]` (one action per entry); `Write → write`; `Bash → bash`; `Grep`, `Glob → search`; `WebFetch → web{fetch}`; `WebSearch → web{search}`; `TodoWrite → todo`; `ExitPlanMode → plan`; everything else (e.g. `mcp__*`) → returns `null` so the registry falls back to `other`.
- **Codex** (`providers/codex.ts`): `exec` (or `input.type==="commandExecution"`) → `bash` with `command`, `aggregatedOutput`, `exitCode`, `status`; `patch` (or `input.type==="fileChange"`) → one action per `input.changes[i]` — `kind.type==="update"` → `edit` (passes `change.diff` through unchanged), `kind.type==="add"` → `write { isNew: true }`, `kind.type==="delete"` → `write { deleted: true }`; `update_plan → todo`; otherwise `null`.

`MultiEdit` and codex `patch` are the cases that produce **multiple actions from one part**. `normalizeToolPart` always returns `NormalizedToolAction[]` (length 1 in the common case); the renderer iterates.

Alternative considered: normalize at vm-agent emit time and ship normalized chunks over the wire. Rejected — it forks the AI SDK chunk shapes, complicates the streaming protocol (we'd have to define new chunk types or fold input deltas into normalized shapes), and is harder to evolve.

Alternative considered: normalize inside the accumulator on the DO at `tool-input-available` / `tool-output-available` time and persist the normalized form alongside the raw part. Rejected — it doubles storage, and the accumulator stops being the simple chunk reducer it is today. We'd also have to re-version the storage shape if normalization rules change, instead of just shipping a new web build.

Net: normalization is cheap, pure, and stateless. Compute on demand at render.

### 3. Turn boundary = the assistant message

A "turn" maps 1:1 to a single assistant `UIMessage`. Collapse at the message level. A message is "settled" when `streamingMessage?.id !== message.id`. Settled assistant messages with at least one final `text` part and at least one work part render in collapsed mode by default. Aborted messages bypass collapsing and keep work parts visible.

The header reads `Worked for {humanize(metadata.endedAt - metadata.startedAt)}` when both timestamps exist; otherwise just `Worked`.

### 4. Reasoning duration

Each reasoning part renders "Thought for {humanize(endedAt - startedAt)}" using its own per-part timing. Inside an expanded turn, reasoning parts render in their original position alongside tool parts. While streaming and incomplete (`endedAt === undefined`), render "Thinking…". When duration is missing on a settled part, render "Thought".

### 5. Tool duration (live + historical)

For streaming/in-flight tool parts, we render a small "running {Xs}" indicator next to the kind label (ticking once per second client-side, anchored to `startedAt`). For settled tool parts we do **not** show duration in the collapsed line — it's noisy. Duration appears in the expanded panel: "Took {Xms}". Open question for a follow-up.

### 6. Grouping algorithm

Single forward pass over the message's non-image, non-text parts. Adjacent parts are grouped when:
- Both are tool parts (i.e. normalized to a `kind`), AND
- Their `kind` matches, AND
- The kind is in the set of groupable kinds: `read`, `search`, `web`, `other`. (Edits, writes, bash, todo, plan are never grouped — each is meaningful standalone or already custom-rendered.)

Grouping runs **always**, including while the message is streaming. We want "Read 3 files" to appear as the third read lands, not three separate rows that suddenly collapse on settle. As new parts arrive, the trailing group's count grows in place; the row identity stays stable (keyed by the first action's `toolCallId`) so React doesn't unmount-remount.

Edge case: if a streaming tool part is still in `state: "input-streaming"`, it has no useful summary yet; we still include it in the group (`Read 3 files` rather than `Read 2 files (+1 starting)`), since the count is the user-meaningful signal. The group's expand panel renders each child action with its own state indicator.

Reasoning parts are never grouped.

### 7. Compact renderers

Each kind has a one-line renderer dispatched off `NormalizedToolAction.kind`:

- `read` → "Read {basename}" / "Read {n} files". Expand: ordered list of paths.
- `edit` → "Edited {basename}". Expand: unified diff (use `payload.diff` directly — already a diff string for both providers).
- `write` → "Wrote {basename}" (or "Created {basename}" when `isNew`, "Deleted {basename}" when codex delete). Expand: file contents (when present).
- `bash` → first line of `payload.command`, monospace, truncated, with status dot. Expand: full command, output, exit code.
- `search` → "Searched \"{pattern}\"" / "Searched {n} patterns". Expand: patterns + counts.
- `web` → "Fetched {hostname}" or "Web search \"{query}\"". Expand: response preview.
- `todo` → existing `TodoToolPart` (unchanged, restyled).
- `plan` → existing `ExitPlanModePart` (unchanged).
- `other` → "{toolName}" with raw JSON input/output expand panel.

All renderers share an `ExpandableSummaryRow` primitive: tiny icon, single-line text, optional right-aligned status, chevron, expandable detail panel.

### 8. File / module layout

- `packages/shared/src/tool-normalization/` — `index.ts` (public API + `getToolNormalizer` switch with `never` exhaustiveness check), `types.ts` (`ToolKind`, `NormalizedToolAction`, payload interfaces, `ToolPartNormalizer` interface), `fallback.ts` (`fallbackOtherAction`), `providers/{claude,codex}.ts`, `utils/diff.ts`.
- `packages/shared/src/types/message-timing.ts` — `PartTiming`, `MessageTiming` types and helpers.
- `packages/shared/src/utils/message-accumulator.ts` — stamp timestamps; merge metadata on finish.
- `apps/web/components/parts/expandable-summary.tsx` — shared row primitive.
- `apps/web/components/parts/{read,edit,write,search,web,generic-tool}-part.tsx` — compact renderers.
- `apps/web/components/parts/grouped-tool-part.tsx` — group renderer.
- `apps/web/components/parts/group-parts.ts` — pure grouping function.
- `apps/web/components/chat/message-item.tsx` — normalize → group → render dispatch; turn-collapse.
- `apps/web/lib/diff.ts` — line diff used by Claude `Edit`/`MultiEdit` normalization (not needed for Codex `patch` since diff is provided).
- `apps/web/lib/duration.ts` — `humanizeDuration`.
- `apps/web/components/parts/tool-call-part.tsx` — replaced by `generic-tool-part.tsx`.

`bash-part.tsx`, `todo-write-part.tsx`, `exit-plan-mode-part.tsx`, `text-part.tsx`, `reasoning-part.tsx` keep their content; outer styling aligned to the new compact look.

## Risks / Trade-offs

- **Adding fields to AI SDK part shapes** → Mitigation: optional fields, accessed via a shared `getPartTiming` helper, never required by SDK code. We don't replace SDK types, we extend through structural typing.
- **Accumulator behavior change for `metadata`** → Currently `metadata` is overwritten by the `finish` chunk. We must merge instead. Mitigation: dedicated helper, unit tests for merge precedence.
- **Codex tool detection drift** → Codex tool names may evolve across CLI versions. Mitigation: detect by both tool name and `input.type` discriminator (`commandExecution` / `fileChange`); fall back to `other` cleanly.
- **Codex `patch` fan-out** → A single tool part can map to many action rows, which interacts with grouping. Mitigation: the normalizer returns an array, grouping operates over the *flattened* list of normalized actions (each carries a back-pointer to the source `toolCallId` for keying).
- **Historical messages without timing** → Render "Worked" / "Thought" with no duration. Acceptable; no migration.
- **Live tool duration ticker** → A ticking client clock per in-flight tool part is cheap but easy to leak. Mitigation: single shared `useNow(1000)` hook in `apps/web/lib/use-now.ts`, used by all live indicators.
- **In-place stamping during `finalizePendingParts`** → If a message terminates mid-tool, we stamp `endedAt` even though the tool didn't truly complete. Mitigation: also persist `state: "output-error"` (already set in the abort/error path); duration becomes "ran for X then aborted". Acceptable.
- **Diff size** → Cap rendered diff at 200 lines with "show more"; raw input still available via "show JSON" affordance.

## Migration Plan

1. Land `MessageAccumulator` timing changes + extended types in `@repo/shared` first; deploy api-server. Old vm-agents continue to work; new fields just stay undefined for already-stored messages.
2. Land `tool-normalization.ts` in `@repo/shared`; no consumers yet.
3. Land web renderer changes consuming both. Ship.

Rollback: revert the web PR (renderer is independent of the shared changes). The shared changes are storage-additive and safe to leave in place.

## Open Questions

- Show live "running 12s" on in-flight tool rows in the streaming render? **Lean: yes for `bash`/`exec`, no for fast tools like `read`** — revisit during implementation.
- Should the "Worked for" header animate the duration while still streaming? **Decision: yes** — `useNow(1000)` against `startedAt`; switches to a fixed value on settle.
- Should reasoning be collapsed *inside* the expanded turn (own toggle) or always shown? **Decision: always shown when the turn is expanded** — the per-part "Thought for Xs" line is already minimal.
- Per-tool duration display surface (collapsed line vs. expand panel) is left to implementation; default to "expand panel only" to keep the line clean.
