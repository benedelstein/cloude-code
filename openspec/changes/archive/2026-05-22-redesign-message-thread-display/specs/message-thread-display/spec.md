## ADDED Requirements

### Requirement: Settled assistant turns collapse work parts behind a "Worked for" toggle

When an assistant message is no longer streaming and contains at least one final text part and at least one non-text "work" part (tool, reasoning, todo, exit-plan), the UI SHALL render a single collapsible header above the final text labeled "Worked for {duration}" (or just "Worked" if the message has no `metadata.startedAt`/`metadata.endedAt` pair). The header MUST be collapsed by default. Expanding it MUST reveal all work parts of that turn in their original order. Collapsing it MUST hide them again. Final text and image parts MUST always remain visible regardless of toggle state.

#### Scenario: Settled turn with text and tool parts collapses by default
- **WHEN** an assistant message is no longer the streaming message and has both work parts and a final text part
- **THEN** only the final text and any image parts render, preceded by a collapsed "Worked for {duration}" toggle

#### Scenario: User expands the toggle
- **WHEN** the user clicks the "Worked for" header
- **THEN** all work parts of that message render between the header and the final text, in their original order

#### Scenario: Aborted turn keeps work visible
- **WHEN** an assistant message is settled, has work parts, and has no final text part (or is marked aborted)
- **THEN** the work parts render inline as in streaming mode and the "Interrupted" label is shown; the "Worked for" header is not rendered

#### Scenario: Turn with no work parts
- **WHEN** an assistant message contains only text parts and no work parts
- **THEN** no "Worked for" header is rendered

#### Scenario: Historical message without timing renders fallback label
- **WHEN** a settled assistant message has work parts and final text but lacks `metadata.startedAt` or `metadata.endedAt`
- **THEN** the header reads "Worked" with no duration

### Requirement: Streaming assistant turns show work parts inline

While an assistant message is the active streaming message, the UI SHALL render its parts inline in arrival order using the compact part renderers, without applying turn-level collapse. Grouping of adjacent same-kind tool parts MUST remain active so that, e.g., the third arriving `Read` part causes the existing "Read 2 files" row to update in place to "Read 3 files".

#### Scenario: Live streaming with grouping
- **WHEN** the assistant is producing parts and the message is the streaming message
- **THEN** every part renders inline as it arrives with no "Worked for" header above it, and adjacent same-kind groupable parts (read, search, web, other) collapse into a single grouped row whose count updates as new parts arrive

#### Scenario: Group row identity is stable as it grows
- **WHEN** new same-kind parts append to an existing trailing group during streaming
- **THEN** the group row updates in place (its React key does not change) rather than unmounting and remounting

#### Scenario: Transition from streaming to settled
- **WHEN** the assistant message stops being the streaming message and a final text part exists
- **THEN** the message re-renders into the collapsed "Worked for" form on the next render pass; the same grouping that was already applied during streaming continues to apply

### Requirement: Tool parts use compact, type-aware renderers dispatched off normalized kind

Each tool part SHALL be passed through the shared `normalizeToolPart` function (see capability `tool-normalization`) and rendered using a compact renderer chosen by the resulting `kind`. The web client MUST NOT branch on raw tool name or on provider id. The blocky bordered card with raw JSON input/output MUST NOT be used as the primary representation for any kind other than `other`. Renderers per kind:

- `read` → "Read {basename}" (single) or "Read {n} files" (group). Expand: list of paths.
- `edit` → "Edited {basename}". Expand: unified line diff using the normalized `payload.diff` string.
- `write` → "Wrote {basename}", "Created {basename}" when `isNew`, or "Deleted {basename}" when the normalized payload indicates deletion. Expand: file contents.
- `bash` → first line of the command in monospace, truncated. Expand: full command, output, exit code.
- `search` → "Searched \"{pattern}\"" or "Searched {n} patterns". Expand: patterns and match counts.
- `web` → "Fetched {hostname}" (kind=fetch) or "Web search \"{query}\"" (kind=search). Expand: response preview.
- `todo` → existing TodoToolPart (restyled).
- `plan` → existing ExitPlanModePart.
- `other` → tool name only with expand panel showing raw JSON input/output.

