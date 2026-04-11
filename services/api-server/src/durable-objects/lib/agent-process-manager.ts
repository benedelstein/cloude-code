import {
  type AgentMode,
  type AgentOutput,
  type AgentInputAttachment,
  type ClientState,
  type ProviderConnectionState,
  type DomainError,
  type Logger,
  type AgentSettings,
  type Result,
  decodeAgentOutput,
  encodeAgentInput,
  ChatMessageEvent,
  failure,
  getProviderModelDefinition,
  success,
} from "@repo/shared";
import {
  WorkersSpriteClient,
  type SpriteWebsocketSession,
  type SpriteServerMessage,
} from "@/lib/sprites";
import type { Env } from "@/types";
import VM_AGENT_SCRIPT from "@repo/vm-agent/dist/vm-agent.bundle.js";
import type { ServerState } from "@/durable-objects/repositories/server-state-repository";
import { AttachmentRecord } from "@/types/attachments";
import {
  getProviderCredentialAdapter,
  type AuthCredentialSnapshot,
  type ProviderCredentialError,
} from "@/lib/providers/provider-credential-adapter";
import {
  AgentAttachmentService,
  type AttachmentResolutionError,
} from "./attachment-service";

const HOME_DIR = "/home/sprite";
const WORKSPACE_DIR = "/home/sprite/workspace";
const AGENT_PROCESS_DOMAIN = "agent_process";

type AgentProcessMessageResult = {
  attachments: AttachmentRecord[];
};

type SyncedCredentialState = {
  providerId: AgentSettings["provider"];
  syncToken: string;
};

export type AgentProcessError =
  | DomainError<typeof AGENT_PROCESS_DOMAIN, "AGENT_SESSION_UNAVAILABLE", { retryable: true }>
  | DomainError<typeof AGENT_PROCESS_DOMAIN, "PROVIDER_AUTH_REQUIRED", { provider: AgentSettings["provider"] }>
  | DomainError<typeof AGENT_PROCESS_DOMAIN, "PROVIDER_CREDENTIALS_SYNC_FAILED", { provider: AgentSettings["provider"] }>
  | DomainError<
      typeof AGENT_PROCESS_DOMAIN,
      "INVALID_MODEL",
      { provider: AgentSettings["provider"]; model: string }
    >
  | DomainError<
      typeof AGENT_PROCESS_DOMAIN,
      "ATTACHMENTS_NOT_FOUND" | "ATTACHMENTS_RESOLUTION_FAILED",
      { attachmentIds: string[] }
    >;

function agentProcessError<Code extends AgentProcessError["code"]>(
  code: Code,
  message: string,
  details: Record<string, unknown>,
): Extract<AgentProcessError, { code: Code }> {
  return {
    domain: AGENT_PROCESS_DOMAIN,
    code,
    message,
    ...details,
  } as Extract<AgentProcessError, { code: Code }>;
}

function mapAttachmentResolutionError(
  error: AttachmentResolutionError,
): AgentProcessError {
  switch (error.code) {
    case "ATTACHMENTS_NOT_FOUND":
      return agentProcessError("ATTACHMENTS_NOT_FOUND", error.message, {
        attachmentIds: error.attachmentIds,
      });
    case "ATTACHMENTS_RESOLUTION_FAILED":
      return agentProcessError("ATTACHMENTS_RESOLUTION_FAILED", error.message, {
        attachmentIds: error.attachmentIds,
      });
  }
}

export interface StartAgentParams {
  spriteName: string;
  agentSessionId: string | null;
  settings: AgentSettings;
  sessionId: string;
  /** Provider-specific environment variables (credentials, etc.) */
  envVars: Record<string, string>;
}

export interface AgentProcessManagerOptions {
  logger: Logger;
  env: Env;
  /* eslint-disable no-unused-vars */
  onAgentOutput: (output: AgentOutput) => void;
  onAgentError: (error: string) => void;
  onAgentExit: (code: number) => void;
  getClientState: () => ClientState;
  getServerState: () => ServerState;
  updateLastKnownAgentProcessId: (processId: number | null) => void;
  updateAgentSettings: (settings: AgentSettings) => void;
  updateAgentMode: (agentMode: AgentMode) => void;
  updateProviderConnection: (providerConnection: ProviderConnectionState) => void;
  /* eslint-enable no-unused-vars */
}

