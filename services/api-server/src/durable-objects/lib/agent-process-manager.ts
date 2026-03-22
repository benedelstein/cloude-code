import {
  type AgentOutput,
  type AgentInputAttachment,
  type ClientState,
  type Logger,
  type AgentSettings,
  decodeAgentOutput,
  encodeAgentInput,
  ClaudeAuthState,
  ClaudeModel,
  CodexModel,
  ChatMessageEvent,
} from "@repo/shared";
import {
  WorkersSpriteClient,
  type SpriteWebsocketSession,
  type SpriteServerMessage,
} from "@/lib/sprites";
import type { Env } from "@/types";
import VM_AGENT_SCRIPT from "@repo/vm-agent/dist/vm-agent.bundle.js";
import type { ServerState } from "@/durable-objects/repositories/server-state-repository";
import { ensureClaudeCredentialsReadyForSend, getClaudeAuthRequiredFromClaudeError, getClaudeCredentialsSnapshot, refreshClaudeAuthRequired } from "../session-agent-claude-auth";
import { ClaudeOAuthError } from "@/lib/claude-oauth-service";
import { AttachmentRecord } from "@/types/attachments";
import { decrypt } from "@/lib/crypto";
import { AgentAttachmentService } from "./attachment-service";

const HOME_DIR = "/home/sprite";
const WORKSPACE_DIR = "/home/sprite/workspace";

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
    const { agentAttachments, attachmentRecords } = await this.agentAttachmentService.resolveAttachments(sessionId, attachmentIds);
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
  ): Promise<{attachments: AttachmentRecord[]}> {
    // Reattach agent session if needed (after hibernation)
    await this.ensureAgentSessionStarted();

    if (!this.isConnected()) {
      this.logger.error(`Agent session unavailable after ensureAgentSessionStarted: spriteName=${this.getServerState().spriteName}, sessionId=${this.getServerState().sessionId}`);
      throw new Error("Agent session not available");
    }

    switch (this.getClientState().agentSettings.provider) {
      case "claude-code": {
        if (!await this.ensureClaudeCredentialsReadyForSend()) {
          throw new Error("Claude credentials not ready");
        }
        break;
      }
      case "codex-cli": {
        if (!await this.ensureCodexCredentialsReadyForSend()) {
          throw new Error("Codex credentials not ready");
        }
        break;
      }
    }

    const sessionId = this.getServerState().sessionId;
    if (!sessionId) {
      throw new Error("Session id not found");
    }
    const content = payload.content?.trim();

   const { agentAttachments, attachmentRecords } = await this.agentAttachmentService.resolveAttachments(sessionId, payload.attachments?.map(a => a.attachmentId) ?? []);

    // Validate and apply model switch (if requested and different from current)
    let modelForAgent: string | undefined;
    if (payload.model && payload.model !== this.getClientState().agentSettings.model) {
      modelForAgent = this.validateAndApplyModelSwitch(payload.model);
    }

    await this._sendMessageToAgent(content, agentAttachments, modelForAgent);
    
    return {
      attachments: attachmentRecords,
    }
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
        if (codexAuthJson) {
          envVars.CODEX_AUTH_JSON = codexAuthJson;
        } else if (this.env.CODEX_AUTH_JSON) {
          envVars.CODEX_AUTH_JSON = this.env.CODEX_AUTH_JSON;
        }
        if (this.env.OPENAI_API_KEY) {
          envVars.OPENAI_API_KEY = this.env.OPENAI_API_KEY;
        }
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
   * Returns null if no per-user tokens are found.
   */
  private async buildCodexAuthJson(): Promise<string | null> {
    const userId = this.getServerState().userId;
    if (!userId) return null;

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

    if (!row) return null;

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
  private validateAndApplyModelSwitch(model: string): string | undefined {
    const currentProvider = this.getClientState().agentSettings.provider;

    let validatedModel: string;
    if (currentProvider === "claude-code") {
      const result = ClaudeModel.safeParse(model);
      if (!result.success) {
        this.logger.warn("Invalid Claude model in model switch", { fields: { model } });
        throw new Error("Invalid Claude model in model switch");
      }
      validatedModel = result.data;
    } else if (currentProvider === "codex-cli") {
      const result = CodexModel.safeParse(model);
      if (!result.success) {
        this.logger.warn("Invalid Codex model in model switch", { fields: { model } });
        throw new Error("Invalid Codex model in model switch");
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
    return validatedModel;
  }

  private async ensureClaudeCredentialsReadyForSend(): Promise<boolean> {
    if (this.getClientState().agentSettings.provider !== "claude-code") {
      return true;
    }
    const serverState = this.getServerState();
    const result = await ensureClaudeCredentialsReadyForSend({
      env: this.env,
      logger: this.logger,
      userId: serverState.userId,
      spriteName: serverState.spriteName,
      lastFingerprint: this.lastClaudeCredentialFingerprint,
    });

    this.setClaudeAuthRequired(result.claudeAuthRequired);
    if (result.ok) {
      this.lastClaudeCredentialFingerprint = result.nextFingerprint;
      return true;
    }
    return false;
  }

  private async ensureCodexCredentialsReadyForSend(): Promise<boolean> {
    if (this.getClientState().agentSettings.provider !== "codex-cli") {
      return true;
    }
    // TODO: implement
    return false;
  }
}
