## Purpose

Define server-side timing metadata for assistant messages, reasoning parts, and tool parts.

## Requirements

### Requirement: MessageAccumulator stamps message-level timing

`MessageAccumulator` SHALL set `metadata.startedAt = Date.now()` (epoch ms) on the first chunk processed for a message and set `metadata.endedAt = Date.now()` on `finish`, `abort`, `error`, or `forceAbort`. The `finish` chunk's `messageMetadata`, when present, MUST be shallow-merged into existing metadata; existing `startedAt` MUST be preserved across this merge. Both fields are optional in the persisted shape.

#### Scenario: Fresh message gets startedAt
- **WHEN** the accumulator processes the first chunk of a new message
- **THEN** `metadata.startedAt` is a number close to the wall clock at that moment

#### Scenario: Finish sets endedAt and preserves startedAt
- **WHEN** the accumulator processes a `finish` chunk
- **THEN** `metadata.endedAt` is set and `metadata.startedAt` retains its earlier value

#### Scenario: Provider messageMetadata merges without overwriting timing
- **WHEN** the `finish` chunk's `messageMetadata` includes unrelated fields
- **THEN** those fields are merged into `metadata` and `startedAt`/`endedAt` are not overwritten

#### Scenario: Abort sets endedAt
- **WHEN** the accumulator receives an `abort` chunk or `forceAbort()` is called mid-stream
- **THEN** `metadata.endedAt` is set and `metadata.aborted=true`

### Requirement: MessageAccumulator stamps reasoning-part timing

Each reasoning part SHALL receive `startedAt` on `reasoning-start` and `endedAt` on `reasoning-end`. Reasoning parts that are still active when the message terminates MUST receive `endedAt` during `finalizePendingParts`.

#### Scenario: Normal reasoning lifecycle
- **WHEN** a reasoning stream completes via `reasoning-start`/`reasoning-delta`*/`reasoning-end`
- **THEN** the corresponding part has both `startedAt` and `endedAt` set

#### Scenario: Reasoning interrupted by message finish
- **WHEN** a reasoning part is still streaming and the message receives `finish` (or `abort`/`error`)
- **THEN** `finalizePendingParts` sets `endedAt` on the reasoning part

### Requirement: MessageAccumulator stamps tool-part timing

Each tool part SHALL receive `startedAt` on the earlier of `tool-input-start` or `tool-input-available`, and `endedAt` on `tool-output-available` or `tool-output-error`. Tool parts that are still active when the message terminates MUST receive `endedAt` during `finalizePendingParts`.

#### Scenario: Normal tool lifecycle
- **WHEN** a tool part receives `tool-input-start` then `tool-input-available` then `tool-output-available`
- **THEN** the part has `startedAt` set at the first of those events and `endedAt` set at output

#### Scenario: Tool input arrives without input-start
- **WHEN** `tool-input-available` is the first event for a tool (no prior `tool-input-start`)
- **THEN** `startedAt` is set at that moment

#### Scenario: Tool error sets endedAt
- **WHEN** the accumulator receives `tool-output-error`
- **THEN** the part has `endedAt` set and `state="output-error"`

#### Scenario: Tool interrupted by message finish
- **WHEN** a tool part is still in flight at message terminate time
- **THEN** `finalizePendingParts` sets `endedAt` on it

### Requirement: Timing fields are optional and persisted as part of normal storage

Timing fields (`metadata.startedAt`, `metadata.endedAt`, per-part `startedAt`/`endedAt`) SHALL be optional `number` fields (epoch ms). The DO storage path MUST persist them via the existing message persistence (no new tables, no migration). Historical messages MUST remain readable without these fields and SHALL render with fallback labels in the UI.

#### Scenario: Old message round-trips without timing
- **WHEN** a message persisted before this change is read back
- **THEN** it has no timing fields and renderers render fallback labels ("Worked", "Thought") without erroring

#### Scenario: New message round-trips with timing
- **WHEN** a message produced after this change is persisted and re-read
- **THEN** the timing fields survive the round trip
