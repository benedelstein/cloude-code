## Why

Assistant transcript text currently renders as plain strings in the iOS chat, so streamed markdown such as headings, emphasis, links, lists, and fenced code blocks appears literally instead of as structured response content. This is most visible for code fences, which need their own readable container and copy affordance instead of being folded into plain text.

## What Changes

- Add markdown-aware transcript text rendering for assistant text parts in the iOS app.
- Replace plain string chunks with structured markdown text parts that can represent rich text and fenced code blocks.
- Preserve incremental streaming behavior by accumulating raw markdown source, reusing finalized stable parts, and reparsing only the active markdown tail.
- Extract fenced code blocks into single structured parts with language metadata and completion state.
- Render code blocks with a dedicated transcript code container and copy action, visually aligned with existing tool detail code previews.
- Add focused unit tests for markdown chunking, streaming boundaries, code fences, and unterminated intermediate states.

## Capabilities

### New Capabilities
- `ios-markdown-transcript-rendering`: Structured markdown rendering for iOS assistant transcript text, including streaming rich text parts and fenced code block parts.

### Modified Capabilities

## Impact

- Affects `apps/ios/CloudeCode/Features/AgentSession/TranscriptRendering/` render item modeling, text render caching, and transcript text views.
- Affects assistant message detail/copy behavior only insofar as raw full text must remain available alongside rendered parts.
- Reuses existing iOS styling tokens and the existing code-preview visual pattern from the agent session tool detail sheet.
- No server API, persistence schema, generated API type, or backend changes are expected.