/**
 * Manages the lifecycle of the agent process WebSocket session running on a Sprite VM.
 * Handles all agent I/O: stdout/stderr parsing, chunk streaming
 */
export class AgentProcessManager {
  /* eslint-disable no-unused-vars */
  private readonly logger: Logger;
  private readonly env: Env;
  private readonly agentAttachmentService: AgentAttachmentService;
  private readonly onAgentOutput: (output: AgentOutput) => void;
  private readonly onAgentError: (error: string) => void;
  private readonly onAgentExit: (code: number) => void;
  private readonly getClientState: () => ClientState;
  private readonly getServerState: () => ServerState;
  private readonly updateLastKnownAgentProcessId: (processId: number | null) => void;
  private readonly updateAgentSettings: (settings: AgentSettings) => void;
  private readonly updateAgentMode: (agentMode: AgentMode) => void;
  private readonly updateProviderConnection: (providerConnection: ProviderConnectionState) => void;
  private agentWebsocketSession: SpriteWebsocketSession | null = null;
  /** Shares a single in-flight session start across concurrent callers. */
  private ensureAgentSessionStartedPromise: Promise<void> | null = null;
  private agentStdoutBuffer = "";
  private lastSyncedCredentialState: SyncedCredentialState | null = null;
  /* eslint-enable no-unused-vars */

  constructor(options: AgentProcessManagerOptions) {
    this.logger = options.logger.scope("agent-process-manager");
    this.env = options.env;
    this.updateLastKnownAgentProcessId = options.updateLastKnownAgentProcessId;
    this.agentAttachmentService = new AgentAttachmentService(this.env, this.logger);
    this.onAgentOutput = options.onAgentOutput;
    this.onAgentError = options.onAgentError;
    this.onAgentExit = options.onAgentExit;
    this.getClientState = options.getClientState;
    this.getServerState = options.getServerState;
    this.updateAgentSettings = options.updateAgentSettings;
    this.updateAgentMode = options.updateAgentMode;
    this.updateProviderConnection = options.updateProviderConnection;
  }

  isConnected(): boolean {
    return this.agentWebsocketSession?.isConnected ?? false;
  }

  isConnecting(): boolean {
    return this.ensureAgentSessionStartedPromise !== null;
  }

  cancel(): void {
    if (this.agentWebsocketSession) {
      this.agentWebsocketSession.write(encodeAgentInput({ type: "cancel" }) + "\n");
    }
  }

  async stopSessionManagedProcesses(): Promise<void> {
    const serverState = this.getServerState();
    const spriteName = serverState.spriteName;
    if (!spriteName) {
      return;
    }

    const sprite = new WorkersSpriteClient(
      spriteName,
      this.env.SPRITES_API_KEY,
      this.env.SPRITES_API_URL,
    );
    const commands: string[] = [];

    if (serverState.lastKnownAgentProcessId !== null) {
      commands.push(`kill ${serverState.lastKnownAgentProcessId} 2>/dev/null || true`);
    }

    // Best-effort cleanup for the agent process if the tracked pid is stale or missing.
    commands.push(`pkill -f '${HOME_DIR}/.cloude/agent.js' 2>/dev/null || true`);

    try {
      await sprite.execWs(commands.join("\n"), {
        cwd: WORKSPACE_DIR,
        idleTimeoutMs: 5_000,
      });
    } catch (error) {
      this.logger.error("Failed to stop session-managed processes", { error });
    } finally {
      this.updateLastKnownAgentProcessId(null);
    }
  }

  async ensureAgentSessionStarted(): Promise<void> {
    if (this.isConnected()) {
      return;
    }
    // mutex
    if (this.ensureAgentSessionStartedPromise) {
      return this.ensureAgentSessionStartedPromise;
    }

    this.logger.info("Agent not connected — starting agent session");
    this.ensureAgentSessionStartedPromise = this.startAgentSession().finally(() => {
      this.ensureAgentSessionStartedPromise = null;
    });
    return this.ensureAgentSessionStartedPromise;
  }

