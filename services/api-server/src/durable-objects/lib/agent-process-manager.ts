import {
  type AgentOutput,
  type AgentInputAttachment,
  type ClientState,
  type DomainError,
  type Logger,
  type AgentSettings,
  type Result,
  decodeAgentOutput,
  encodeAgentInput,
  ClaudeAuthState,
  ClaudeModel,
  CodexModel,
  ChatMessageEvent,
  failure,
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
import {
  ensureClaudeCredentialsReadyForSend,
  getClaudeAuthRequiredFromClaudeError,
  getClaudeCredentialsSnapshot,
  refreshClaudeAuthRequired,
  type ClaudeCredentialsSyncError,
} from "../session-agent-claude-auth";
import { ClaudeOAuthError } from "@/lib/claude-oauth-service";
import { AttachmentRecord } from "@/types/attachments";
import { decrypt } from "@/lib/utils/crypto";
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

export type AgentProcessError =
  | DomainError<typeof AGENT_PROCESS_DOMAIN, "AGENT_SESSION_UNAVAILABLE", { retryable: true }>
  | DomainError<
      typeof AGENT_PROCESS_DOMAIN,
      "CLAUDE_AUTH_REQUIRED" | "CLAUDE_REAUTH_REQUIRED",
      { claudeAuthRequired: ClaudeAuthState }
    >
  | DomainError<typeof AGENT_PROCESS_DOMAIN, "CLAUDE_CREDENTIALS_SYNC_FAILED", { claudeAuthRequired: null }>
  | DomainError<typeof AGENT_PROCESS_DOMAIN, "OPENAI_AUTH_REQUIRED", { provider: "codex-cli" }>
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
  updateClaudeAuthRequired: (claudeAuthRequired: ClaudeAuthState | null) => void;
  updateAgentSettings: (settings: AgentSettings) => void;
  updateIsResponding: (isResponding: boolean) => void;
  /* eslint-enable no-unused-vars */
}

