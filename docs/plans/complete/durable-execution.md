# Durable Agent Execution

We need agent responses to survive long runtimes and sparse output, while still persisting every streamed chunk.

Currently, the `SessionAgentDO` owns the live Sprite WebSocket for the vm-agent. That works well for real-time fanout and state coordination, but it is the wrong place to own a long-running outbound socket: the DO can become inactive while a response is still running, which breaks the socket and loses chunk delivery. A user should be able to send a message and have the agent continue running even if they disconnect.

Durable Objects are still the right source of truth for:

- accepted user messages
- chunk persistence
- message accumulation and final assistant message writes
- browser WebSocket broadcast

But the long-running turn execution should move into a Cloudflare Workflow.

> Agents excel at real-time communication and state management. Workflows excel at durable execution with automatic retries, failure recovery, and waiting for external events.
> Use Agents alone for chat, messaging, and quick API calls. Use Agent + Workflow for long-running tasks (over 30 seconds), multi-step pipelines, and human approval flows.

Reference: [https://developers.cloudflare.com/agents/api-reference/run-workflows/](https://developers.cloudflare.com/agents/api-reference/run-workflows/)

## Useful Context

- We validated locally that a workflow can create a `WorkersSpriteClient`, open a Sprite exec WebSocket, and receive `session_info` / stdout / stderr messages.
- The current local test duplicated sessions because the DO still started its own vm-agent process before launching the workflow. That needs to be removed in the real implementation.
- Earlier we assumed a workflow could only be started once and not communicated with afterward. That was too narrow. A workflow instance can wait for events with `step.waitForEvent(...)`, and the DO can signal it with `sendWorkflowEvent(...)`.
- We do **not** want to keep a long-lived remote vm-agent process alive across turns in v1. It is simpler and safer to restart the vm-agent process each turn and rely on the provider `agentSessionId` for conversation continuity.

## Selected V1 Architecture

This pass is intentionally narrow. It focuses on workflow lifecycle and chunk streaming only.

- One workflow instance per session.
- The workflow waits for work between turns with `step.waitForEvent("message_available", ...)`.
- One `step.do("turn:<messageId>", ...)` executes exactly one agent turn.
- The workflow owns the Sprite WebSocket only while that turn is active.
- The DO remains the canonical owner of persisted state and client broadcast.
- Introduce a workflow-only `AgentProcessRunner` that owns per-turn provider credential refresh, credential file writes to the Sprite, attachment resolution, vm-agent launch, stdout decode, and process metadata handling.
- No queued-turn system design in this pass beyond "one active turn per session".
- Cancel should be direct DO -> Sprite control, not workflow polling.

```ts
import { AgentWorkflow } from "agents/workflows";
import type { AgentWorkflowEvent, AgentWorkflowStep } from "agents/workflows";
import { createLogger } from "@/lib/logger";
import { AgentProcessRunner } from "@/workflows/AgentProcessRunner";
import type { SessionAgentDO } from "@/durable-objects/session-agent-do";
import type { WorkflowTurnPayload } from "@/workflows/types";

type SessionWorkflowParams = {
  sessionId: string;
  spriteName: string;
  initialTurn?: WorkflowTurnPayload;
};

export class SessionTurnWorkflow extends AgentWorkflow<
  SessionAgentDO,
  SessionWorkflowParams
> {
  private readonly logger = createLogger("SessionTurnWorkflow");

  async run(
    event: AgentWorkflowEvent<SessionWorkflowParams>,
    step: AgentWorkflowStep,
  ): Promise<void> {
    const { sessionId, spriteName, initialTurn } = event.payload;
    let nextTurn = initialTurn;

    while (true) {
      const turnPayload = nextTurn ?? (await this.waitForNextTurn(step));
      nextTurn = undefined;

      await step.do(`turn:${turnPayload.messageId}`, async () => {
        await this.runTurn({
          sessionId,
          spriteName,
          turnPayload,
        });
      });
    }
  }

  private async waitForNextTurn(
    step: AgentWorkflowStep,
  ): Promise<WorkflowTurnPayload> {
    const event = await step.waitForEvent("message_available", {
      type: "message_available",
      timeout: "7 days",
    });

    return event.payload as WorkflowTurnPayload;
  }

  private async runTurn(input: {
    sessionId: string;
    spriteName: string;
    turnPayload: WorkflowTurnPayload;
  }): Promise<void> {
    const { sessionId, spriteName, turnPayload } = input;
    const { messageId, content, attachmentIds, model, agentMode } = turnPayload;

    const logger = this.logger.scope(`turn:${messageId}`);
    const preparedTurn = await this.agent.prepareWorkflowTurn(messageId, {
      model,
      agentMode,
    });
    if (!preparedTurn.ok) {
      await this.agent.onWorkflowTurnFailed(messageId, preparedTurn.error);
      return;
    }

    const turnRunner = new AgentProcessRunner({
      env: this.env,
      logger,
      spriteName,
      sessionId,
      preparedTurn: preparedTurn.value,
      onTurnStarted: async ({ spriteExecSessionId, spriteProcessId }) => {
        await this.agent.onWorkflowTurnStarted(messageId, {
          spriteExecSessionId,
          spriteProcessId,
        });
      },
      onSessionId: async (agentSessionId) => {
        await this.agent.onWorkflowSessionId(messageId, agentSessionId);
      },
      onChunk: async (sequence, chunk) => {
        await this.agent.onWorkflowChunk(messageId, sequence, chunk);
      },
    });

    const result = await turnRunner.runTurn({
      messageId,
      content,
      attachmentIds,
    });

    if (result.ok) {
      await this.agent.onWorkflowTurnFinished(messageId, result.value);
    } else {
      await this.agent.onWorkflowTurnFailed(messageId, result.error);
    }
  }
}
```

Notes about the sketch:

- `run()` is intentionally an infinite event loop for a single session workflow instance.
- The first accepted user message should be passed in `initialTurn` when the DO creates the workflow, so the workflow does not need to start and then immediately wait for an event.
- The workflow owns the live Sprite socket only inside `runTurn(...)`.
- `prepareWorkflowTurn(...)` should return turn metadata like `userId`, settings, mode, and the current provider `agentSessionId`. The runner itself should handle auth refresh and credential file writes on every turn.
- The earlier sketch called `startWorkflowTurn(...)` twice for different reasons. That was wrong. Persisting the provider `agentSessionId` must be a separate `onWorkflowSessionId(...)` callback, not an overloaded start method.
- `AgentProcessRunner` is intentionally workflow-only. The DO should not call it for active turns.

High-level sketch for `AgentProcessRunner`:

```ts
import type { UIMessageChunk } from "ai";
import { decodeAgentOutput, encodeAgentInput } from "@repo/shared";
import { WorkersSpriteClient, type SpriteWebsocketSession } from "@/lib/sprites";
import { AgentAttachmentService } from "@/durable-objects/lib/attachment-service";
import VM_AGENT_SCRIPT from "@repo/vm-agent/dist/vm-agent.bundle.js";

type PreparedWorkflowTurn = {
  userId: string;
  settings: AgentSettings;
  agentMode: AgentMode;
  agentSessionId: string | null;
};

type AgentProcessRunnerOptions = {
  env: Env;
  logger: Logger;
  spriteName: string;
  sessionId: string;
  preparedTurn: PreparedWorkflowTurn;
  onTurnStarted: (metadata: {
    spriteExecSessionId: string;
    spriteProcessId: number | null;
  }) => Promise<void>;
  onSessionId: (agentSessionId: string) => Promise<void>;
  onChunk: (sequence: number, chunk: UIMessageChunk) => Promise<void>;
};

type RunTurnInput = {
  messageId: string;
  content?: string;
  attachmentIds: string[];
};

type RunTurnResult =
  | { ok: true; value: { finishReason: string | undefined } }
  | { ok: false; error: { message: string } };

export class AgentProcessRunner {
  private readonly sprite: WorkersSpriteClient;
  private readonly attachmentService: AgentAttachmentService;
  private readonly logger: Logger;
  private readonly sessionId: string;
  private readonly preparedTurn: PreparedWorkflowTurn;
  private readonly onTurnStarted: AgentProcessRunnerOptions["onTurnStarted"];
  private readonly onSessionId: AgentProcessRunnerOptions["onSessionId"];
  private readonly onChunk: AgentProcessRunnerOptions["onChunk"];
  private agentSession: SpriteWebsocketSession | null = null;
  private stdoutBuffer = "";
  private chunkSequence = 0;
  private spriteProcessId: number | null = null;

  constructor(options: AgentProcessRunnerOptions) {
    this.logger = options.logger.scope("AgentProcessRunner");
    this.sessionId = options.sessionId;
    this.preparedTurn = options.preparedTurn;
    this.onTurnStarted = options.onTurnStarted;
    this.onSessionId = options.onSessionId;
    this.onChunk = options.onChunk;
    this.sprite = new WorkersSpriteClient(
      options.spriteName,
      options.env.SPRITES_API_KEY,
      options.env.SPRITES_API_URL,
    );
    this.attachmentService = new AgentAttachmentService(options.env, this.logger);
  }

  async runTurn(input: RunTurnInput): Promise<RunTurnResult> {
    const attachmentResult = await this.attachmentService.resolveAttachments(
      this.sessionId,
      input.attachmentIds,
    );
    if (!attachmentResult.ok) {
      return { ok: false, error: { message: attachmentResult.error.message } };
    }

    const credentialSnapshot = await this.loadCredentialSnapshot();
    if (!credentialSnapshot.ok) {
      return { ok: false, error: { message: credentialSnapshot.error.message } };
    }

    await this.writeCredentialFilesToSprite(credentialSnapshot.value);
    await this.ensureVmAgentScript();
    this.agentSession = this.createAgentSession(credentialSnapshot.value.envVars);
    this.bindSessionHandlers();
    await this.agentSession.start();

    await this.onTurnStarted({
      spriteExecSessionId: this.getSpriteExecSessionId(),
      spriteProcessId: this.spriteProcessId,
    });

    this.agentSession.write(
      encodeAgentInput({
        type: "chat",
        message: {
          content: input.content,
          attachments: attachmentResult.value.agentAttachments,
        },
      }) + "\n",
    );

    return await this.waitForTurnResult();
  }

  private async ensureVmAgentScript(): Promise<void> {
    await this.sprite.writeFile("/home/sprite/.cloude/agent.js", VM_AGENT_SCRIPT);
  }

  private async loadCredentialSnapshot(): Promise<Result<AuthCredentialSnapshot, { message: string }>> {
    const adapter = getProviderCredentialAdapter(
      this.preparedTurn.settings.provider,
      this.env,
      this.logger,
    );
    const snapshot = await adapter.getCredentialSnapshot(this.preparedTurn.userId);
    if (!snapshot.ok) {
      return { ok: false, error: { message: snapshot.error.message } };
    }
    return snapshot;
  }

  private async writeCredentialFilesToSprite(
    snapshot: AuthCredentialSnapshot,
  ): Promise<void> {
    for (const file of snapshot.files) {
      await this.sprite.writeFile(
        file.path,
        file.contents,
        file.mode ? { mode: file.mode } : undefined,
      );
    }
  }

  private createAgentSession(
    credentialEnvVars: Record<string, string>,
  ): SpriteWebsocketSession {
    const commands = [
      "bun",
      "run",
      "/home/sprite/.cloude/agent.js",
      `--provider=${JSON.stringify(this.preparedTurn.settings)}`,
      `--agentMode=${this.preparedTurn.agentMode}`,
      ...(this.preparedTurn.agentSessionId
        ? [`--sessionId=${this.preparedTurn.agentSessionId}`]
        : []),
    ];

    return this.sprite.createSession("env", commands, {
      cwd: "/home/sprite/workspace",
      tty: false,
      env: {
        SESSION_ID: this.sessionId,
        ...credentialEnvVars,
      },
    });
  }

  private bindSessionHandlers(): void {
    this.agentSession!.onStdout((data) => {
      void this.handleStdout(data);
    });

    this.agentSession!.onStderr((data) => {
      this.logger.error(`vm-agent stderr: ${data}`);
    });

    this.agentSession!.onServerMessage((message) => {
      if (message.type === "session_info") {
        this.spriteProcessId = message.session_id;
      }
    });
  }

  private async handleStdout(data: string): Promise<void> {
    this.stdoutBuffer += data;
    const lines = this.stdoutBuffer.split("\n");
    this.stdoutBuffer = lines.pop() ?? "";

    for (const line of lines) {
      if (!line.trim()) continue;

      const output = decodeAgentOutput(line);
      switch (output.type) {
        case "stream":
          await this.onChunk(this.chunkSequence++, output.chunk as UIMessageChunk);
          break;
        case "sessionId":
          await this.onSessionId(output.sessionId);
          break;
        case "error":
          throw new Error(output.error);
        case "ready":
        case "debug":
          break;
      }
    }
  }

  private async waitForTurnResult(): Promise<RunTurnResult> {
    // Sketch only:
    // wait until the vm-agent emits the terminal chunk for this turn,
    // then close the Sprite socket and return success/failure.
    return { ok: true, value: { finishReason: undefined } };
  }

  private getSpriteExecSessionId(): string {
    // Sketch only:
    // this must return the attachable Sprite exec-session ID used by cancel.
    return "sprite-exec-session-id";
  }
}
```

Notes about the runner sketch:

- It is workflow-only. The DO should never instantiate it for normal turns.
- It owns everything about one live turn: provider auth refresh, credential file writes to the Sprite, attachment resolution, vm-agent launch, stdout parsing, and Sprite session metadata capture.
- It reports only three things back to the workflow caller:
  - turn started metadata needed for cancel
  - provider `agentSessionId`
  - streamed chunks
- For reliability, credential refresh and credential file writes should happen on every turn before the vm-agent process starts. Do not rely on prior writes still being valid.
- Cancel is intentionally **not** a method on this class. The DO owns cancel initiation and talks to Sprite directly using the stored exec-session ID / process ID.

## Turn Lifecycle

### 1. Session bootstrap

- The DO provisions the Sprite and clones the repo as it already does today.
- The DO also creates a session-scoped workflow instance the first time it needs one and stores the workflow instance ID in durable state.
- The first user turn should be passed as `initialTurn` to `runWorkflow(...)` so the workflow can start work immediately.
- If the workflow later exits after a long idle timeout, the DO can recreate it on the next user message.

### 2. Accepting a user message

- The DO accepts and persists the user-visible `UIMessage` immediately.
- If no workflow instance exists yet, the DO starts one with `initialTurn`.
- If the workflow already exists, the DO sends a `message_available` event to the session workflow.
- The event payload carries the turn input:
  - `messageId`
  - `content`
  - `attachmentIds`
  - optional model override
  - optional agent mode override

The event should carry attachment IDs, not resolved attachment contents. The workflow can resolve attachments itself from the session ID.

### 3. Running one turn

Inside `step.do("turn:<messageId>", ...)`, the workflow:

- reads the event payload
- refreshes provider credentials for the configured provider
- writes provider credential files to the Sprite
- resolves attachment IDs via `AgentAttachmentService`
- starts a fresh vm-agent process on the Sprite
- passes the current persisted `agentSessionId` if present
- sends the chat input to the vm-agent
- listens on the Sprite WebSocket until the assistant turn completes

### 4. Chunk forwarding

The workflow does **not** own message accumulation or persistence.

Instead, as chunks arrive, the workflow forwards them into DO RPC methods:

- `prepareWorkflowTurn(messageId, overrides)` -> validate model/mode changes, sync provider credentials, and return launch config for this turn
- `prepareWorkflowTurn(messageId, overrides)` -> validate model/mode changes and return launch metadata for this turn
- `onWorkflowTurnStarted(messageId, metadata)` -> persist Sprite exec-session / process metadata needed for cancel and cleanup
- `onWorkflowSessionId(messageId, agentSessionId)` -> persist provider conversation continuity
- `onWorkflowChunk(messageId, sequence, chunk)`
- `onWorkflowTurnFinished(messageId, result)`
- `onWorkflowTurnFailed(messageId, reason)`

The DO keeps:

- `PendingChunkRepository`
- `MessageAccumulator`
- final message persistence
- derived-state extraction
- browser broadcast of `agent.chunk` and `agent.finish`

`onWorkflowChunk` must be idempotent by `(messageId, sequence)` so a retried or duplicated forward does not double-append.

### 5. Cancel Mechanics

Cancel should not depend on the workflow polling the DO.

- When a turn starts, the workflow must call `onWorkflowTurnStarted(...)` with:
  - the Sprite exec-session identifier used for `attachSession(...)`
  - the Sprite process ID for the vm-agent
- The attachable Sprite exec-session identifier is available from Sprite server messages; we need to capture and persist it alongside the process ID.
- On `operation.cancel`, the DO performs a one-off control action against the Sprite:
  - primary path: `attachSession(spriteExecSessionId)`, write `{"type":"cancel"}`, disconnect
  - fallback path: if attach-cancel fails or the turn does not stop within a short grace window, kill the vm-agent process by PID
- The workflow remains the owner of the main Sprite socket. It simply observes the turn ending and reports `onWorkflowTurnFinished(...)` or `onWorkflowTurnFailed(...)`.
- This avoids keeping the DO resident and avoids workflow-side polling.

### 6. Turn completion

- When the workflow sees the vm-agent finish the response, it calls `onWorkflowTurnFinished(...)`.
- The DO finalizes the assistant message exactly once and clears any in-progress chunk state.
- The workflow returns to `waitForEvent(...)` for the next turn.

## Responsibilities Split

### Workflow owns

- waiting between turns
- starting the vm-agent process for a turn
- holding the live Sprite WebSocket during that turn
- decoding vm-agent output
- forwarding chunks and terminal turn status back to the DO

### Durable Object owns

- session provisioning and repo clone
- accepted user messages
- provider-facing session state stored in DO state, including `agentSessionId`
- chunk WAL persistence
- `MessageAccumulator`
- final message persistence
- browser WebSocket fanout
- session-facing status / state

## What Changes in the Existing Design

- `SessionAgentDO` should stop owning the live vm-agent WebSocket for active turns.
- `ensureReady()` should become provisioning-only plus workflow bootstrap, not "start vm-agent now".
- Replace the DO-owned `AgentProcessManager` turn path with a workflow-owned `AgentProcessRunner`.
- Move the credential refresh and `syncAuthCredentialsToSprite(...)` responsibility out of the DO turn path and into `AgentProcessRunner`, so every turn writes fresh auth before launching the vm-agent.
- Any DO-side Sprite control that remains should be small and targeted, for example a cancel/kill helper, not a second turn runner.
- The live session-start / stdout handling path needs to move out of the DO-owned hot path and into the workflow.

## Explicitly Deferred

These are real concerns, but not part of this first pass:

- detailed queued-turn machinery
- long-lived remote process reuse across turns
- workflow retry policy details for non-idempotent provider calls
- attach-to-existing-session recovery

## Alternative Direction Considered

### Agent sending webhooks

One alternative would be to have the agent running on the Sprite emit structured webhooks instead of streaming stdout/stderr over a WebSocket. That could wake the DO on every chunk and avoid relying on a long-lived outbound DO socket.

This is not the current plan because it adds a separate transport and new risks:

- authenticating webhook calls from the Sprite
- increased latency from routing every chunk back through public HTTP
- extra protocol and operational complexity compared with keeping the existing vm-agent stream format

This remains a fallback architecture if workflow-owned Sprite sockets prove unreliable in production.