  /**
   * Starts a new agent process session on the sprite VM.
   * Writes the agent script, launches the process, and attaches stdin/stdout handlers.
   */
  private async startAgentSession(): Promise<void> {
    const serverState = this.getServerState();
    const clientState = this.getClientState();
    const spriteName = serverState.spriteName;
    const agentSessionId = serverState.agentSessionId;
    const settings = clientState.agentSettings;
    const sessionId = serverState.sessionId;
    if (!serverState.spriteName) {
      throw new Error("Sprite name not found");
    }
    if (!sessionId) {
      throw new Error("Session id not found");
    }
    const sprite = new WorkersSpriteClient(serverState.spriteName, this.env.SPRITES_API_KEY, this.env.SPRITES_API_URL);

    await sprite.writeFile(`${HOME_DIR}/.cloude/agent.js`, VM_AGENT_SCRIPT);

    this.logger.debug(
      `Starting agent on sprite ${spriteName} with settings ${JSON.stringify(settings)} and agentSessionId ${agentSessionId}`,
    );

    const agentMode = clientState.agentMode;

    const commands = [
      "bun",
      "run",
      `${HOME_DIR}/.cloude/agent.js`,
      `--provider=${JSON.stringify(settings)}`,
      `--agentMode=${agentMode}`,
      ...(agentSessionId ? [`--sessionId=${agentSessionId}`] : []),
    ];

    const envVars = await this.buildAgentEnvVars();

    const baseEnv: Record<string, string> = {
      SESSION_ID: sessionId,
      ...envVars,
    };

    this.agentWebsocketSession = sprite.createSession("env", commands, {
      cwd: WORKSPACE_DIR,
      tty: false,
      env: baseEnv,
    });

    this.setupAgentSessionHandlers(this.agentWebsocketSession);
    await this.agentWebsocketSession.start();
    this.logger.info(`vm-agent (${settings.provider}) started on sprite ${spriteName}`);
  }

  /**
   * Writes a chat message to the agent's stdin.
   */
  private async _sendMessageToAgent(
    content: string | undefined,
    attachments: AgentInputAttachment[],
    model?: string,
    agentMode?: AgentMode,
  ): Promise<void> {
    if (!this.agentWebsocketSession || !this.agentWebsocketSession.isConnected) {
      throw new Error("Agent session not connected");
    }
    this.agentWebsocketSession.write(
      encodeAgentInput({
        type: "chat",
        message: {
          content,
          attachments: attachments.length > 0 ? attachments : undefined,
        },
        model,
        agentMode,
      }) + "\n",
    );
  }

  /**
   * Resolves a user message with attachments and sends it to the agent.
   * @param sessionId the cloude session id (not the agent session id)
   * @param content the content of the message
   * @param attachmentIds the ids of the attachments to send to the agent
   * @returns resolved attachment records, if any. Throws an error if something goes wrong (eg attachments not found, etc)
   */
  async sendMessageToAgent(
    sessionId: string,
    content: string | undefined,
    attachmentIds: string[],
  ): Promise<AttachmentRecord[]> {
    const attachmentResult = await this.agentAttachmentService.resolveAttachments(sessionId, attachmentIds);
    if (!attachmentResult.ok) {
      throw new Error(attachmentResult.error.message);
    }
    const { agentAttachments, attachmentRecords } = attachmentResult.value;
    await this._sendMessageToAgent(content, agentAttachments);
    return attachmentRecords;
  }

  /**
   * Handles a message meant to be sent to the agent.
   * @param payload the message event payload
   * @returns a result containing the attachment records, if any. Throws an error if something goes wrong (eg attachments not found, etc)
   */
  async handleChatMessage(
    payload: ChatMessageEvent
  ): Promise<Result<AgentProcessMessageResult, AgentProcessError>> {
    // Reattach agent session if needed (after hibernation, or if the ws connection to the sprite dies)
    await this.ensureAgentSessionStarted();

    if (!this.isConnected()) {
      this.logger.error(`Agent session unavailable after ensureAgentSessionStarted: spriteName=${this.getServerState().spriteName}, sessionId=${this.getServerState().sessionId}`);
      return failure(agentProcessError("AGENT_SESSION_UNAVAILABLE", "Agent session not available.", { retryable: true }));
    }

    const credentialsResult = await this.ensureProviderCredentialsReadyForSend();
    if (!credentialsResult.ok) {
      return failure(credentialsResult.error);
    }

    const sessionId = this.getServerState().sessionId;
    if (!sessionId) {
      throw new Error("Session id not found");
    }
    const content = payload.content?.trim();
    const attachmentIds = payload.attachments?.map((attachment) => attachment.attachmentId) ?? [];

    const attachmentResult = await this.agentAttachmentService.resolveAttachments(sessionId, attachmentIds);
    if (!attachmentResult.ok) {
      return failure(mapAttachmentResolutionError(attachmentResult.error));
    }
    const { agentAttachments, attachmentRecords } = attachmentResult.value;

    // Validate and apply model switch (if requested and different from current)
    let modelForAgent: string | undefined;
    if (payload.model && payload.model !== this.getClientState().agentSettings.model) {
      const modelResult = this.validateAndApplyModelSwitch(payload.model);
      if (!modelResult.ok) {
        return modelResult;
      }
      modelForAgent = modelResult.value;
    }

    // Apply agent mode toggle (if requested and different from current)
    let agentModeForAgent: AgentMode | undefined;
    if (payload.agentMode && payload.agentMode !== this.getClientState().agentMode) {
      this.updateAgentMode(payload.agentMode);
      agentModeForAgent = payload.agentMode;
      this.logger.info("Agent mode updated", { fields: { agentMode: payload.agentMode } });
    }

    await this._sendMessageToAgent(content, agentAttachments, modelForAgent, agentModeForAgent);

    return success({
      attachments: attachmentRecords,
    });
  }

