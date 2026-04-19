import type { UIMessageChunk } from "ai";
import {
  type AgentInputAttachment,
  type AgentMode,
  type AgentOutput,
  type AgentSettings,
  type DomainError,
  type Logger,
  type Result,
  decodeAgentOutput,
  encodeAgentInput,
  failure,
  success,
} from "@repo/shared";
import type { Env } from "@/types";
import {
  WorkersSpriteClient,
  type SpriteServerMessage,
  type SpriteWebsocketSession,
} from "@/lib/sprites";
import VM_AGENT_SCRIPT from "@repo/vm-agent/dist/vm-agent.bundle.js";
import {
  getProviderCredentialAdapter,
  type AuthCredentialSnapshot,
  type ProviderCredentialError,
} from "@/lib/providers/provider-credential-adapter";
import {
  AgentAttachmentService,
  type AttachmentResolutionError,
} from "@/durable-objects/lib/agent-attachment-service";

const HOME_DIR = "/home/sprite";
const WORKSPACE_DIR = "/home/sprite/workspace";
const AGENT_PROCESS_RUNNER_DOMAIN = "agent_process_runner";

export type PreparedWorkflowTurn = {
  userId: string;
  settings: AgentSettings;
  agentMode: AgentMode;
  agentSessionId: string | null;
};

export type AgentProcessRunnerTurnResult = {
  finishReason: string | undefined;
};

export type AgentProcessRunnerError =
  | DomainError<
      typeof AGENT_PROCESS_RUNNER_DOMAIN,
      "PROVIDER_AUTH_REQUIRED" | "PROVIDER_CREDENTIALS_SYNC_FAILED",
      { provider: AgentSettings["provider"] }
    >
  | DomainError<
      typeof AGENT_PROCESS_RUNNER_DOMAIN,
      "ATTACHMENTS_NOT_FOUND" | "ATTACHMENTS_RESOLUTION_FAILED",
      { attachmentIds: string[] }
    >
  | DomainError<
      typeof AGENT_PROCESS_RUNNER_DOMAIN,
      "TURN_DID_NOT_START" | "TURN_FAILED" | "TURN_EXITED",
      Record<string, unknown>
    >;

export type AgentProcessRunnerOptions = {
  env: Env;
  logger: Logger;
  spriteName: string;
  sessionId: string;
  preparedTurn: PreparedWorkflowTurn;
  /** Callback when the agent process attaches */
  onTurnStarted: (agentProcessId: number | null) => Promise<void>;
  onAgentSessionId: (agentSessionId: string) => Promise<void>;
  onChunk: (sequence: number, chunk: UIMessageChunk) => Promise<void>;
};

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
};

export type AgentProcessRunnerRunTurnInput = {
  content?: string;
  attachmentIds: string[];
  /** Optional model override for the turn. */
  model?: string;
  /** Optional agent mode override for the turn. */
  agentMode?: AgentMode;
};

function agentProcessRunnerError<Code extends AgentProcessRunnerError["code"]>(
  code: Code,
  message: string,
  details: Record<string, unknown> = {},
): Extract<AgentProcessRunnerError, { code: Code }> {
  return {
    domain: AGENT_PROCESS_RUNNER_DOMAIN,
    code,
    message,
    ...details,
  } as Extract<AgentProcessRunnerError, { code: Code }>;
}

function mapProviderCredentialError(
  error: ProviderCredentialError,
): Extract<
  AgentProcessRunnerError,
  { code: "PROVIDER_AUTH_REQUIRED" | "PROVIDER_CREDENTIALS_SYNC_FAILED" }
> {
  switch (error.code) {
    case "AUTH_REQUIRED":
    case "REAUTH_REQUIRED":
      return agentProcessRunnerError(
        "PROVIDER_AUTH_REQUIRED",
        error.message,
        { provider: error.provider },
      );
    case "SYNC_FAILED":
      return agentProcessRunnerError(
        "PROVIDER_CREDENTIALS_SYNC_FAILED",
        error.message,
        { provider: error.provider },
      );
    default: {
      const exhaustiveCheck: never = error;
      throw new Error(
        `Unhandled provider credential error: ${JSON.stringify(exhaustiveCheck)}`,
      );
    }
  }
}

