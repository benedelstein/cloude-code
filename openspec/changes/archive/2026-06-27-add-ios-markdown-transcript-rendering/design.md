## Context

The iOS agent session currently builds `AgentSessionRenderItem` values from transcript message parts, then runs assistant text through `ChunkedTextRenderCache` before SwiftUI receives display data. That placement is important: render-derived data is computed in the view model/projection layer, avoiding SwiftUI `onChange` state mutation that previously caused layout jitter.

The current cache only produces plain string chunks. `AgentSessionRenderItemView` renders those chunks with `Text(verbatim:)`, so markdown from the agent appears literally. `MarkdownText` exists, but it only parses inline markdown and is used in the detail sheet, not transcript rows. Existing `CodePreview` and `FilePreview` views provide the visual precedent for code containers with copy controls.

Streaming creates the core constraint. Markdown meaning can change when later characters arrive, such as `**bo` becoming `**bold**` or an opening fenced code block later receiving its closing fence. Therefore the cache cannot safely append a newly parsed `AttributedString` delta to an existing attributed string for the active markdown region.

## Goals / Non-Goals

**Goals:**

- Render assistant transcript markdown as it streams, including inline emphasis, links, headings, lists, and fenced code blocks.
- Keep markdown render derivation outside SwiftUI views so transcript layout receives pure render data.
- Preserve stable finalized parts and only reparse the active markdown tail on incremental updates.
- Extract each fenced code block into one structured part with language metadata and completion state.
- Render code blocks with a transcript code container and copy button using existing styling patterns.
- Keep full raw text available for copy/detail behavior.
- Add deterministic unit tests for parser/cache behavior, especially streaming and unterminated code fence states.

**Non-Goals:**

- Server, socket, persistence, generated API type, or message schema changes.
- Syntax highlighting beyond language capture for future use.
- Full row virtualization or height caching for every markdown part.
- A complete custom CommonMark implementation beyond the subset needed to identify stable render parts and delegate rich text parsing to Foundation.
- Replacing the existing tool detail sheet views beyond extracting reusable code-preview pieces if useful.

## Decisions

### Use structured markdown text parts instead of plain string chunks

Assistant text render items should carry raw text plus ordered render parts, such as rich text parts and code block parts. Rich text parts can carry their source slice and parsed `AttributedString`; code block parts carry source code text, optional language, and `isComplete`.

Alternative considered: keep `[ChunkedTextChunk]` and parse each chunk in the view. That loses code-block structure, keeps parsing in SwiftUI body work, and cannot provide a dedicated copyable code block UI.

### Accumulate raw markdown source and reparse only the active tail

The cache should continue to track append-only updates per text item key. It should retain finalized parts and the UTF-16 start offset of the active tail. On every update it returns `finalizedParts + activePart`, where the active part is rebuilt from its raw source slice.

Appending parsed attributed deltas is not correct because incomplete markdown constructs can change earlier characters in the same active region once later text arrives. The active tail is the bounded region where that reinterpretation is still possible.

Alternative considered: parse the whole message on every stream tick. That is simpler but risks reintroducing long-text work on every update. It can remain a fallback for small text or reset cases, but the target cache should bound repeated parsing to the active tail.

### Use a conservative markdown boundary state machine

The boundary scanner should not try to implement markdown with broad regular expressions. It should explicitly track block-level code fences and conservatively decide when normal text can be finalized.

For non-code text, safe boundaries should prefer markdown block boundaries such as blank-line paragraph breaks or completed list/list-item regions, while avoiding finalization when obvious inline constructs remain open: emphasis markers, inline code spans, markdown links, autolinks, or trailing escapes. The conservative failure mode is to keep more text active and reparse it again, not to freeze text whose markdown meaning can still change.

Alternative considered: finalize using only the existing line-break and hard-length chunk boundaries. That is unsafe for markdown because a future delimiter can change how the previous chunk should render.

### Treat fenced code blocks as their own active mode

When the scanner sees a valid opening fence line, it should close any preceding active text part and switch into code-fence mode. While in code-fence mode, line-break and hard-length text chunking must not split the block. The active code block should update as text streams, report `isComplete == false` until a valid closing fence arrives, then finalize as a single complete code part.

The scanner should track the fence marker character, marker length, and language/info string. A closing fence should be accepted only on a fence line that matches the opening marker character and has at least the opening marker length.

Alternative considered: rely on `AttributedString(markdown:)` full parsing and inspect presentation intents for code blocks. That can identify complete code blocks, but it does not provide enough control over streaming intermediate state, stable part identity, or dedicated code block UI extraction.

### Keep raw text as the copy/detail source of truth

Rendered markdown parts are presentation data. The raw text stored on the render item remains the source for final response copy, detail sheets, and any fallback rendering.

Alternative considered: reconstruct copy text from rendered parts. That risks losing markdown delimiters, code fence language markers, spacing, or incomplete streaming text.

## Risks / Trade-offs

- Conservative boundaries keep larger active tails than necessary -> mitigate by measuring common transcripts and adding targeted boundary refinements only when needed.
- Foundation markdown parsing may not style all block constructs as desired in SwiftUI `Text` -> mitigate by adding small view adapters for headings/lists if attributed presentation intents are insufficient.
- Long unterminated code fences can become large single code parts -> mitigate by accepting this for correctness first and considering internal line virtualization only if profiling shows a problem.
- Markdown edge cases can freeze incorrectly if the boundary scanner is too optimistic -> mitigate with tests for incomplete emphasis, inline code, links, escapes, and code fence variants.
- Changing render item associated values touches several transcript views -> mitigate by keeping raw text and existing item keys stable, and by adapting detail/copy paths before changing visual rendering.

## Migration Plan

1. Add the new markdown part model and cache behind the existing transcript render-cache path.
2. Replace plain chunk output for assistant text with markdown part output while preserving raw text and stable text item keys.
3. Update transcript rendering to handle rich text parts and code block parts.
4. Run unit tests, SwiftLint, and the iOS Debug simulator build.
5. Roll back by restoring the previous plain chunk render cache and `ChunkedTextView` rendering path if markdown rendering causes regressions.

## Open Questions

- Whether headings and lists are acceptable when rendered directly from `AttributedString` presentation intents, or whether the transcript should map those blocks to custom SwiftUI subviews for tighter visual control.
- Whether transcript code blocks should wrap lines like the current default `CodePreview` or horizontally scroll like `FilePreview`.