  private setupAgentSessionHandlers(session: SpriteWebsocketSession): void {
    session.onStdout((data: string) => {
      this.handleAgentStdout(data);
    });

    session.onStderr((data: string) => {
      this.logger.error(`vm-agent stderr: ${data}`);
      this.onAgentError(data);
    });

    session.onExit((code: number) => {
      this.logger.info(`vm-agent exited with code ${code}`);
      this.agentStdoutBuffer = "";
      this.agentWebsocketSession = null;
      this.onAgentExit(code);
    });

    session.onError((error: Error) => {
      this.logger.error(`vm-agent websocket error: ${error.message}`);
      this.agentStdoutBuffer = "";
      this.agentWebsocketSession = null;
      this.onAgentError(error.message);
    });

    session.onServerMessage((msg: SpriteServerMessage) => {
      this.handleAgentServerMessage(msg);
    });
  }

  private handleAgentStdout(data: string): void {
    // Buffer partial lines until a full NDJSON line arrives
    this.agentStdoutBuffer += data;
    const lines = this.agentStdoutBuffer.split("\n");
    this.agentStdoutBuffer = lines.pop() ?? "";

    for (const rawLine of lines) {
      const line = rawLine.trimEnd();
      if (!line.trim()) continue;

      try {
        const output = decodeAgentOutput(line);
        this.handleAgentOutput(output);
      } catch {
        // Ignore lines that don't match AgentOutput schema (e.g., TTY echo)
        this.logger.debug(`Skipping invalid agent output: ${line}`);
      }
    }
  }

  private handleAgentOutput(output: AgentOutput): void {
    this.onAgentOutput(output);
  }

  private handleAgentServerMessage(msg: SpriteServerMessage): void {
    switch (msg.type) {
      case "session_info":
        // session_id here is the OS process ID of the agent, not the agent's own session ID
        this.logger.info(`vm-agent process id: ${JSON.stringify(msg.session_id)}`);
        this.updateLastKnownAgentProcessId(msg.session_id);
        break;
      default:
        break;
    }
  }

  // ============================================
  // Provider configuration
  // ============================================

  /**
   * Builds the provider-specific environment variables for the agent process.
   * Fetches and validates credentials for the configured provider.
   */
  private async buildAgentEnvVars(): Promise<Record<string, string>> {
    const providerId = this.getClientState().agentSettings.provider;
    const userId = this.getServerState().userId;
    if (!userId) {
      this.updateProviderConnection({
        provider: providerId,
        connected: false,
        requiresReauth: false,
      });
      throw new Error("Missing user id");
    }

    const snapshotResult = await this.getCredentialSnapshotForProvider(providerId, userId);
    if (!snapshotResult.ok) {
      this.applyProviderConnectionResult(providerId, snapshotResult.error);
      throw new Error(snapshotResult.error.message);
    }

    this.updateProviderConnection({
      provider: providerId,
      connected: snapshotResult.value.connectionStatus.connected,
      requiresReauth: snapshotResult.value.connectionStatus.requiresReauth,
    });
    await this.syncAuthCredentialsToSprite(providerId, snapshotResult.value);
    return snapshotResult.value.envVars;
  }

