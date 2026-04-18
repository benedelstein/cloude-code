# Turn Workflow (Server Side)

How a single conversation turn is executed end-to-end across the `SessionAgentDO`, the `SessionTurnWorkflow`, and the `AgentProcessRunner`. Covers RPC surface, state machine, chunk serialization, and crash recovery.

## Components

- `**SessionAgentDO**` (`services/api-server/src/durable-objects/session-agent-do.ts`) — source of truth. Owns SQLite (`messages`, `pending_message_chunks`, `server_state`), WebSocket connections, and the public RPC surface that the workflow calls back into.
- `**AgentWorkflowCoordinator**` (`services/api-server/src/durable-objects/lib/AgentWorkflowCoordinator.ts`) — DO-side orchestration. Holds the in-memory `MessageAccumulator`, dispatches turns to the workflow, reconciles state on DO restart. The DO's workflow RPC methods delegate directly into this class.
- `**SessionTurnWorkflow**` (`services/api-server/src/workflows/SessionTurnWorkflow.ts`) — Cloudflare Agents workflow, one instance per session. Infinite loop parked on `step.waitForEvent("message_available")`. Each turn runs inside `step.do(" turn:{id}", { retries: { limit: 0 } }, ...)` so a failed turn surfaces as an explicit abort rather than a silent retry.
- `**AgentProcessRunner**` (`services/api-server/src/workflows/AgentProcessRunner.ts`) — per-turn helper created inside the workflow step. Attaches to the Sprite VM, spawns `vm-agent`, pipes the user message in via stdin, parses NDJSON out of stdout, and forwards chunks back to the DO via RPC.

## Request Diagram

```
┌──────────────────┐                                  ┌─────────────────────────┐                         ┌──────────────┐
│  SessionAgentDO  │                                  │   SessionTurnWorkflow   │                         │  Sprite VM   │
│  (SQLite + WS)   │                                  │   (AgentProcessRunner)  │                         │  (vm-agent)  │
└────────┬─────────┘                                  └────────────┬────────────┘                         └──────┬───────┘
         │                                                         │                                             │
         │  1. client WS: ChatMessageEvent                         │                                             │
         │ ─────────────────────────────────┐                      │                                             │
         │                                  │                      │                                             │
         │  2. messageRepository.create(userMessage)               │                                             │
         │     serverState.activeUserMessageId = id                │                                             │
         │                                                         │                                             │
         │  3a. NEW workflow: runWorkflow({ sessionId,             │                                             │
         │      spriteName, initialTurn }) ───────────────────────▶│                                             │
         │      (initialTurn baked into params, no event needed)   │                                             │
         │                                                         │                                             │
         │  3b. EXISTING workflow:                                 │                                             │
         │      sendWorkflowEvent("message_available", turn) ─────▶│ step.waitForEvent resolves                  │
         │                                                         │                                             │
         │                                                         │ 4. step.do("turn:{id}", retries: 0)         │
         │                                                         │                                             │
         │◀── 5. RPC: prepareWorkflowTurn(id, { model, agentMode })│                                             │
         │    returns { userId, settings, agentMode,               │                                             │
         │              agentSessionId }                           │                                             │
         │                                                         │                                             │
         │                                                         │ 6. attach Sprite, write agent.js,           │
         │                                                         │    createSession("bun run agent.js") ──────▶│
         │                                                         │    wait for session_info                    │
         │                                                         │                                             │
         │◀── 7. RPC: onWorkflowTurnStarted(id, agentProcessId) ───│                                             │
         │    serverState.activeAgentProcessId = pid               │                                             │
         │                                                         │                                             │
         │                                                         │ 8. stdin: encodeAgentInput({ type:"chat",   │
         │                                                         │    message, model?, agentMode? }) ─────────▶│
         │                                                         │                                             │
         │                                                         │ 9. stdout NDJSON (one AgentOutput/line) ◀───│
         │                                                         │    serialized via stdoutProcessingPromise   │
         │                                                         │                                             │
         │◀── 10a. RPC: onWorkflowAgentSessionId(id, sessionId) ───│ (emitted once per turn)                     │
         │                                                         │                                             │
         │◀── 10b. RPC: onWorkflowChunk(id, sequence, chunk) ──────│ (per UIMessageChunk)                        │
         │    • broadcast { type:"agent.chunk", chunk } to WS      │                                             │
         │    • pendingChunkRepository.append(chunk)   ← WAL       │                                             │
         │    • messageAccumulator.process(chunk)                  │                                             │
         │    • on finishedMessage:                                │                                             │
         │        messageRepository.create(assistantMsg)           │                                             │
         │        pendingChunkRepository.clear()                   │                                             │
         │        broadcast { type:"agent.finish", message }       │                                             │
         │                                                         │                                             │
         │          (repeat 10b until a terminal chunk)            │                                             │
         │                                                         │                                             │
         │                                                         │ 11. terminal chunk (finish|abort) ◀─────────│
         │                                                         │     turnResultDeferred.resolve()            │
         │                                                         │                                             │
         │◀── 12. RPC: onWorkflowTurnFinished(id, { finishReason })│                                             │
         │    clear activeUserMessageId / activeAgentProcessId     │                                             │
         │    status = synthesizeStatus()                          │                                             │
         │                                                         │                                             │
         │                                                         │ 13. loop → step.waitForEvent               │
```

