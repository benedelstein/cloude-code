## ADDED Requirements

### Requirement: Structured markdown transcript text parts

iOS SHALL derive assistant transcript text render items from raw markdown source into ordered structured text parts. The structured parts MUST distinguish rich text markdown from fenced code blocks, and the render item MUST retain the original raw text as the source of truth for copy, details, and fallback behavior.

#### Scenario: Inline markdown renders as rich text
- **WHEN** an assistant text part contains inline markdown such as bold, italic, or links
- **THEN** iOS emits a rich text part whose rendered attributed text reflects those inline markdown attributes without exposing the markdown delimiters as literal response text

#### Scenario: Block markdown remains ordered
- **WHEN** an assistant text part contains headings, paragraphs, lists, and normal prose around each other
- **THEN** iOS emits markdown render parts in the same source order without reordering, dropping, or merging content across code block boundaries

#### Scenario: Raw text remains copy source
- **WHEN** the user copies a final assistant response or opens a transcript text item detail view
- **THEN** iOS uses the original raw markdown text rather than reconstructing text from rendered markdown parts

### Requirement: Streaming markdown tail parsing

iOS SHALL render markdown during streaming by accumulating raw markdown source, preserving finalized stable parts, and reparsing the active markdown tail on each update. iOS MUST NOT build the active markdown output by appending separately parsed attributed string deltas when an incomplete markdown construct could still change earlier characters in the active tail.

#### Scenario: Incomplete emphasis becomes formatted when closed
- **WHEN** a streamed assistant text part first contains `Hello **bo` and later appends `ld**`
- **THEN** iOS updates the active rich text part so `bold` renders with emphasis instead of preserving literal markdown delimiters from the earlier partial parse

#### Scenario: Finalized parts are reused across updates
- **WHEN** a streamed assistant text part has a stable finalized markdown section followed by an active tail
- **THEN** iOS reuses the finalized section with stable identity and only updates or replaces the active tail part for newly streamed content

#### Scenario: Unsafe inline boundary stays active
- **WHEN** the active markdown tail contains an unclosed inline code span, emphasis delimiter, markdown link, autolink, or trailing escape
- **THEN** iOS keeps that tail active and reparses it on later updates rather than finalizing it as a stable rich text part

### Requirement: Fenced code block extraction

iOS SHALL extract markdown fenced code blocks from assistant transcript text into dedicated code block parts. A code block part MUST include a stable id, code text, optional language or info string, and completion state.

#### Scenario: Complete code fence becomes one code block part
- **WHEN** an assistant text part contains a complete fenced code block with an opening fence, optional language, code body, and closing fence
- **THEN** iOS emits one code block part for the full code body with the parsed language and `isComplete` set to true

#### Scenario: Unterminated code fence streams as incomplete code block
- **WHEN** a streamed assistant text part contains an opening code fence but no matching closing fence yet
- **THEN** iOS emits one active code block part with streamed code content and `isComplete` set to false

#### Scenario: Code block is not line-chunked
- **WHEN** a fenced code block contains many lines or exceeds the normal prose chunk length
- **THEN** iOS keeps the fenced code content in one code block part rather than splitting it with normal rich-text line-break chunking

#### Scenario: Closing fence finalizes code block
- **WHEN** a later stream update adds a matching closing fence for an active code block
- **THEN** iOS updates that code block part to `isComplete` true and allows following text to render as rich text parts after the code block

### Requirement: Transcript code block presentation

iOS SHALL render transcript code block parts with a dedicated code container that visually separates code from prose and provides a copy action for the code block text.

#### Scenario: Code block has copy affordance
- **WHEN** an assistant transcript contains a code block part
- **THEN** iOS displays a copy button on the code container that copies only that code block's code text

#### Scenario: Code block uses transcript styling
- **WHEN** iOS renders a transcript code block
- **THEN** the code container uses app theme and style tokens and remains visually consistent with existing agent session tool detail code previews

### Requirement: Markdown cache unit coverage

iOS SHALL include focused unit tests for the markdown text render cache and scanner. Tests MUST cover streaming markdown, safe boundary behavior, fenced code block extraction, and reset behavior.

#### Scenario: Code fence variants are tested
- **WHEN** tests exercise fenced code blocks with language markers, missing closing fences, delayed closing fences, and long multi-line code bodies
- **THEN** the expected structured code block parts, language metadata, and completion states are asserted

#### Scenario: Streaming markdown boundaries are tested
- **WHEN** tests exercise markdown split across streaming updates, including emphasis, inline code, links, blank-line paragraph boundaries, and text shrink resets
- **THEN** the expected rich text/code block part ordering and stable finalized identities are asserted