  /** Validates the model against the current provider and updates DO state. 
   * Returns the validated model, or throws an error if invalid.
   * */
  private validateAndApplyModelSwitch(model: string): Result<string | undefined, AgentProcessError> {
    const currentProvider = this.getClientState().agentSettings.provider;

    const validatedModel = getProviderModelDefinition(currentProvider, model);
    if (!validatedModel) {
      this.logger.warn("Invalid provider model in model switch", {
        fields: { provider: currentProvider, model },
      });
      return failure(agentProcessError("INVALID_MODEL", "Invalid model in model switch.", {
        provider: currentProvider,
        model,
      }));
    }

    // Update state (auto-syncs to clients via Agents SDK)
    const newSettings = {
      ...this.getClientState().agentSettings,
      model: validatedModel.id,
    } as AgentSettings;
    this.updateAgentSettings(newSettings);

    this.logger.info("Model updated", {
      fields: { provider: currentProvider, model: validatedModel.id },
    });
    return success(validatedModel.id);
  }

  private async ensureProviderCredentialsReadyForSend(): Promise<Result<void, AgentProcessError>> {
    const providerId = this.getClientState().agentSettings.provider;
    const userId = this.getServerState().userId;
    if (!userId) {
      this.updateProviderConnection({
        provider: providerId,
        connected: false,
        requiresReauth: false,
      });
      return failure(agentProcessError("PROVIDER_AUTH_REQUIRED", "Authentication required.", { provider: providerId }));
    }

    const snapshotResult = await this.getCredentialSnapshotForProvider(providerId, userId);
    if (!snapshotResult.ok) {
      this.applyProviderConnectionResult(providerId, snapshotResult.error);
      return failure(this.mapProviderCredentialError(snapshotResult.error));
    }
    this.updateProviderConnection({
      provider: providerId,
      connected: snapshotResult.value.connectionStatus.connected,
      requiresReauth: snapshotResult.value.connectionStatus.requiresReauth,
    });
    await this.syncAuthCredentialsToSprite(providerId, snapshotResult.value);
    return success(undefined);
  }

  private applyProviderConnectionResult(
    providerId: AgentSettings["provider"],
    error: ProviderCredentialError,
  ): void {
    switch (error.code) {
      case "AUTH_REQUIRED":
        this.updateProviderConnection({
          provider: providerId,
          connected: false,
          requiresReauth: false,
        });
        break;
      case "REAUTH_REQUIRED":
        this.updateProviderConnection({
          provider: providerId,
          connected: false,
          requiresReauth: true,
        });
        break;
      case "SYNC_FAILED":
        break;
      default: {
        const exhaustiveCheck: never = error;
        throw new Error(`Unhandled provider credential error: ${JSON.stringify(exhaustiveCheck)}`);
      }
    }
  }

  private async getCredentialSnapshotForProvider(
    providerId: AgentSettings["provider"],
    userId: string,
  ): Promise<Result<AuthCredentialSnapshot, ProviderCredentialError>> {
    const adapter = getProviderCredentialAdapter(providerId, this.env, this.logger);
    return adapter.getCredentialSnapshot(userId);
  }

  private async syncAuthCredentialsToSprite(
    providerId: AgentSettings["provider"],
    snapshot: AuthCredentialSnapshot,
  ): Promise<void> {
    const spriteName = this.getServerState().spriteName;
    if (!spriteName) {
      throw new Error("Sprite not available");
    }

    const snapshotMatches =
      this.lastSyncedCredentialState?.providerId === providerId &&
      this.lastSyncedCredentialState?.syncToken === snapshot.syncToken;

    if (snapshotMatches) {
      return;
    }

    const sprite = new WorkersSpriteClient(
      spriteName,
      this.env.SPRITES_API_KEY,
      this.env.SPRITES_API_URL,
    );

    for (const file of snapshot.files) {
      await sprite.writeFile(
        file.path,
        file.contents,
        file.mode ? { mode: file.mode } : undefined,
      );
    }

    this.lastSyncedCredentialState = {
      providerId,
      syncToken: snapshot.syncToken,
    };
  }

  private mapProviderCredentialError(error: ProviderCredentialError): AgentProcessError {
    if (error.code === "AUTH_REQUIRED" || error.code === "REAUTH_REQUIRED") {
      return agentProcessError("PROVIDER_AUTH_REQUIRED", error.message, { provider: error.provider });
    }
    return agentProcessError("PROVIDER_CREDENTIALS_SYNC_FAILED", error.message, { provider: error.provider });
  }
}
