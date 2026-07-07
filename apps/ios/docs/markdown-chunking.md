# Markdown Chunking

How assistant transcript text becomes rendered markdown, and why it is chunked.
All code lives in `CloudeCode/Features/AgentSession/TranscriptRendering/`.

## Problem

Assistant messages stream in as a growing plain string, re-delivered as a full
snapshot on every throttle tick (~200ms). The expensive operations are
`AttributedString(markdown:)` parsing and SwiftUI `Text` layout — naively
re-parsing the whole message every tick is O(n) parse work per tick, O(n²) over
a stream, and re-laying-out one giant `Text` causes visible hitching.

The fix: split each message into **parts** and only re-parse the part that can
still change.

## Pipeline

```text
SessionMessage text part
  -> AgentSessionTranscriptBuilder            .text(TextItem)
  -> ChunkedTextRenderCache.renderItems(from:) .chunkedText(ChunkedTextItem)
  -> MarkdownTextPartsView                     one view per MarkdownTextPart
```

`AgentSessionViewModel` owns one `ChunkedTextRenderCache` and rebuilds display
data per message. Only the currently streaming message rebuilds per tick;
completed messages are computed once and cached by message id.

## Data model

- `ChunkedTextItem` — stable `key` (transcript identity), raw `text`
  (copy/detail sheet), and derived `parts`.
- `MarkdownTextPart` — either `.richText` (inline-parsed `AttributedString`
  plus its source slice) or `.codeBlock` (body text, language, completeness).

Parts stay **nested** under one item rather than being flat render items: the
part split keeps changing while streaming, so part identity is only stable
within the item. The item-level key is what transcript diffing anchors on;
flattening would leak per-tick churn into top-level row identity.

## Finalized prefix + active tail

`MarkdownTextPartCache` (one per text item) tracks a monotonically advancing
`activeStartUTF16Offset`. Everything before it is **finalized**: parsed once,
appended to `finalizedParts`, never touched again. Everything after it is the
**active tail**, re-segmented and re-parsed every tick.

A part is finalized at the earliest of these boundaries:

1. **Complete code fence** — a closed fenced block finalizes as one
   `.codeBlock` part; the prose before it splits first via rule 2/3.
2. **Blank line** — the CommonMark block boundary. A blank line closes all
   inline constructs, so text before it is safe to freeze.
3. **Hard length cap** (2,400 UTF-16 units) — for blank-line-free stretches.
   The cache looks back up to 600 units for a whitespace "soft" boundary that
   passes the safety check; if none qualifies it splits at the cap
   unconditionally. The unconditional fallback matters: it guarantees forward
   progress even when the safety heuristic misjudges (see trade-offs).

Before freezing at a blank-line or soft boundary, `MarkdownInlineState`
verifies the candidate slice has no **unclosed inline construct** — an open
`*`/`_` emphasis run, an open backtick code span, an unfinished `[link](...)`,
an open `<autolink`, or a trailing escape. Splitting mid-construct would render
the delimiter literally in one part and orphan its closer in the next. The
check is scoped to the current paragraph (text after the last blank line),
since earlier paragraphs are closed by definition.

Two deliberate non-finalizations:

- An **unclosed code fence** never finalizes — its body keeps growing and is
  re-emitted as an incomplete `.codeBlock` each tick.
- The **trailing rich-text segment** never finalizes, even at stream end,
  because trailing text may still grow. Completed messages pay one bounded
  (~2,400 unit) re-parse when their display data rebuilds, which is then
  cached.

## Fence scanning

`MarkdownFenceScanner` implements the CommonMark subset that matters here:
fences open only at a true line start (offset 0 or right after `\n`), with at
most 3 spaces of indentation, at least 3 backticks or tildes, and no backtick
in a backtick fence's info string. The closing fence must repeat the same
marker at least `markerLength` times. Scanning works on the UTF-16 view
without materializing per-line substrings.

The "true line start" rule is load-bearing: hard-cap splits can land mid-line,
and resuming a fence scan at a non-line-start would let inline ``` ``` ```
masquerade as an opening fence.

## Reset semantics

The cache assumes append-only growth. If the new text is shorter, or equal
length but different, the whole per-item cache resets (finalized parts, part
ids, offsets). Growth never triggers a prefix re-check — `shouldReset` is O(1)
on the streaming fast path.

## Rendering

Rich text parses with `interpretedSyntax: .inlineOnlyPreservingWhitespace`:
newlines and list markers stay in the text verbatim, and the result carries
`inlinePresentationIntent` runs (emphasis, code, …), not concrete fonts or
colors. `MarkdownTextPartsView` supplies the base `.font`/`.foregroundStyle`
that bold/italic/mono variants derive from. Code blocks render through the
shared `CodePreviewChrome` (copy button, haptic, toast).

## Trade-offs

Accepted deliberately; revisit only if profiling demands it.

- **Per-tick work is O(active tail), not O(delta).** Each tick rescans the
  tail from `activeStartUTF16Offset`. For prose the tail is capped, so this is
  effectively constant. While a long unclosed code fence streams, nothing
  finalizes and the rescan is O(tail) per tick — quadratic over the block, but
  at raw UTF-16-walk speed; `Text` layout of the growing block dominates it.
  Escape hatch: persist incremental scan state (last scanned line start + open
  fence) across ticks. That design existed and was removed because persistent
  scan state was where the correctness bugs lived.
- **One O(prefix) seek per tick is unavoidable at this API shape.** Each tick
  delivers a fresh `String`, and `String.Index` values are not valid across
  string instances, so offsets must be re-resolved per snapshot. Making this
  O(delta) requires the upstream to deliver appends instead of snapshots.
- **`MarkdownInlineState` approximates CommonMark emphasis rules.** It errs
  toward "unsafe" (keeps text active longer); the unconditional hard cap
  bounds the damage to delayed finalization, never a stall.
- **Whole-block code rendering.** An open code block re-lays-out as one
  `Text` per tick. Line-granular rendering would be incremental but breaks
  contiguous text selection across the block.

## Tests

`CloudeCodeTests/ChunkedTextRenderCacheTests.swift` covers boundary rules,
inline-safety cases (emphasis in code spans, unmatched `[`/`<` prose,
mid-line-split fence misreads), streaming progressions, and reset identity.