Failure path: runner returns `failure(err)` or step throws → workflow calls `onWorkflowTurnFailed(id, err)` → `commitAbortedMessage` flushes the partial message, clears WAL, broadcasts `agent.finish` + `operation.error`.

## RPC Surface

The DO exposes these methods; `SessionTurnWorkflow` and `AgentProcessRunner` invoke them via the Agents SDK RPC binding.


| Method                                    | Caller             | Purpose                                                                                                                                                          |
| ----------------------------------------- | ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `prepareWorkflowTurn(id, overrides)`      | workflow (pre-run) | Validate session readiness, snapshot provider settings, mark turn active. Returns `Result<PreparedWorkflowTurn, WorkflowTurnFailure>`.                           |
| `onWorkflowTurnStarted(id, pid)`          | runner             | Record Sprite process id on `serverState.activeAgentProcessId`.                                                                                                  |
| `onWorkflowAgentSessionId(id, sessionId)` | runner             | Persist provider session id for resume on reconnect.                                                                                                             |
| `onWorkflowChunk(id, sequence, chunk)`    | runner             | Broadcast + WAL append + accumulate. `sequence` is emitted but currently unused server-side (ordering is guaranteed by `stdoutProcessingPromise` in the runner). |
| `onWorkflowTurnFinished(id, result)`      | workflow           | Clear active turn state after clean terminal chunk.                                                                                                              |
| `onWorkflowTurnFailed(id, error)`         | workflow           | Abort path: commit partial message, clear state, broadcast `operation.error`.                                                                                    |
| `onWorkflowComplete(name, id, result)`    | Agents SDK         | Workflow finished its run loop (unexpected — loop is infinite).                                                                                                  |
| `onWorkflowError(name, id, error)`        | Agents SDK         | Workflow itself errored; commit partial, clear `instanceId`.                                                                                                     |


All callback RPCs funnel through `isStaleRpc(id)` — RPCs for a non-active `userMessageId` are dropped.

## Turn State Machine

Tracked in `ServerState.workflowState`:

```ts
{
  instanceId: string | null,          // durable workflow instance
  activeUserMessageId: string | null, // null ⇒ idle
  activeAgentProcessId: number | null // Sprite pid
}
```


| State          | Condition                                                                                                                                                                                                                                                              |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Idle**       | `activeUserMessageId === null`. Workflow parked on `waitForEvent`. DO rejects new chat messages only if a turn is already active (same guard in `handleChatMessage` at [session-agent-do.ts:999](../services/api-server/src/durable-objects/session-agent-do.ts:999)). |
| **Dispatched** | User `UIMessage` persisted, `activeUserMessageId` set, workflow created (with `initialTurn`) or event sent.                                                                                                                                                            |
| **Started**    | `onWorkflowTurnStarted` received; Sprite pid recorded.                                                                                                                                                                                                                 |
| **Streaming**  | Chunks flowing via `onWorkflowChunk`. WAL is filling; accumulator rebuilding a `UIMessage` in memory.                                                                                                                                                                  |
| **Terminal**   | `isTerminalChunk` (`finish` | `abort`) seen → `onWorkflowTurnFinished` → state cleared.                                                                                                                                                                                |


Only one turn may be active per session. Concurrent `ChatMessageEvent`s are rejected with `CHAT_MESSAGE_FAILED` ("Agent is already handling a message"). Message queueing is not yet implemented.

## Chunk Handling & Ordering

1. `vm-agent` writes `AgentOutput` NDJSON to stdout.
2. `AgentProcessRunner.onStdout` chains handlers through `stdoutProcessingPromise` ([AgentProcessRunner.ts:213](../services/api-server/src/workflows/AgentProcessRunner.ts:213)) so that `await onChunk(...)` for chunk N completes before chunk N+1's RPC is issued. This is the real ordering guarantee — the `sequence` argument is carried but not used for reordering at the DO.
3. Each `UIMessageChunk` reaching the coordinator is processed in `handleStreamChunk` ([AgentWorkflowCoordinator.ts:686](../services/api-server/src/durable-objects/lib/AgentWorkflowCoordinator.ts:686)):
  1. Broadcast `agent.chunk` to WS subscribers (clients see chunks before durability is confirmed).
  2. `pendingChunkRepository.append(chunk)` — SQLite WAL.
  3. `messageAccumulator.process(chunk)` — derive parts, update todos/plan via `applyDerivedStateFromParts`.
  4. If accumulator emits a `finishedMessage`: persist via `messageRepository.create`, clear WAL, broadcast `agent.finish`, reset accumulator.

Terminal chunk types: `finish`, `abort` ([AgentProcessRunner.ts:167](../services/api-server/src/workflows/AgentProcessRunner.ts:167)).

## Workflow Dispatch Details

`dispatchTurn` ([AgentWorkflowCoordinator.ts:525](../services/api-server/src/durable-objects/lib/AgentWorkflowCoordinator.ts:525)) serializes create/send via `workflowDispatchPromise` so concurrent requests can't race.