#### Scenario: Claude Read part collapsed
- **WHEN** a part with `toolName="Read"` and `input.file_path="/a/b/c.ts"` is rendered
- **THEN** the row shows "Read c.ts" with a chevron

#### Scenario: Codex exec part renders as bash row
- **WHEN** a part with `toolName="exec"` and `input.type="commandExecution"` and `input.command="git status"` is rendered
- **THEN** the row shows the command in monospace under the bash renderer

#### Scenario: Codex patch update renders as edit with diff
- **WHEN** a part with `toolName="patch"` and `input.type="fileChange"` containing `changes[0].kind.type="update"` and `changes[0].diff` is rendered
- **THEN** the row shows "Edited {basename}" and the expanded panel shows the provided diff string verbatim

#### Scenario: Claude Edit renders unified diff computed locally
- **WHEN** the user expands a part with `toolName="Edit"` and `input.old_string`/`input.new_string`
- **THEN** the panel shows a unified line diff computed from those strings, not raw JSON

#### Scenario: Codex patch with multiple changes fans out
- **WHEN** a single `patch` part has `changes` with one `update` and one `add`
- **THEN** the renderer produces two rows ("Edited X" and "Created Y") from the single tool part

#### Scenario: Unknown tool falls back to generic
- **WHEN** a tool part with an unrecognized name (e.g. `mcp__some_server__some_action`) is rendered
- **THEN** the row shows the tool name and an expand chevron whose panel reveals the input/output JSON

### Requirement: Adjacent same-kind tool parts group into one row

The renderer SHALL collapse consecutive normalized tool actions of the same `kind` into a single grouped summary row. Groupable kinds: `read`, `search`, `web`, `other`. Non-groupable kinds: `edit`, `write`, `bash`, `todo`, `plan`. Grouping MUST preserve original part order inside the expansion. Grouping operates over the flattened list of normalized actions (so a single fan-out part — e.g. a Codex `patch` with multiple changes — contributes its child actions individually).

#### Scenario: Three consecutive Reads group
- **WHEN** an assistant turn contains three adjacent `Read` parts for files `a.ts`, `b.ts`, `c.ts`
- **THEN** a single row "Read 3 files" renders, and expanding it lists the three paths in order

#### Scenario: Read followed by Bash followed by Read does not group
- **WHEN** the parts are `Read a.ts`, `Bash "ls"`, `Read b.ts`
- **THEN** three separate rows render

#### Scenario: Edits never group
- **WHEN** two adjacent `Edit` parts target two different files
- **THEN** each edit renders as its own row with its own diff

#### Scenario: Grouping is disabled while streaming
- **WHEN** the message is the active streaming message
- **THEN** every normalized action renders as its own row regardless of adjacency

### Requirement: Reasoning parts render "Thought for {duration}"

Each reasoning part SHALL render as a compact row labeled "Thought for {duration}" using its server-stamped per-part timing (see capability `message-timing`), expandable to show the reasoning text. While a reasoning part is still streaming (`endedAt` absent), the label MUST read "Thinking…". When timing is missing on a settled part, the label MUST read "Thought".

#### Scenario: Streaming reasoning
- **WHEN** a reasoning part has `startedAt` set and no `endedAt` and is part of the streaming message
- **THEN** the row shows "Thinking…"

#### Scenario: Settled reasoning with timing
- **WHEN** a reasoning part has both `startedAt` and `endedAt`
- **THEN** the row shows "Thought for {humanized duration}"

#### Scenario: Settled reasoning without timing
- **WHEN** a reasoning part has neither timing field (e.g. historical record)
- **THEN** the row shows "Thought"

### Requirement: Live duration display ticks while streaming

When a "Worked for" header is rendered for a still-streaming message (i.e. it has `startedAt` and no `endedAt`), the displayed duration SHALL update at least once per second using the wall clock against `startedAt`. Once `endedAt` is set, the duration MUST switch to the fixed `endedAt - startedAt` value.

#### Scenario: Streaming message duration ticks
- **WHEN** a streaming assistant message has `metadata.startedAt` set and no `endedAt`
- **THEN** the header duration increases at least once per second against the current wall clock

#### Scenario: Settled message duration is fixed
- **WHEN** the message has both `startedAt` and `endedAt`
- **THEN** the header displays a fixed `humanize(endedAt - startedAt)` value
