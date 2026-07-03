# PR #124 review findings

Code review of the streaming markdown transcript rendering (2026-07-02). All findings verified against the code. Unaddressed for now — committed to the branch as a work list.

## Correctness

1. **Block structure is flattened in rendered parts.**
   `MarkdownTextScanning.swift:13` parses rich-text parts with `interpretedSyntax: .full`, which strips newlines/list markers into `PresentationIntent` attributes, but parts render via plain `Text(part.attributedText)` (`AgentSessionRenderItemView.swift:67`), which ignores intents. A list `- one\n- two\n- three` is a single part (no blank lines), so it renders run together on one line; same for multi-paragraph text before a fence. All `renderedText` test assertions are single-line, so tests can't see it.

2. **No unconditional hard-cap fallback — the active tail can grow without bound.**
   `ChunkedTextRenderCache.swift:212`: every finalization boundary, including the hard 2400-unit cap, is gated on `canFinalizeText`; the old `hardBoundaryFallback` and its test were deleted. `hasUnclosedMarkdownLink` (any `[` with no later `]`, e.g. `the range [0, 1)`) and `hasUnclosedAutolink` (any `<` with `://` anywhere later, e.g. `a < b` … then a URL) are permanently true for ordinary prose. Once triggered, no part ever finalizes and the whole growing message is re-parsed through `AttributedString(markdown:)` on every 200ms tick.

3. **Emphasis inside code spans opens phantom delimiter state.**
   `MarkdownTextScanning.swift:288`: the state machine counts backticks but doesn't suppress `*`/`_` processing between a backtick pair. `` Pass `**kwargs` to the function `` leaves `openStrongStarCount > 0` forever; since `canFinalizeText` always rescans from the never-advancing `activeStartUTF16Offset`, finalization stalls permanently (same consequence as #2, very common trigger string).

4. **Mid-line hard-cap splits let inline backticks masquerade as opening fences.**
   `MarkdownFenceScanner.lines` (`MarkdownTextScanning.swift:151`) treats `startOffset` as a line start, but `hardLengthBoundary` (`ChunkedTextRenderCache.swift:204`) can finalize after any horizontal whitespace mid-line. In a >2400-unit blank-line-free stretch, inline ``` ``` ``` right after the split point is misread as an opening fence and swallows subsequent prose into a code block. `canFinalizeText` only inspects text before the boundary, so it can't guard this.

5. **Pre-fence span finalizes as one unbounded part.**
   `finalizeStableParts` checks for a fence before any blank-line/length boundary, and `finalizeTextBeforeFence` (`ChunkedTextRenderCache.swift:126`) emits the entire pre-fence span as a single part with no splitting or cap. On single-delivery paths (cached load, sync snapshot), 50KB of prose before a code block becomes one giant AttributedString parse and one massive Text layout — and per #1 its paragraph breaks vanish.

## Efficiency

6. **O(n²) streaming scans.**
   `ChunkedTextRenderCache.swift:70`: `text.hasPrefix(previousText)` is a full O(message) compare per throttle tick (old code: O(1) count compare). `MarkdownFenceScanner.lines` eagerly materializes a substring per line for the whole tail, called 2–4× per tick. While a long code block streams (tail unbounded — open fence blocks finalization), this is O(n²) over the stream; the deleted incremental `scannedUTF16Offset` design existed for exactly this path.

## Reuse / conventions

7. **`TranscriptCodeBlockView` duplicates `CodePreview` chrome.**
   `AgentSessionRenderItemView.swift:86` copies the copy-button ZStack and `copyText()` (pasteboard + haptic + toast) nearly verbatim from `AgentSessionToolDetailSupportViews.swift`. tasks.md item 3.3 ("Reuse or extract shared code-preview styling…") is checked off but wasn't done.

8. **Dead `maxLineBreaksPerChunk` init parameter.**
   `ChunkedTextRenderCache.swift:15` keeps the parameter and discards it via `_ = maxLineBreaksPerChunk`; no caller passes it. Delete it.

## Minor

- `MarkdownCodeBlockPart.isComplete` is written and tested but never read by any view.
- Fence-walk logic is duplicated between `finalizeStableParts` and `MarkdownActivePartBuilder`; any fence-rule change must be patched in both.
- The three new files have zero doc comments despite `apps/ios/AGENTS.md`: "Add doc comments to all public methods and class definitions."

## Suggested direction for #2–#4

The unsafe-open-construct veto is layered over every boundary with no escape hatch. Prefer: trust CommonMark's rule that a blank line closes all inline constructs (scope the safety check to the last paragraph) and always allow an unconditional hard-cap finalization — a rare cosmetic split beats unbounded reparse.