/**
 * Manages the lifecycle of the agent process WebSocket session running on a Sprite VM.
 * Handles all agent I/O: stdout/stderr parsing, chunk streaming, and message accumulation.
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
  private readonly updateClaudeAuthRequired: (claudeAuthRequired: ClaudeAuthState | null) => void;
  private readonly updateAgentSettings: (settings: AgentSettings) => void;
  private readonly updateIsResponding: (isResponding: boolean) => void;
  private agentWebsocketSession: SpriteWebsocketSession | null = null;
  /** Shares a single in-flight session start across concurrent callers. */
  private ensureAgentSessionStartedPromise: Promise<void> | null = null;
  private agentStdoutBuffer = "";
  /** Last Claude credential fingerprint pushed to the sprite VM instance */
  private lastClaudeCredentialFingerprint: string | null = null;
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
    this.updateClaudeAuthRequired = options.updateClaudeAuthRequired;
    this.updateAgentSettings = options.updateAgentSettings;
    this.updateIsResponding = options.updateIsResponding;
  }

  isConnected(): boolean {
    return this.agentWebsocketSession?.isConnected ?? false;
  }

  cancel(): void {
    if (this.agentWebsocketSession) {
      this.agentWebsocketSession.write(encodeAgentInput({ type: "cancel" }) + "\n");
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

    this.logger.info("Agent not connected — ensuring agent session is started");
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

    const commands = [
      "bun",
      "run",
      `${HOME_DIR}/.cloude/agent.js`,
      `--provider=${JSON.stringify(settings)}`,
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
  ): Promise<void> {
    if (!this.agentWebsocketSession || !this.agentWebsocketSession.isConnected) {
      throw new Error("Agent session not connected");
    }
    this.updateIsResponding(true);
    this.agentWebsocketSession.write(
      encodeAgentInput({
        type: "chat",
        message: {
          content,
          attachments: attachments.length > 0 ? attachments : undefined,
        },
        model,
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

    switch (this.getClientState().agentSettings.provider) {
      case "claude-code": {
        const credentialsResult = await this.ensureClaudeCredentialsReadyForSend();
        if (!credentialsResult.ok) {
          return failure(credentialsResult.error);
        }
        break;
      }
      case "codex-cli": {
        const credentialsResult = await this.ensureCodexCredentialsReadyForSend();
        if (!credentialsResult.ok) {
          return failure(credentialsResult.error);
        }
        break;
      }
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

    await this._sendMessageToAgent(content, agentAttachments, modelForAgent);

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
    const provider = this.getClientState().agentSettings.provider;
    const envVars: Record<string, string> = {};

    switch (provider) {
      case "codex-cli": {
        const codexAuthJson = await this.buildCodexAuthJson();
        envVars.CODEX_AUTH_JSON = codexAuthJson;
        break;
      }
      case "claude-code": {
        try {
          const claudeCredentials = await getClaudeCredentialsSnapshot({
            env: this.env,
            logger: this.logger,
            userId: this.getServerState().userId ?? "",
          });
          if (!claudeCredentials) {
            throw new Error(
              "Claude authentication required. Connect Claude before creating a session.",
            );
          }
          this.setClaudeAuthRequired(null);
          envVars.CLAUDE_CREDENTIALS_JSON = claudeCredentials.credentialsJson;
          this.lastClaudeCredentialFingerprint = claudeCredentials.fingerprint;
        } catch (error) {
          if (error instanceof ClaudeOAuthError) {
            this.setClaudeAuthRequired(getClaudeAuthRequiredFromClaudeError(error));
          }
          throw error;
        }
        break;
      }
    }

    return envVars;
  }

  private setClaudeAuthRequired(claudeAuthRequired: ClaudeAuthState | null): void {
    if (claudeAuthRequired) {
      this.lastClaudeCredentialFingerprint = null;
    }
    this.updateClaudeAuthRequired(claudeAuthRequired);
  }

  /**
   * Re-checks Claude OAuth status and clears claudeAuthRequired if the user has since connected.
   * Called when the user completes Claude OAuth while a session is active.
   */
  async refreshClaudeAuth(): Promise<void> {
    const result = await refreshClaudeAuthRequired({
      env: this.env,
      logger: this.logger,
      userId: this.getServerState().userId,
    });
    this.setClaudeAuthRequired(result.claudeAuthRequired);
  }

   /**
   * Build Codex auth.json content from per-user OpenAI OAuth tokens stored in D1.
   * Throws when no per-user OpenAI OAuth tokens are available.
   */
  private async buildCodexAuthJson(): Promise<string> {
    const userId = this.getServerState().userId;
    if (!userId) {
      throw new Error("OPENAI_AUTH_REQUIRED");
    }

    const row = await this.env.DB.prepare(
      `SELECT encrypted_access_token, encrypted_refresh_token, encrypted_id_token, token_expires_at
       FROM openai_tokens WHERE user_id = ?`,
    )
      .bind(userId)
      .first<{
        encrypted_access_token: string;
        encrypted_refresh_token: string | null;
        encrypted_id_token: string | null;
        token_expires_at: string | null;
      }>();

    if (!row) {
      throw new Error("OPENAI_AUTH_REQUIRED");
    }

    const accessToken = await decrypt(row.encrypted_access_token, this.env.TOKEN_ENCRYPTION_KEY);
    const refreshToken = row.encrypted_refresh_token
      ? await decrypt(row.encrypted_refresh_token, this.env.TOKEN_ENCRYPTION_KEY)
      : undefined;
    const idToken = row.encrypted_id_token
      ? await decrypt(row.encrypted_id_token, this.env.TOKEN_ENCRYPTION_KEY)
      : undefined;

    const authJson: Record<string, unknown> = {
      auth_mode: "chatgpt",
      tokens: {
        access_token: accessToken,
        ...(refreshToken && { refresh_token: refreshToken }),
        ...(idToken && { id_token: idToken }),
        ...(row.token_expires_at && { expires_at: row.token_expires_at }),
      },
    };

    return JSON.stringify(authJson);
  }

  /** Validates the model against the current provider and updates DO state. 
   * Returns the validated model, or throws an error if invalid.
   * */
  private validateAndApplyModelSwitch(model: string): Result<string | undefined, AgentProcessError> {
    const currentProvider = this.getClientState().agentSettings.provider;

    let validatedModel: string;
    if (currentProvider === "claude-code") {
      const result = ClaudeModel.safeParse(model);
      if (!result.success) {
        this.logger.warn("Invalid Claude model in model switch", { fields: { model } });
        return failure(agentProcessError("INVALID_MODEL", "Invalid Claude model in model switch.", {
          provider: currentProvider,
          model,
        }));
      }
      validatedModel = result.data;
    } else if (currentProvider === "codex-cli") {
      const result = CodexModel.safeParse(model);
      if (!result.success) {
        this.logger.warn("Invalid Codex model in model switch", { fields: { model } });
        return failure(agentProcessError("INVALID_MODEL", "Invalid Codex model in model switch.", {
          provider: currentProvider,
          model,
        }));
      }
      validatedModel = result.data;
    } else {
      this.logger.warn("Unknown provider in model switch", { fields: { provider: currentProvider } });
      throw new Error("Unknown provider in model switch");
    }

    // Update state (auto-syncs to clients via Agents SDK)
    const newSettings = { ...this.getClientState().agentSettings, model: validatedModel } as AgentSettings;
    this.updateAgentSettings(newSettings);

    this.logger.info("Model updated", {
      fields: { provider: currentProvider, model: validatedModel },
    });
    return success(validatedModel);
  }

  private mapClaudeCredentialError(
    error: ClaudeCredentialsSyncError,
  ): AgentProcessError {
    if (error.code === "CLAUDE_AUTH_REQUIRED" || error.code === "CLAUDE_REAUTH_REQUIRED") {
      return agentProcessError(error.code, error.message, {
        claudeAuthRequired: error.claudeAuthRequired,
      });
    }

    return agentProcessError("CLAUDE_CREDENTIALS_SYNC_FAILED", error.message, {
      claudeAuthRequired: null,
    });
  }

  private async ensureClaudeCredentialsReadyForSend(): Promise<Result<void, AgentProcessError>> {
    if (this.getClientState().agentSettings.provider !== "claude-code") {
      return success(undefined);
    }
    const serverState = this.getServerState();
    const result = await ensureClaudeCredentialsReadyForSend({
      env: this.env,
      logger: this.logger,
      userId: serverState.userId,
      spriteName: serverState.spriteName,
      lastFingerprint: this.lastClaudeCredentialFingerprint,
    });

    if (!result.ok) {
      this.setClaudeAuthRequired(result.error.claudeAuthRequired);
      return failure(this.mapClaudeCredentialError(result.error));
    }

    this.setClaudeAuthRequired(result.value.claudeAuthRequired);
    this.lastClaudeCredentialFingerprint = result.value.nextFingerprint;
    return success(undefined);
  }

  private async ensureCodexCredentialsReadyForSend(): Promise<Result<void, AgentProcessError>> {
    if (this.getClientState().agentSettings.provider !== "codex-cli") {
      return success(undefined);
    }
    try {
      await this.buildCodexAuthJson();
      return success(undefined);
    } catch {
      return failure(agentProcessError("OPENAI_AUTH_REQUIRED", "OPENAI_AUTH_REQUIRED", {
        provider: "codex-cli",
      }));
    }
  }
}