function mapAttachmentResolutionError(
  error: AttachmentResolutionError,
): Extract<
  AgentProcessRunnerError,
  { code: "ATTACHMENTS_NOT_FOUND" | "ATTACHMENTS_RESOLUTION_FAILED" }
> {
  switch (error.code) {
    case "ATTACHMENTS_NOT_FOUND":
      return agentProcessRunnerError("ATTACHMENTS_NOT_FOUND", error.message, {
        attachmentIds: error.attachmentIds,
      });
    case "ATTACHMENTS_RESOLUTION_FAILED":
      return agentProcessRunnerError(
        "ATTACHMENTS_RESOLUTION_FAILED",
        error.message,
        { attachmentIds: error.attachmentIds },
      );
    default: {
      const exhaustiveCheck: never = error;
      throw new Error(
        `Unhandled attachment resolution error: ${JSON.stringify(exhaustiveCheck)}`,
      );
    }
  }
}

function getChunkFinishReason(chunk: UIMessageChunk): string | undefined {
  const finishReason = (chunk as { finishReason?: unknown }).finishReason;
  return typeof finishReason === "string" ? finishReason : undefined;
}

function isTerminalChunk(chunk: UIMessageChunk): boolean {
  switch (chunk.type) {
    case "finish":
      case "abort":
        return true;
    default:
      return false;
  }
}

