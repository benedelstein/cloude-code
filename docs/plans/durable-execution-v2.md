# Plan: Durable Execution v2

## Context

The agent process running on the sprite needs to be able to run for minutes, possibly hours at a time without failing.
The current cloudflare workflow-based setup was meant to enable this, since workflows are designed for long-runnning tasks, whereas Durable Objects are designed to spin down quickly on inactivity or on code push. They are not guaranteed to be a durable execution environment.

The problem is that workflows have subrequest limits (1,000 per step by default), which we ran into when running long-running agent turns. This becomes especially apparent when agents stream word-level text-delta chunks. Each chunk is a RPC request back to the DO, which can quickly add up.

## Potential Solutions

### Raise the subrequest limit

This is the simplest solution

```jsonc
{
  "limits": {
    "subrequests": 10000 // raise to 10,000 requests or more. maximum is 1 million
  }
}
```

However, 1 million RPC requests is still a lot. We may be able to improve this by batching chunks.

### Chunk batching

This would keep the workflow setup, but batch chunks using some debouncing logic on the workflow before forwarding them to the DO.  This could massively reduce the number of RPC requests.

Benefits:

- Minimal code changes, only need new buffering logic and batch chunk handling.

Problems with this approach:

- It reduces the real-time nature of the agent experience. Clients would not see chunks come in as smoothly.
- We may miss pending chunks if the workflow step restarts. the chunks would be buffered in memory, but if the workflow restarts those chunks would be lost (? need to double check the runtime characteristics of workflows)

We currently do not try to re-attach to existing agent processes, but we could theoretically set it up to just reattach to the existing process if we have to recover from a failure. 

### Remove the workflow, use runFiber or keepAlive

keepAlive is a new Agents SDK method that prevent eviction during active work by using a timer to extend the lifecyle every 30 seconds.
This reduces the chance that the DO gets evicted, but does not eliminate it.
runFiber is a wrapper around that method that also durably records tasks and their progress to make it easier to recover from failures.

We could run the agent turn inside a `keepAlive` call and just await the result.

Problems:

- This does not guarantee that the agent stays in memory for the duration of the turn. If the DO restarts for whatever reason (code push) then we still lose connection.
- The recovery features of runFiber aren't useful to us here, because there is no real way to "retry" the turn. Once it has been sent to the sprite, it runs on its own, and we can only reconnect to the process.

The real problem with all cloudflare-runtime-and-websocket-based solutions is that if the DO/workflow restarts, we lose connection and miss chunks from the sprite.
The sprite is the source of truth — it stores conversation history on its local filesystem - and there is no easy way to recover the missing chunks on reconnect, as they are stored in a provider-specific format. I do not believe ai-sdk gives any reliable way to "replay" chunks from an existing session. [double check this]

