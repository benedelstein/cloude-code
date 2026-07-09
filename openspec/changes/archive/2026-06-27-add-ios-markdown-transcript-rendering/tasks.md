## 1. Render Model and Cache Foundation

- [x] 1.1 Add structured markdown render models for rich text parts and code block parts, preserving raw text on the assistant text render item.
- [x] 1.2 Replace or adapt `ChunkedTextRenderCache` so assistant `.text` items become markdown-aware render items before SwiftUI receives display data.
- [x] 1.3 Add cache state for finalized parts, active tail UTF-16 range, next part id, and current scanner mode.
- [x] 1.4 Add rich text parsing for active/finalized prose slices using `AttributedString(markdown:)` with a plain-text fallback.

## 2. Streaming Markdown Scanner

- [x] 2.1 Implement append-only raw source accumulation per text item key, including full reset when text shrinks or no longer matches the cached prefix.
- [x] 2.2 Implement conservative normal-text safe-boundary detection for markdown block boundaries and obvious unclosed inline constructs.
- [x] 2.3 Implement fenced code block detection with marker character, marker length, optional language/info string, body extraction, and matching closing fence handling.
- [x] 2.4 Ensure active rich text tails and active code block parts update on every stream tick while finalized parts keep stable ids.
- [x] 2.5 Ensure fenced code blocks bypass normal prose line-break and hard-length chunk splitting.

## 3. Transcript Rendering Integration

- [x] 3.1 Update `AgentSessionRenderItemView` to render markdown rich text parts and code block parts in source order.
- [x] 3.2 Add a transcript code block view with themed background, monospaced code text, and a copy button that copies only the code block body.
- [x] 3.3 Reuse or extract shared code-preview styling from the tool detail sheet where it fits transcript layout constraints.
- [x] 3.4 Preserve final response copy and text detail behavior by continuing to use the render item's raw markdown text.
- [x] 3.5 Keep reasoning and tool action render paths unchanged except for any compile-required enum exhaustiveness updates.

## 4. Unit Tests

- [x] 4.1 Update existing chunk/cache tests to assert markdown part output instead of plain string chunks.
- [x] 4.2 Add streaming tests for markdown split across updates, including bold, italic, inline code, markdown links, autolinks, and trailing escapes.
- [x] 4.3 Add code fence tests for complete fences, delayed closing fences, unterminated fences, language capture, long multi-line bodies, and text after a closing fence.
- [x] 4.4 Add tests that finalized part ids remain stable while active tail ids update predictably during streaming.
- [x] 4.5 Add reset tests for text shrink, changed prefix, and multiple independent text item keys.

## 5. Validation

- [x] 5.1 Run `swiftlint lint --strict --no-cache` from `apps/ios` and fix reported issues.
- [x] 5.2 Run `xcodebuild -project CloudeCode.xcodeproj -scheme CloudeCode -configuration Debug -destination 'generic/platform=iOS Simulator' -derivedDataPath .build/DerivedData CODE_SIGNING_ALLOWED=NO build` from `apps/ios`.
- [x] 5.3 Manually verify transcript rendering for prose markdown, lists/headings, complete code fences, and an in-progress streamed code fence.