function isAgentProcessRunnerError(
  error: unknown,
): error is AgentProcessRunnerError {
  return (
    typeof error === "object" &&
    error !== null &&
    "domain" in error &&
    "code" in error &&
    "message" in error &&
    (error as { domain?: unknown }).domain === AGENT_PROCESS_RUNNER_DOMAIN
  );
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

export class AgentProcessRunner {
  private readonly env: Env;
  private readonly logger: Logger;
  private readonly sprite: WorkersSpriteClient;
  private readonly sessionId: string;
  private readonly preparedTurn: PreparedWorkflowTurn;
  private readonly attachmentService: AgentAttachmentService;
  private readonly onTurnStarted: AgentProcessRunnerOptions["onTurnStarted"];
  private readonly onAgentSessionId: AgentProcessRunnerOptions["onAgentSessionId"];
  private readonly onChunk: AgentProcessRunnerOptions["onChunk"];
  private agentSession: SpriteWebsocketSession | null = null;
  private stdoutBuffer = "";
  // Serializes handleAgentStdout invocations so concurrent stdout frames
  // cannot interleave their awaited onChunk RPCs and reorder chunks at the DO.
  private stdoutProcessingPromise: Promise<void> = Promise.resolve();
  private chunkSequence = 0;
  private agentProcessId: number | null = null;
  private readonly turnStartedDeferred = createDeferred<void>();
  private readonly turnResultDeferred = createDeferred<Result<AgentProcessRunnerTurnResult, AgentProcessRunnerError>>();
  private turnSettled = false;

  constructor(options: AgentProcessRunnerOptions) {
    this.env = options.env;
    this.logger = options.logger.scope("agent-process-runner");
    this.sessionId = options.sessionId;
    this.preparedTurn = options.preparedTurn;
    this.onTurnStarted = options.onTurnStarted;
    this.onAgentSessionId = options.onAgentSessionId;
    this.onChunk = options.onChunk;
    this.attachmentService = new AgentAttachmentService(options.env, this.logger);
    this.sprite = new WorkersSpriteClient(
      options.spriteName,
      options.env.SPRITES_API_KEY,
      options.env.SPRITES_API_URL,
    );
  }

  async runTurn(
    input: AgentProcessRunnerRunTurnInput,
  ): Promise<Result<AgentProcessRunnerTurnResult, AgentProcessRunnerError>> {
    try {
      const attachmentResult = await this.resolveAttachments(input.attachmentIds);
      if (!attachmentResult.ok) {
        return failure(attachmentResult.error);
      }

      const credentialSnapshotResult = await this.loadCredentialSnapshot();
      if (!credentialSnapshotResult.ok) {
        return failure(credentialSnapshotResult.error);
      }
      await this.writeCredentialFilesToSprite(credentialSnapshotResult.value);

      await this.ensureVmAgentScriptWritten();

      this.agentSession = this.createAgentSession(
        input.model,
        input.agentMode,
        credentialSnapshotResult.value.envVars,
      );
      this.setupAgentSessionHandlers(this.agentSession);
      await this.agentSession.start();

      await this.waitForTurnStart();
      await this.onTurnStarted(this.agentProcessId);

      this.logger.debug(`Sending user message to vm-agent: ${input.content}`);
      this.agentSession.write(
        encodeAgentInput({
          type: "chat",
          message: {
            content: input.content,
            attachments:
              attachmentResult.value.length > 0
                ? attachmentResult.value
                : undefined,
          },
          model: input.model,
          agentMode: input.agentMode,
        }) + "\n",
      );

      return await this.turnResultDeferred.promise;
    } catch (error) {
      if (isAgentProcessRunnerError(error)) {
        return failure(error);
      }
      const errorMessage =
        error instanceof Error
          ? error.message
          : typeof error === "object" &&
              error !== null &&
              "message" in error &&
              typeof (error as { message?: unknown }).message === "string"
            ? (error as { message: string }).message
            : String(error);
      return failure(
        agentProcessRunnerError("TURN_FAILED", errorMessage, {
          cause: errorMessage,
        }),
      );
    } finally {
      await this.cleanup();
    }
  }

  private async resolveAttachments(
    attachmentIds: string[],
  ): Promise<Result<AgentInputAttachment[], AgentProcessRunnerError>> {
    const attachmentResult = await this.attachmentService.resolveAttachments(
      this.sessionId,
      attachmentIds,
    );
    if (!attachmentResult.ok) {
      return failure(mapAttachmentResolutionError(attachmentResult.error));
    }
    return success(attachmentResult.value.agentAttachments);
  }

  private async loadCredentialSnapshot(): Promise<
    Result<AuthCredentialSnapshot, AgentProcessRunnerError>
  > {
    const adapter = getProviderCredentialAdapter(
      this.preparedTurn.settings.provider,
      this.env,
      this.logger,
    );
    const snapshot = await adapter.getCredentialSnapshot(this.preparedTurn.userId);
    if (!snapshot.ok) {
      return failure(mapProviderCredentialError(snapshot.error));
    }
    return success(snapshot.value);
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

  private async ensureVmAgentScriptWritten(): Promise<void> {
    await this.sprite.writeFile(`${HOME_DIR}/.cloude/agent.js`, VM_AGENT_SCRIPT);
  }

  private createAgentSession(
    model: string | undefined,
    agentModeOverride: AgentMode | undefined,
    envVars: Record<string, string>,
  ): SpriteWebsocketSession {
    const effectiveAgentMode = agentModeOverride ?? this.preparedTurn.agentMode;
    const commands = [
      "bun",
      "run",
      `${HOME_DIR}/.cloude/agent.js`,
      `--provider=${JSON.stringify(this.preparedTurn.settings)}`,
      `--agentMode=${effectiveAgentMode}`,
      ...(this.preparedTurn.agentSessionId
        ? [`--sessionId=${this.preparedTurn.agentSessionId}`]
        : []),
    ];

    const session = this.sprite.createSession("env", commands, {
      cwd: WORKSPACE_DIR,
      tty: false,
      env: {
        SESSION_ID: this.sessionId,
        ...envVars,
      },
      // vm-agent emits a heartbeat every 15 seconds while responding,
      // so we need to set the idle timeout to tolerate 3 missed heartbeats before detecting a stale process.
      idleTimeoutMs: 45_000,
      // Keep the vm-agent process alive for 60s after the websocket disconnects
      // so a subsequent turn can reattach instead of spawning a fresh process.
      maxRunAfterDisconnect: "60s",
    });

    if (model) {
      this.logger.debug(`Requested model override for turn: ${model}`);
      // TODO: apply model override
    }

    return session;
  }

  private setupAgentSessionHandlers(session: SpriteWebsocketSession): void {
    session.onStdout((data: string) => {
      this.stdoutProcessingPromise = this.stdoutProcessingPromise
        // prevent a prior failure from poisoning the chain for later chunks
        .catch(() => undefined)
        .then(() => this.handleAgentStdout(data))
        .catch((error) => {
          this.failTurn(
            agentProcessRunnerError("TURN_FAILED", error.message, {
              cause: error.message,
            }),
          );
        });
    });

    session.onStderr((data: string) => {
      this.logger.error(`vm-agent stderr: ${data}`);
    });

    // NOTE: called when the vm-agent process exits. distinct from the websocket connection closing.
    // a exit should always close the websocket, but a websocket close does not always mean the process exited.
    session.onExit((code: number) => {
      if (this.turnSettled) {
        return;
      }
      this.failTurn(
        agentProcessRunnerError("TURN_EXITED", `vm-agent exited with code ${code}`, {
          exitCode: code,
        }),
      );
    });

    session.onError((error: Error) => {
      if (this.turnSettled) {
        return;
      }
      this.failTurn(
        agentProcessRunnerError("TURN_FAILED", error.message, {
          cause: error.message,
        }),
      );
    });

    session.onServerMessage((message: SpriteServerMessage) => {
      this.handleAgentServerMessage(message);
    });
  }

  private async handleAgentStdout(data: string): Promise<void> {
    this.stdoutBuffer += data;
    const lines = this.stdoutBuffer.split("\n");
    this.stdoutBuffer = lines.pop() ?? "";

    for (const rawLine of lines) {
      const line = rawLine.trimEnd();
      if (!line.trim()) continue;

      let output: AgentOutput;
      try {
        output = decodeAgentOutput(line);
      } catch (error) {
        // Loud log — a dropped line here silently loses a chunk (e.g. a
        // tool-input-start) and desyncs the client stream.
        this.logger.error(`Dropped unparseable agent output line`, {
          error,
          fields: { lineLength: line.length, linePreview: line.slice(0, 200) },
        });
        continue;
      }
      await this.handleAgentOutput(output);
    }
  }

  private handleAgentServerMessage(message: SpriteServerMessage): void {
    switch (message.type) {
      case "session_info":
        this.agentProcessId = message.session_id;
        this.turnStartedDeferred.resolve();
        break;
      default:
        break;
    }
  }

  private async handleAgentOutput(output: AgentOutput): Promise<void> {
    switch (output.type) {
      case "stream": {
        const chunk = output.chunk as UIMessageChunk;
        await this.onChunk(this.chunkSequence++, chunk);
    
        if (isTerminalChunk(chunk)) {
          this.logger.debug(`Terminal chunk received from vm-agent: ${JSON.stringify(chunk)}`);
          this.completeTurn({
            finishReason: getChunkFinishReason(chunk),
          });
        }
        break;
      }
      case "sessionId":
        await this.onAgentSessionId(output.sessionId);
        return;
      case "error":
        this.failTurn(
          agentProcessRunnerError("TURN_FAILED", output.error, {
            cause: output.error,
          }),
        );
        return;
      case "ready":
        // TODO: FORWARD TO THE DO
        break;
      case "debug":
        this.logger.debug(`Debug message received from vm-agent: ${output.message}`);
        return;
      case "heartbeat":
        // idle-timeout watchdog was already rearmed on frame receipt in
        // handleMessage. No further action needed.
        this.logger.debug("Heartbeat received from vm-agent");
        return;
      default: {
        const exhaustiveCheck: never = output;
        throw new Error(
          `Unhandled agent output: ${JSON.stringify(exhaustiveCheck)}`,
        );
      }
    }
  }

  private completeTurn(result: AgentProcessRunnerTurnResult): void {
    if (this.turnSettled) {
      return; // prevent duplicates
    }
    this.turnSettled = true;
    this.turnResultDeferred.resolve(success(result));
  }

  private failTurn(error: AgentProcessRunnerError): void {
    if (this.turnSettled) {
      return;
    }
    this.turnSettled = true;
    this.turnResultDeferred.resolve(failure(error));
  }

  private async cleanup(): Promise<void> {
    // close the websocket connection to the agent process.
    try {
      this.agentSession?.close();
    } catch (error) {
      this.logger.debug("Failed to close agent websocket", { error });
    }
    // TODO: Kill the process? or dont and allow attaching to an existing one later.
  }

  private async waitForTurnStart(): Promise<void> {
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => {
        reject(
          agentProcessRunnerError(
            "TURN_DID_NOT_START",
            "Timed out waiting for vm-agent session_info",
          ),
        );
      }, 10_000);
    });

    await Promise.race([this.turnStartedDeferred.promise, timeoutPromise]);
  }
}
