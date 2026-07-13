# Incremental Markdown Rendering

Assistant transcript text streams as a growing source string about five times per second. Rebuilding one large Markdown view on every update causes repeated parse and layout work, so the renderer keeps immutable finalized parts and reparses only an active tail.

## Pipeline

```text
SessionMessage text part
  -> AgentSessionTranscriptBuilder       .text(TextItem)
  -> MarkdownRenderCache                 .markdown(MarkdownItem)
  -> IncrementalMarkdownDocument         [MarkdownPart]
  -> MarkdownPartsView                   semantic SwiftUI views
```

`Modules/MarkdownParsing` owns syntax recognition and incremental accumulation. It depends on the pinned `swift-markdown` revision, immediately converts its AST into Foundation-based `Sendable` values, and never exposes or caches parser nodes. The app target owns SwiftUI presentation and styling.

## Render model

`MarkdownPart` is the top-level cache and render unit. Its exact `source` slices obey this invariant:

```swift
snapshot.parts.map(\.source).joined() == completeSource
```

Each part contains a recursive `MarkdownBlock` for prose, headings, ordered and unordered lists, block quotes, thematic breaks, code blocks, literal fallbacks, or source-only reference definitions. IDs are absolute UTF-16 source offsets plus a same-offset sibling ordinal, so appending later source does not renumber existing nodes.

Tables and HTML remain atomic literal parts in v1. Images render as linked alt text. Inline styles are converted from the parsed AST into `AttributedString`; plain URLs are detected only outside explicit links and inline code.

## Incremental stability

The document assumes append-only growth. Replacement, shrink, or non-prefix growth resets it. While streaming, it always holds the final AST block active. It also holds the immediate predecessor when no blank physical line separates those blocks, which covers CommonMark reinterpretations such as:

```text
para\n***  -> paragraph plus divider
para\n***x -> one paragraph
```

Consecutive stable prose is batched in groups of five paragraphs. A semantic block flushes a smaller pending prose run. Lists, quotes, code, tables, and HTML remain atomic semantic parts.

Prose alone has a 2,400 UTF-16 hard cap with a 600-unit whitespace lookback and 800-unit preferred minimum. A split within a physical line is marked `proseContinuation`; the following parse includes the original line context so inline backticks or block markers at the substring boundary are not reinterpreted as real block starts.

## Reference definitions

Reference definitions can retroactively change earlier inline links. A conservative detector switches that document to whole-document mode when it sees a definition outside fenced or indented code. Whole-document mode persists until reset, reparses the complete source on each update, and keeps absolute source IDs where possible.

## SwiftUI rendering

`MarkdownPartsView` uses a zero-spacing outer stack and lets each semantic block own its spacing. Prose renders one `Text` per paragraph. Headings use level-specific typography; lists use stable item and nested-block IDs; quotes render a themed leading rule; code reuses `CodePreviewChrome`.

Lists remain one semantic part. The view partitions list items into render-only groups of 25 so completed groups remain value-stable while a growing final group changes. Nested lists use the same grouping and no nested scroll view.

Markdown rendering deliberately has no content transitions, geometry preferences, height reporting, or Markdown-specific animation.

## Validation

Package tests cover syntax, inline attributes, source mapping, streaming stability, paragraph batching, hard caps, references, reset behavior, and character-by-character source reconstruction:

```sh
swift test --package-path Modules/MarkdownParsing
swiftlint lint --strict --no-cache
xcodebuild -project CloudeCode.xcodeproj -scheme CloudeCode -configuration Debug \
  -destination 'generic/platform=iOS Simulator' \
  -derivedDataPath .build/DerivedData CODE_SIGNING_ALLOWED=NO build
```

`CloudeCodeTests/MarkdownRenderCacheTests.swift` covers the app-level projection and per-item cache boundary.