Cloudflare docs on the topic of long-running agents: [https://developers.cloudflare.com/agents/concepts/long-running-agents](https://developers.cloudflare.com/agents/concepts/long-running-agents)

### Use the sprite as the durable execution environment

Sprites also sleep on inactivity, but have more stable control over their lifecycle. And the sprite itself is the source of execution truth after all, so removing the intermediate step would simplify the architecture.

We would update the vm-agent script to post webhooks for chunks directly to the DO. This would complicate the vm-agent a bit - it currently just works directly with stdin and stdout. When the script is started, we would pass in the DO's webhook URL with some token for authentication (similar to the git proxy). The agent would also need to manage its own lifecycle. Currently, sprite process lifetimes are based on their websocket connections — after the websocket disconnects, the process dies within a few seconds (`maxRunAfterDisconnect`). 

The agent process would have to manage its own lifecycle - setting up a timer to kill itself after N seconds with no ongoing turn. This is possible.

Would probably still need to batch chunks, because now we are sending requests directly over public HTTP, which adds latency and bandwidth. We currently connect to the sprite process via websocket, which is more efficient than pure http webhooks (? is this true?)

Benefits:

- Removes the need for the workflow step - added complexity.
- Reduces the number of network hops from 2 to 1. (sprite -> DO)

Problems:

- Added latency and bandwidth overhead from direct HTTP requests to the DO.
- Still requires chunk batching to reduce the number of requests.

## Architecture

We adopt the **sprite-as-durable-execution** approach. The sprite becomes the source of truth for an in-flight turn. The vm-agent process owns the connection to the LLM provider, buffers chunks, and pushes them to the DO via HTTPS webhook. The Workflow and the `SessionTurnWorkflow` / `AgentProcessRunner` path go away. The DO stops holding any connection open for the duration of a turn — it is purely an inbox that wakes on each webhook to persist and broadcast.

This survives CF-side code pushes (the sprite is not affected), eliminates the subrequest-limit problem (each webhook is a fresh Worker invocation with its own budget), and removes the 30-minute step timeout entirely.

### Components

#### vm-agent: harness refactor (required)

The current `runAgentHarness` hardcodes stdin as the input source and stdout via `emit` as the output sink, and owns its own `while (true)` loop. To compose it with webhook delivery and lifecycle hooks, we refactor it so these edges are injected by the caller.

The internal message queue stays as-is: a simple single-consumer queue with at most one waiter. The harness runs one turn at a time; messages that arrive during an in-flight turn sit in a FIFO buffer and are drained after the current turn finishes. The existing queue uses an internal `pendingMessages: AgentInputMessage[]` array plus a `messageResolver` promise that the loop awaits; `queueMessage` either hands a message directly to a waiting resolver or appends to the array. This behavior stays — we just surface `queueMessage` (and a `cancel()` that triggers the same `AbortController.abort()` the stdin cancel path does today) on a returned handle instead of hiding them in a closure.

Changes:

- Accept an `emit: (output: AgentOutput) => void` callback instead of writing directly to stdout.
- Return a handle `{ queueMessage, cancel, shutdown }` instead of reading stdin itself.
- Expose lifecycle hooks `onTurnStart(message)` and `onTurnEnd(result)` so the runner can manage idle timers without inferring state from chunks.
- `shutdown()` cleanly exits the turn loop: flag set, current turn allowed to finish (or cancelled first if caller wants), the loop returns on next iteration instead of awaiting another message.

Provider setup, `streamText` invocation, abort handling, heartbeat emission — all of that stays unchanged. Only the edges (input/output/lifecycle) are injected.

#### vm-agent: WebhookAgentRunner (new)

A wrapper around the refactored harness. Responsibilities:

- Drives the harness's input source. stdin remains the transport for user messages: the DO writes the prompt through a short-lived sprite exec session. The common case is that the initial user message is written immediately at process spawn (the prompt pipes into stdin while the process is still starting up); the stdin listener handles that message exactly like any subsequent one. Follow-up turns in the same process come in via the same stdin path. The runner converts stdin lines into `harness.queueMessage(...)` / `harness.cancel()` calls.
- Provides the harness's `emit` callback. Stream chunks go through `ChunkBatcher` → `/chunks` webhook. All other events (`sessionId`, `error`, `ready`, `heartbeat`, `debug`, and the derived `turn-complete` / `turn-error` signals from lifecycle hooks) go through a single `/events` webhook, one event per POST. There is no stdout/websocket fallback — the DO only listens on the webhook routes.
- Manages process lifecycle via `onTurnEnd`: starts an idle timer. If a new message arrives before the timer expires, cancels it. If the timer fires, flushes any pending batch and exits cleanly.
- Handles cancellation (SIGINT from the DO's existing sprite-api-based cancel path, or a `cancel` stdin line): calls `harness.cancel()`, waits for the in-flight turn to drain, flushes pending chunks, posts a cancellation event to `/events`, exits.

Configuration (passed via env vars at process start):

- `DO_WEBHOOK_URL` — base URL for the session's DO endpoints
- `DO_WEBHOOK_TOKEN` — bearer token for authenticating webhooks
- `SESSION_ID` — session identifier
- `IDLE_TIMEOUT_MS` — default 60s, overridable
- `BATCH_MAX_CHUNKS` — default 50
- `BATCH_MAX_AGE_MS` — default 100

#### vm-agent: ChunkBatcher (new, internal to WebhookAgentRunner)

Bounded-age batcher:

- On chunk arrival: push to buffer. If buffer was empty, schedule a flush at `now + BATCH_MAX_AGE_MS`.
- If buffer reaches `BATCH_MAX_CHUNKS`: flush immediately, clear the scheduled timer.
- When timer fires: flush whatever is buffered, clear timer.
- On terminal chunk (finish/abort): flush synchronously before the runner reports completion.
- Chunks carry monotonic sequence numbers.

We explicitly do *not* use debounce (reset-on-new-chunk) because a steady stream with arrival spacing under 100ms could stall for up to `BATCH_MAX_CHUNKS * spacing`. Bounded-age caps per-chunk latency at 100ms regardless of rate.

HTTP delivery:

- POST `${DO_WEBHOOK_URL}/chunks` with `{ userMessageId, chunks: [{ sequence, chunk }, ...] }`.
- Retry with exponential backoff on network error or 5xx, up to ~30s. Drop-on-failure is acceptable after that (the DO's reconcile/commit-aborted path handles missed tail chunks on next client reconnect).
- On DO unreachable (e.g. code push window), continue buffering up to a soft cap (say 500 chunks) before applying backpressure.

#### API server: webhook routes (new)

Two Hono routes that forward to the owning DO. Both require a valid bearer token matched against the session's stored secret (`Authorization: Bearer <token>`).

- `POST /internal/session/:sessionId/chunks` — batch of stream chunks: `{ userMessageId, chunks: [{ sequence, chunk }, ...] }`. Terminal chunks (`finish`, `abort`) flow through this endpoint too — they're just the last entry in the final batch.
- `POST /internal/session/:sessionId/events` — single non-stream event: `{ event: AgentEvent }`, where `AgentEvent = Exclude<AgentOutput, { type: "stream" }>`. No `userMessageId`: the events this carries (`sessionId`, `error`, `ready`, `heartbeat`, `debug`) are process-level. The DO correlates anything turn-scoped (like `error`) against its own `activeUserMessageId`.

Route handlers verify the token, look up the DO stub by sessionId, and RPC into DO methods (one RPC per webhook, not per chunk). These replace the current workflow-driven `onWorkflowChunk` / `onWorkflowTurn`* callbacks.

#### SessionAgentDO: lifecycle changes

- New methods: `handleWebhookChunks(userMessageId, chunks)` and `handleWebhookEvent(event: AgentEvent)`. The event handler dispatches on the `AgentEvent` discriminator to the existing `AgentWorkflowCoordinator` internals (`handleAgentSessionId`, `handleAgentError`, etc.). Turn completion is detected inside `handleWebhookChunks` when a terminal chunk is present in the batch — same logic as today's `AgentProcessRunner`. Only the inbound edge changes, not the accumulation / broadcast / WAL logic.
- `SessionChatDispatchService` no longer starts a workflow. It delegates to a new `SpriteAgentProcessManager` (below) that ensures the process is up and forwards the user message to it.
- A per-session webhook token is generated on first sprite spawn, stored in `SecretRepository`, and passed to the vm-agent process via env var.

#### SessionAgentDO: SpriteAgentProcessManager (new)

A DO-owned class responsible for starting and talking to the vm-agent process on the sprite. Replaces the workflow-side `AgentProcessRunner` for the purpose of process lifecycle. Does **not** maintain a long-lived websocket — chunks flow back to the DO via webhook, so the manager only needs short-lived sprite-exec interactions to start the process and write prompts.

(We had an older class called `AgentProcessManager` that lived in the DO and held websockets directly, which had lifecycle problems. This is the same idea minus the websocket.)

Responsibilities:

- **Mutex-serialized start**: concurrent `ensureRunning()` callers share one in-flight spawn. Prevents two turns arriving back-to-back from racing to spawn two processes.
- **Process presence tracking**: stores `agentProcessId` in durable `serverState`. On `ensureRunning()`, checks whether that pid is still alive via the sprites API. If alive, returns. If not, spawns fresh.
- **Fresh-per-turn for v1**: every turn spawns a new process. Previously-spawned processes are abandoned — they'll exit on their own. We still pass the persisted provider `agentSessionId` (e.g. Claude's conversation id) as a CLI arg to the new process so the provider-side conversation continues across turns. Process reuse (avoiding cold-start overhead of a fresh vm-agent boot) is future work, but conversation continuity works in v1 via provider session resume, same as today.
- **Message delivery**: exposes `dispatchMessage(userMessageId, message, overrides)` that encodes the message + metadata into CLI args at spawn time. v1 always takes the cold path (fresh process), so the message is passed directly at `exec` time. Warm-path delivery (attaching to a running process to write a new `{ type: "chat" }` NDJSON line to stdin) is future work — the vm-agent keeps a stdin listener alive so this can be added without further process-side changes.
- **Cancellation**: exposes `cancelActiveTurn()` that attaches to the sprite process's stdin via `sprite.attachSession` and writes a `{ type: "cancel" }` NDJSON line — same pattern as the current `AgentWorkflowCoordinator.sendCancelSignal`. vm-agent's stdin listener decodes the line and calls `runner.cancel()` → `harness.cancel()` → aborts `streamText`. Abort terminal chunk flows out through the normal chunk path. We don't use SIGINT because stdin messages don't race with process startup — a cancel sent during startup sits in the stdin buffer until the listener reads it.
- **Cleanup**: on session delete, force-kills the process via `killSession` (SIGKILL, no graceful cancel needed when the session is going away).

Sketch:

```ts
// services/api-server/src/durable-objects/lib/sprite-agent-process-manager.ts

export class SpriteAgentProcessManager {
  // Holds the in-flight spawn promise, or null if no spawn is running.
  // Concurrent callers during a spawn share this promise. Cleared after
  // the spawn settles (success or failure) so the next call starts fresh.
  private startMutex: Promise<number> | null = null;

  constructor(private readonly deps: {
    env: Env;
    logger: Logger;
    getServerState: () => ServerState;
    updateServerState: (partial: Partial<ServerState>) => void;
    getWebhookToken: () => string;  // generates + persists on first call
  }) {}

  /**
   * Ensures a vm-agent process is running on the sprite and sends
   * the given user message to it. Returns the sprite process id.
   */
  async dispatchMessage(
    userMessageId: string,
    message: AgentInputMessage,
    overrides?: { model?: string; agentMode?: AgentMode },
  ): Promise<number> {
    return this.ensureRunning(userMessageId, message, overrides);
  }

  private ensureRunning(
    userMessageId: string,
    initialMessage: AgentInputMessage,
    overrides?: { model?: string; agentMode?: AgentMode },
  ): Promise<number> {
    // A spawn is already in flight — concurrent callers share it.
    if (this.startMutex) return this.startMutex;

    // Start a fresh spawn. Store the promise so any concurrent caller
    // awaits the same one. Clear it in finally so the next dispatch
    // (after this one settles) triggers a new spawn — v1 is fresh per turn.
    const spawn = (async () => {
      try {
        return await this._doEnsureRunning(userMessageId, initialMessage, overrides);
      } finally {
        this.startMutex = null;
      }
    })();
    this.startMutex = spawn;
    return spawn;
  }

  private async _doEnsureRunning(
    userMessageId: string,
    initialMessage: AgentInputMessage,
    overrides?: { model?: string; agentMode?: AgentMode },
  ): Promise<number> {
    // v1: always spawn fresh. The webhook runner's idle-timer optimization
    // is a follow-up; for the initial port we match the workflow's
    // one-process-per-turn behavior.
    const sprite = this.makeSpriteClient();
    await this.writeCredentialFiles(sprite);
    await this.writeVmAgentScript(sprite);

    // Initial message is passed as a CLI arg so the process has it at
    // startup — no post-spawn stdin write, no readiness race. v1 spawns
    // fresh per turn, so we never need to send a second message to the
    // same process.
    // Resume the provider-side conversation if we have a persisted
     // sessionId from a previous turn.
    const agentSessionId = this.deps.getServerState().agentSessionId ?? undefined;

    const session = sprite.createSession(
      "env",
      this.buildAgentCommand({
        ...overrides,
        initialMessage,
        userMessageId,
        agentSessionId,
      }),
      {
        cwd: WORKSPACE_DIR,
        env: this.buildEnvVars(),
        tty: false,
        detachable: true, // i think this runs it with tmux
        // Keep the process alive after we close our setup session — it streams
        // via webhooks, not websocket, so there's nothing to attach back to.
        maxRunAfterDisconnect: "0s", // keep the process alive indefinitely, it will close itself
      },
    );
    await session.start();
    const processId = await this.awaitSpriteProcessId(session); // wait for the process id running on the sprite to come in via websocket. then close the websocket, the process will live on without it.
    this.deps.updateServerState({ agentProcessId: processId });
    session.close();
    return processId;
  }

  /**
   * Attaches to the active vm-agent process's stdin and writes a cancel
   * NDJSON line. The vm-agent's stdin listener decodes it and calls
   * harness.cancel(), which aborts the in-flight streamText and emits an
   * abort terminal chunk via the normal chunk path — the DO sees it as
   * a `finish` with finishReason=abort in the next /chunks batch and
   * runs the existing turn-finished cleanup.
   *
   * Same shape as AgentWorkflowCoordinator.sendCancelSignal.
   */
  async cancelActiveTurn(): Promise<void> {
    const processId = this.deps.getServerState().agentProcessId;
    if (!processId) return;
    const sprite = this.makeSpriteClient();
    const session = sprite.attachSession(String(processId), { idleTimeoutMs: 5_000 });
    try {
      await session.start();
      session.write(encodeAgentInput({ type: "cancel" }) + "\n");
    } catch (error) {
      // If attach fails (process already gone, etc.), fall back to SIGKILL
      // so we at least don't leave an orphan; the DO's reconcile /
      // commit-aborted path cleans up turn state either way.
      if (!(error instanceof SpritesError && error.statusCode === 404)) {
        this.deps.logger.warn("cancel via stdin failed, falling back to kill", { error });
      }
      try { await sprite.killSession(processId, "SIGKILL"); } catch {}
    } finally {
      try { session.close(); } catch {}
    }
  }

  /** Force-kill without graceful shutdown. Used on session delete. */
  async kill(): Promise<void> { /* sprite.killSession SIGKILL + clear state */ }

  // writeCredentialFiles, writeVmAgentScript, buildAgentCommand,
  // buildEnvVars — moved from AgentProcessRunner, simplified.
}
```

Not yet in the sketch — mostly carry-over from `AgentProcessRunner`:

- **Attachment resolution**: resolve `attachmentIds` → `AgentInputAttachment[]` before spawn so they can be embedded in the initial-message CLI arg. Logic: `AgentAttachmentService.resolveAttachments` (currently used by `AgentProcessRunner.resolveAttachments`).
- **Credential snapshot loading**: `getProviderCredentialAdapter(provider, env, logger).getCredentialSnapshot(userId)` → feeds `writeCredentialFilesToSprite` and env vars. Logic: `AgentProcessRunner.loadCredentialSnapshot` + `writeCredentialFilesToSprite` + the `credentialSnapshotResult.value.envVars` merge into `buildEnvVars()`.
- **Script upload**: `sprite.writeFile(${HOME_DIR}/.cloude/agent.js, VM_AGENT_SCRIPT)`. Logic: `AgentProcessRunner.ensureVmAgentScriptWritten`. Switch the imported bundle to `vm-agent-webhook.bundle.js`.
- **Error mapping**: preserve the `Result<_, E>` shape with codes like `PROVIDER_AUTH_REQUIRED`, `ATTACHMENTS_NOT_FOUND`, `TURN_DID_NOT_START`. Logic: `AgentProcessRunnerError` + `mapProviderCredentialError` + `mapAttachmentResolutionError`. DO surfaces these to clients (e.g. `providerAuthRequired` state) same as today.
- `**session_info` wait with timeout**: 10s race against `turnStartedDeferred`. Logic: `AgentProcessRunner.waitForTurnStart` + `handleAgentServerMessage`.
- `**maxRunAfterDisconnect` fix**: the `"0s"` in the sketch above is wrong. Since we `session.close()` immediately after startup, the process would die instantly. Set to a long value (`"6h"` or similar) so the vm-agent keeps running after the session closes and can stream via webhooks. Today's value is `"5s"` which is also too short for this model.
- **Warm path** (attach to running process, write new `chat` NDJSON to stdin) — future work.

#### Turn lifecycle

1. Client sends chat message → DO `handleChatMessage`.
2. DO ensures sprite is provisioned (existing).
3. DO calls `SpriteAgentProcessManager.dispatchMessage(userMessageId, message)`. In v1 this always spawns a fresh process with the user message encoded into the spawn's CLI args, and also passes the persisted `agentSessionId` (if any) so the new process resumes the provider-side conversation. Records the sprite process id in `serverState`. Any previously-spawned vm-agent process is left orphaned — it'll die on its own.
4. DO returns. No long-lived connection, no workflow started.
5. vm-agent runs the turn. Buffers chunks. Posts batches to `/chunks`. When the provider emits its session id, vm-agent posts a `sessionId` event to `/events`; the DO persists it in `serverState.agentSessionId` so the next turn's spawn can resume the conversation.
6. On turn completion (terminal `finish` or `abort` chunk): flushes final batch to `/chunks`. The terminal chunk itself signals turn completion to the DO.
7. DO receives webhooks as they arrive, each in its own Worker invocation.
8. After the terminal chunk, the vm-agent process exits. The idle-timer / process-reuse path described in `WebhookAgentRunner` is future work — in v1 the process dies after each turn and the next turn spawns a new one. `WebhookAgentRunner` is still written to support reuse so the switch is a later configuration flip, not a refactor.

#### Cancellation

Same pattern as the existing `AgentWorkflowCoordinator.sendCancelSignal`: attach to the sprite process's stdin and write a `cancel` NDJSON line.

End-to-end flow:

1. Client sends `operation.cancel` → DO `cancelActiveWorkflowTurn` → `SpriteAgentProcessManager.cancelActiveTurn()`.
2. DO opens a short-lived sprite `attachSession(agentProcessId)`, writes `encodeAgentInput({ type: "cancel" }) + "\n"`, closes the session.
3. vm-agent's stdin listener decodes the line and calls `runner.cancel()` → `harness.cancel()` → aborts the in-flight `streamText` via the existing `AbortController`.
4. The harness emits the abort terminal chunk (`{ type: "finish", finishReason: "abort" }`) as its last stream output.
5. Runner flushes the pending batch (including the terminal chunk) to `/chunks`, then exits.
6. DO's existing `handleTurnFinished` path fires on receipt of the terminal chunk.

Using stdin rather than SIGINT means a cancel sent during vm-agent startup sits in the stdin buffer until the listener is installed — no startup race, cancel is never lost.

The vm-agent keeps its stdin listener alive for the full process lifetime. In v1 it only handles `cancel`, but leaving it in place means warm-path message delivery (sending a new `chat` message to an already-running process) can be added later without process-side changes.

If the stdin attach fails (process already gone, network error), fall back to `killSession` with SIGKILL so we don't leave an orphan. The DO's existing reconcile / commit-aborted path cleans up turn state in either case.

#### Auth

Per-session bearer token:

- Generated by the DO on sprite spawn (crypto-random, 32 bytes).
- Stored in DO's `SecretRepository`.
- Passed to vm-agent process as `DO_WEBHOOK_TOKEN` env var.
- Webhook routes compare via constant-time compare against the DO's stored token.

HMAC is overkill here — HTTPS protects the token in transit, and token rotation happens naturally on each sprite restart.

### Code sketches

Rough shape of the key pieces. Not final — details (types, imports, error handling) will shake out during implementation.

```ts
// packages/vm-agent/src/agent-harness.ts — refactored

export interface AgentHarnessOptions<S extends AgentSettings> {
  config: AgentProviderConfig<S>;
  settings: S;
  emit: (output: AgentOutput) => void;
  onTurnStart?: (message: AgentInputMessage) => void;
  onTurnEnd?: (result: { finishReason?: string; aborted: boolean }) => void;
  args?: { sessionId?: string };
  initialAgentMode?: AgentMode;
}

export interface AgentHarnessHandle {
  queueMessage(
    message: AgentInputMessage,
    overrides?: { model?: string; agentMode?: AgentMode },
  ): void;
  cancel(): void;
  shutdown(): Promise<void>;
}

export function startAgentHarness<S extends AgentSettings>(
  opts: AgentHarnessOptions<S>,
): AgentHarnessHandle {
  // existing streamText loop + pendingMessages queue + messageResolver +
  // currentAbortController live here. emit/queueMessage/cancel are wired
  // to opts / the returned handle instead of stdin/stdout.
  // onTurnStart fires before processMessage; onTurnEnd fires in its finally.
}
```

```ts
// packages/vm-agent/src/webhook-agent-runner.ts — new

export interface WebhookAgentRunnerOptions<S extends AgentSettings> {
  config: AgentProviderConfig<S>;
  settings: S;
  webhookUrl: string;
  webhookToken: string;
  idleTimeoutMs?: number;   // default 60_000
  batchMaxChunks?: number;  // default 50
  batchMaxAgeMs?: number;   // default 100
}

export class WebhookAgentRunner<S extends AgentSettings> {
  private readonly harness: AgentHarnessHandle;
  private readonly batcher: ChunkBatcher;
  private readonly http: WebhookClient;
  private idleTimer: NodeJS.Timeout | null = null;
  private activeUserMessageId: string | null = null;

  constructor(private readonly opts: WebhookAgentRunnerOptions<S>) {
    this.http = new WebhookClient(opts.webhookUrl, opts.webhookToken);

    this.batcher = new ChunkBatcher({
      maxChunks: opts.batchMaxChunks ?? 50,
      maxAgeMs: opts.batchMaxAgeMs ?? 100,
      flush: (batch) => this.http.post("/chunks", {
        userMessageId: this.activeUserMessageId,
        chunks: batch,
      }),
    });

    this.harness = startAgentHarness({
      config: opts.config,
      settings: opts.settings,
      emit: (output) => this.handleEmit(output),
      onTurnStart: () => this.cancelIdleTimer(),
      onTurnEnd: (result) => this.onTurnEnd(result),
    });
  }

  queueMessage(userMessageId: string, message: AgentInputMessage, overrides?): void {
    this.cancelIdleTimer();
    this.activeUserMessageId = userMessageId;
    this.harness.queueMessage(message, overrides);
  }

  cancel(): void {
    this.harness.cancel();
  }

  private handleEmit(output: AgentOutput): void {
    if (output.type === "stream") {
      this.batcher.add(output.chunk);
      return;
    }
    // Everything else is forwarded as-is to /events. These are process-level
    // events (sessionId, error, ready, heartbeat, debug) — not turn-scoped.
    this.http.post("/events", { event: output satisfies AgentEvent });
  }

  private async onTurnEnd(_result): Promise<void> {
    // Internal only. Turn end is signaled to the DO via the terminal
    // stream chunk (finish/abort) inside the last chunk batch — same as today.
    await this.batcher.flushNow();
    this.activeUserMessageId = null;
    this.startIdleTimer();
  }

  private startIdleTimer(): void {
    this.idleTimer = setTimeout(
      () => this.shutdown(),
      this.opts.idleTimeoutMs ?? 60_000,
    );
  }

  private cancelIdleTimer(): void {
    if (this.idleTimer) { clearTimeout(this.idleTimer); this.idleTimer = null; }
  }

  private async shutdown(): Promise<void> {
    await this.batcher.flushNow();
    await this.harness.shutdown();
    process.exit(0);
  }
}
```

```ts
// packages/vm-agent/src/chunk-batcher.ts — new

interface ChunkBatcherOptions {
  maxChunks: number;
  maxAgeMs: number;
  flush: (batch: Array<{ sequence: number; chunk: UIMessageChunk }>) => Promise<void>;
}

export class ChunkBatcher {
  private buffer: Array<{ sequence: number; chunk: UIMessageChunk }> = [];
  private timer: NodeJS.Timeout | null = null;
  private sequence = 0;
  // in-flight flushes serialized to preserve order
  private flushChain: Promise<void> = Promise.resolve();

  constructor(private readonly opts: ChunkBatcherOptions) {}

  add(chunk: UIMessageChunk): void {
    this.buffer.push({ sequence: this.sequence++, chunk });

    if (isTerminalChunk(chunk) || this.buffer.length >= this.opts.maxChunks) {
      this.flushNow();
      return;
    }

    if (!this.timer) {
      // bounded-age: timer starts when first chunk enters empty buffer,
      // NOT reset on subsequent arrivals
      this.timer = setTimeout(() => this.flushNow(), this.opts.maxAgeMs);
    }
  }

  flushNow(): Promise<void> {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    if (this.buffer.length === 0) return this.flushChain;
    const batch = this.buffer;
    this.buffer = [];
    this.flushChain = this.flushChain
      .catch(() => undefined)
      .then(() => this.opts.flush(batch));
    return this.flushChain;
  }
}
```

```ts
// packages/vm-agent/src/webhook-client.ts — new

export class WebhookClient {
  constructor(private baseUrl: string, private token: string) {}

  async post(path: string, body: unknown): Promise<void> {
    const url = `${this.baseUrl}${path}`;
    let attempt = 0;
    let delay = 250;
    while (true) {
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${this.token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
        });
        if (res.ok) return;
        if (res.status < 500 && res.status !== 429) return; // 4xx = don't retry
      } catch { /* network error, retry */ }
      if (attempt++ >= 6) return; // ~30s total, then drop
      await sleep(delay);
      delay = Math.min(delay * 2, 5_000);
    }
  }
}
```

```ts
// packages/vm-agent/src/main-webhook.ts — webhook-mode entrypoint

const args = parseArgs({
  options: {
    initialMessage: { type: "string" },      // JSON-encoded AgentInputMessage
    userMessageId:  { type: "string" },
    model:          { type: "string" },
    agentMode:      { type: "string" },
    sessionId:      { type: "string" },
  },
  strict: false,
}).values;

const runner = new WebhookAgentRunner({
  config: pickProviderConfig(),
  settings: parseSettingsFromArgs(),
  webhookUrl: process.env.DO_WEBHOOK_URL!,
  webhookToken: process.env.DO_WEBHOOK_TOKEN!,
  idleTimeoutMs: Number(process.env.IDLE_TIMEOUT_MS ?? 60_000),
});

// Kick off the initial turn immediately from CLI args.
runner.queueMessage(
  String(args.userMessageId),
  JSON.parse(String(args.initialMessage)) as AgentInputMessage,
  {
    model: args.model as string | undefined,
    agentMode: args.agentMode as AgentMode | undefined,
  },
);

// stdin listener for control messages. v1 only needs `cancel`, but keeping
// the listener alive means the warm-path `chat` case (sending a follow-up
// message to a running process) can be added later without process-side
// changes.
const rl = createInterface({ input: process.stdin });
rl.on("line", (rawLine) => {
  const line = rawLine.charCodeAt(0) === 0 ? rawLine.slice(1) : rawLine;
  const input = decodeAgentInput(line);
  switch (input.type) {
    case "cancel":
      runner.cancel();
      break;
    case "chat":
      // Warm-path: future work. In v1 each turn spawns a fresh process
      // with the message in argv, so this branch isn't expected to fire.
      runner.queueMessage(input.userMessageId, input.message, {
        model: input.model,
        agentMode: input.agentMode,
      });
      break;
  }
});
process.stdin.resume();
```

Not yet in the sketches:

- `AgentInput["chat"]` needs a `userMessageId` field added so the VM knows which turn each chunk belongs to. The DO already has this id when it writes to stdin.
- `AgentHarnessHandle.shutdown()` needs to break the `while (true)` loop. Easiest: a `stopped` flag checked before `waitForMessage`, plus a poison-pill resolve to unblock a waiting resolver.
- `ChunkBatcher.flushNow()` returning a serialized promise chain matters for ordering — a second batch must not start POSTing before the first finishes, or network reordering could swap them at the DO.

### Tradeoffs accepted

The webhook approach replaces one class of complexity (workflow coordination, RPC chains, subrequest budgets, step timeouts) with another (sprite-side lifecycle management, HTTP-based chunk delivery with retries, per-session auth tokens). We take that trade because:

1. It's the only option that supports hour-long turns without hitting a hard cap.
2. It's the only option that survives code pushes, since the sprite is the only non-CF-platform execution context.
3. Even on the happy path, it's architecturally simpler: fewer moving parts, fewer RPC hops, and the code matches the mental model (sprite is the process, DO is the inbox).

Notable tradeoffs:

- **Latency**: HTTPS webhook from Fly.io edge to CF DO is higher than a VM→CF websocket tunnel. Bounded-age batching (100ms) makes this invisible for streaming UX.
- **Bandwidth**: HTTP framing overhead per batch. Negligible at batch sizes of 5-50.
- **No shared connection reuse**: each webhook opens a fresh HTTP connection. With HTTP keep-alive in the vm-agent HTTP client, this is fine.
- **vm-agent complexity**: we now have batching, retries, and lifecycle logic on the VM side. Isolated in `WebhookAgentRunner`, not bleeding into `AgentHarness`.

## Testing & Validation

- **Unit tests (vm-agent)**:
  - `ChunkBatcher`: timer-based flush, buffer-full flush, terminal chunk flush, sequence monotonicity, no starvation under steady arrival.
  - `WebhookAgentRunner`: mock harness + mock HTTP client, verify chunk forwarding, idle timer cancel/fire, cancellation path.
- **Integration test (end-to-end)**:
  - Spawn a real sprite, send a prompt, verify the DO receives chunks and finishes cleanly.
  - Simulate network blip between sprite and DO: webhook retries should recover without losing chunks.
- **Manual scenarios**:
  - **Code push mid-turn**: start a long turn, deploy the Worker, confirm the turn completes successfully (the existing behavior kills the turn; this should no longer happen).
  - **Hours-long turn**: run a synthetic agent that streams for 1hr+, confirm no time-based failures.
  - **DO eviction during quiet period**: wait for idle eviction, confirm next incoming chunk webhook wakes the DO and reattaches cleanly.
  - **Concurrent user messages**: send two turns in quick succession, confirm the idle-timer-cancel path works and the second turn is served by the existing process.

## Other Considerations

- **Migration**: the workflow, `SessionTurnWorkflow`, `AgentProcessRunner` are left intact but no longer used. The workflow-specific paths in `AgentWorkflowCoordinator` get deleted. The chunk-accumulation / WAL / broadcast code is preserved and moved behind the new webhook-driven interface. Wrangler config loses the `workflows` binding. One-off: any in-flight workflows at deploy time will error out — users will see a failed turn and can retry. Acceptable for pre-GA.
- **Observability**: add dedicated loggers in `WebhookAgentRunner` for batch send latency, retry counts, and drops. Add DO-side counters for webhook arrival rate and end-to-end chunk latency (sprite-emit → DO-receive) via timestamps in the batch payload.
- **New failure mode**: sprite-side persistent DO unreachability (DO account suspended, DNS broken). We bound buffer at ~500 chunks, then drop. Consider surfacing this as a user-visible error on reconnect.
- **Security**: webhook routes must reject any request whose bearer token does not match the stored DO secret. Rate-limit by sessionId at the route layer to prevent a compromised token from being used to fire arbitrary volumes of fake chunks.
- **Out of scope**: changing the client protocol. The DO still broadcasts individual `agent.chunk` messages to connected websocket clients — webhook batching is invisible to the client.