- **First turn of a session**: `ensureWorkflowRunning` calls `runWorkflow(SESSION_TURN_WORKFLOW, { sessionId, spriteName, initialTurn }, { id: sessionId, agentBinding: "SESSION_AGENT" })`. The workflow picks up `initialTurn` directly from params and runs it immediately — **no separate event is sent**. This avoids a race where the event fires before the workflow is subscribed.
- **Subsequent turns**: `sendWorkflowEvent(id, { type: "message_available", payload: turn })`.
- **Send failure recovery**: if `sendWorkflowEvent` throws and the workflow status is terminal (`complete`/`errored`/`terminated`/`unknown`), `restartWorkflow` is invoked and the send is retried.
- `**already being tracked` error**: treated as a no-op — the workflow instance already exists; fall through to `sendTurnEvent`.

## Cancel Path

`cancelActiveTurn` ([AgentWorkflowCoordinator.ts:596](../services/api-server/src/durable-objects/lib/AgentWorkflowCoordinator.ts:596)):

1. **Soft cancel** — `sendCancelSignal`: attach to the Sprite exec session by pid, write `encodeAgentInput({ type: "cancel" })` to stdin, close. Lets `vm-agent` emit an `abort` chunk cleanly.
2. **Hard cancel fallback** — `stopManagedProcesses`: `WorkersSpriteClient.killSession(pid, "SIGINT")`. On 404 (session already gone), treat as success and call `commitAbortedMessage` locally.

## Crash Recovery

**WAL invariant**: a non-empty `pending_message_chunks` table implies an active turn exists. The DO's construction path and every RPC entrypoint call `ensureRehydratedState()` ([AgentWorkflowCoordinator.ts:149](../services/api-server/src/durable-objects/lib/AgentWorkflowCoordinator.ts:149)) once per lifetime:

1. Load all WAL chunks, replay through `messageAccumulator.process` — derived state (todos, plan) is re-applied.
2. If `workflowState.activeUserMessageId` is set, spawn `reconcileActiveTurn`:
  - Call `getWorkflowStatus(id)`.
  - `queued`/`running`/`waiting`/`paused`/`waitingForPause` → workflow is alive; it will drive RPCs to completion. No action.
  - `complete`/`errored`/`terminated`/`unknown` → workflow is dead. `commitAbortedMessage` (forceAbort accumulator, persist partial `UIMessage`, clear WAL, broadcast `agent.finish`), then clear active turn state.

Because the workflow's turn step is `retries: { limit: 0 }`, a crashed step never silently re-runs — it either completes via RPC or bubbles up to `onWorkflowError`, which itself calls `commitAbortedMessage` to preserve the invariant.

## Failure Modes & Where They're Handled


| Failure                                            | Where caught                                                      | Effect                                                                                               |
| -------------------------------------------------- | ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Session not initialized / not ready                | `prepareTurn`                                                     | `workflowTurnFailure("SESSION_NOT_INITIALIZED" | "SESSION_NOT_READY")` → `onWorkflowTurnFailed` path |
| Invalid model override                             | `validateAndApplyModelSwitch` in DO                               | `workflowTurnFailure("INVALID_MODEL")` returned before dispatch                                      |
| Attachment missing                                 | DO `getBoundAttachmentRecords` or runner `AgentAttachmentService` | `ATTACHMENTS_NOT_FOUND` / `ATTACHMENTS_RESOLUTION_FAILED`                                            |
| Provider auth missing / expired                    | runner `loadCredentialSnapshot`                                   | `PROVIDER_AUTH_REQUIRED` → DO sets `providerConnection.requiresReauth = true`                        |
| `vm-agent` fails to emit `session_info` within 10s | `waitForTurnStart`                                                | `TURN_DID_NOT_START`                                                                                 |
| `vm-agent` exits before terminal chunk             | runner `onExit`                                                   | `TURN_EXITED` (with exit code)                                                                       |
| Unparseable NDJSON from stdout                     | `handleAgentStdout`                                               | Logged loudly, line dropped (can desync client stream)                                               |
| Workflow `sendEvent` fails                         | `dispatchTurn`                                                    | restart workflow + retry once                                                                        |
| Workflow itself errors                             | Agents SDK → `onWorkflowError`                                    | commit partial, clear `instanceId`                                                                   |


## Related Files

- Turn types / failure codes: [services/api-server/src/workflows/types.ts](../services/api-server/src/workflows/types.ts)
- WAL table: [services/api-server/src/durable-objects/repositories/pending-chunk-repository.ts](../services/api-server/src/durable-objects/repositories/pending-chunk-repository.ts)
- Server state: [services/api-server/src/durable-objects/repositories/server-state-repository.ts](../services/api-server/src/durable-objects/repositories/server-state-repository.ts)
- Accumulator / derived state: `MessageAccumulator` in `@repo/shared`, `applyDerivedStateFromParts` in [services/api-server/src/durable-objects/session-agent-derived-state.ts](../services/api-server/src/durable-objects/session-agent-derived-state.ts)

