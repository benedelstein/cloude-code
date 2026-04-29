import {
  type AgentInputAttachment,
  type AgentInputMessage,
  type AgentMode,
  type AgentSettings,
  type ClientState,
  type DomainError,
  type Logger,
  type Result,
  failure,
  success,
} from "@repo/shared";
import type { Env } from "@/types";
import {
  SpritesError,
  WorkersSpriteClient,
  type SpriteServerMessage,
  type SpriteWebsocketSession,
} from "@/lib/sprites";
import VM_AGENT_WEBHOOK_SCRIPT from "@repo/vm-agent/dist/vm-agent-webhook.bundle.js";
import {
  getProviderCredentialAdapter,
  type AuthCredentialSnapshot,
  type ProviderCredentialError,
} from "@/lib/providers/provider-credential-adapter";
import {
  AgentAttachmentService,
  type AttachmentResolutionError,
} from "./agent-attachment-service";
import type { SecretRepository } from "../repositories/secret-repository";
import type { ServerState } from "../repositories/server-state-repository";

const HOME_DIR = "/home/sprite";
const WORKSPACE_DIR = "/home/sprite/workspace";
const VM_AGENT_LOG_DIR = `${HOME_DIR}/.cloude/logs`;
const AGENT_PROCESS_MANAGER_DOMAIN = "agent_process_manager";

export type SpriteAgentProcessManagerError =
  | DomainError<
      typeof AGENT_PROCESS_MANAGER_DOMAIN,
      "PROVIDER_AUTH_REQUIRED" | "PROVIDER_CREDENTIALS_SYNC_FAILED",
      { provider: AgentSettings["provider"] }
    >
  | DomainError<
      typeof AGENT_PROCESS_MANAGER_DOMAIN,
      "ATTACHMENTS_NOT_FOUND" | "ATTACHMENTS_RESOLUTION_FAILED",
      { attachmentIds: string[] }
    >
  | DomainError<
      typeof AGENT_PROCESS_MANAGER_DOMAIN,
      | "SESSION_NOT_READY"
      | "USER_NOT_FOUND"
      | "INVALID_AGENT_SETTINGS"
      | "SPAWN_FAILED"
      | "TURN_DID_NOT_START",
      Record<string, unknown>
    >;

function managerError<Code extends SpriteAgentProcessManagerError["code"]>(
  code: Code,
  message: string,
  details: Record<string, unknown> = {},
): Extract<SpriteAgentProcessManagerError, { code: Code }> {
  return {
    domain: AGENT_PROCESS_MANAGER_DOMAIN,
    code,
    message,
    ...details,
  } as Extract<SpriteAgentProcessManagerError, { code: Code }>;
}

function mapProviderCredentialError(
  error: ProviderCredentialError,
): Extract<
  SpriteAgentProcessManagerError,
  { code: "PROVIDER_AUTH_REQUIRED" | "PROVIDER_CREDENTIALS_SYNC_FAILED" }
> {
  switch (error.code) {
    case "AUTH_REQUIRED":
    case "REAUTH_REQUIRED":
      return managerError("PROVIDER_AUTH_REQUIRED", error.message, {
        provider: error.provider,
      });
    case "SYNC_FAILED":
      return managerError("PROVIDER_CREDENTIALS_SYNC_FAILED", error.message, {
        provider: error.provider,
      });
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
  SpriteAgentProcessManagerError,
  { code: "ATTACHMENTS_NOT_FOUND" | "ATTACHMENTS_RESOLUTION_FAILED" }
> {
  switch (error.code) {
    case "ATTACHMENTS_NOT_FOUND":
      return managerError("ATTACHMENTS_NOT_FOUND", error.message, {
        attachmentIds: error.attachmentIds,
      });
    case "ATTACHMENTS_RESOLUTION_FAILED":
      return managerError("ATTACHMENTS_RESOLUTION_FAILED", error.message, {
        attachmentIds: error.attachmentIds,
      });
    default: {
      const exhaustiveCheck: never = error;
      throw new Error(
        `Unhandled attachment resolution error: ${JSON.stringify(exhaustiveCheck)}`,
      );
    }
  }
}

export interface SpriteAgentProcessManagerDeps {
  env: Env;
  logger: Logger;
  secretRepository: SecretRepository;
  getServerState: () => ServerState;
  updateAgentProcessId: (agentProcessId: number | null) => void;
  getClientState: () => ClientState;
}

export interface DispatchMessageInput {
  userMessage: {
    id: string;
    content: string | undefined;
    attachmentIds: string[];
  };
  model?: string;
  agentMode?: AgentMode;
}

export type DispatchMessageResult = Result<
  { agentProcessId: number },
  SpriteAgentProcessManagerError
>;

/**
 * Owns the lifecycle of the vm-agent process on the sprite for a session.
 *
 * In v1, every turn spawns a fresh process (cold-path only). The initial
 * user message is passed via CLI args at spawn, and chunks flow back to the
 * DO through HTTPS webhooks — no long-lived websocket is held open here.
 *
 * `cancelActiveTurn()` terminates the active exec session. `kill()` does the
 * same and is used on session delete.
 */
export class SpriteAgentProcessManager {
  private readonly env: Env;
  private readonly logger: Logger;
  private readonly secretRepository: SecretRepository;
  private readonly getServerState: () => ServerState;
  private readonly updateAgentProcessId: SpriteAgentProcessManagerDeps["updateAgentProcessId"];
  private readonly getClientState: () => ClientState;
  private readonly attachmentService: AgentAttachmentService;

  /** In-flight spawn promise, or null if no spawn is running. */
  private startMutex: Promise<DispatchMessageResult> | null = null;

  constructor(deps: SpriteAgentProcessManagerDeps) {
    this.env = deps.env;
    this.logger = deps.logger.scope("sprite-agent-process-manager");
    this.secretRepository = deps.secretRepository;
    this.getServerState = deps.getServerState;
    this.updateAgentProcessId = deps.updateAgentProcessId;
    this.getClientState = deps.getClientState;
    this.attachmentService = new AgentAttachmentService(deps.env, this.logger);
  }

  /**
   * Spawns a fresh vm-agent process on the sprite with the given user message
   * as its initial turn. Concurrent callers share a single in-flight spawn so
   * back-to-back dispatches cannot race to spawn two processes.
   */
  async dispatchMessage(input: DispatchMessageInput): Promise<DispatchMessageResult> {
    if (this.startMutex) return this.startMutex;

    const spawn = (async (): Promise<DispatchMessageResult> => {
      try {
        return await this.doSpawn(input);
      } finally {
        this.startMutex = null;
      }
    })();
    this.startMutex = spawn;
    return spawn;
  }

  /** Terminates the active agent process. */
  async cancelActiveTurn(): Promise<void> {
    const serverState = this.getServerState();
    const processId = serverState.agentProcessId;
    const spriteName = serverState.spriteName;
    if (!processId || !spriteName) {
      this.logger.debug("No active agent process to cancel");
      return;
    }

    const sprite = new WorkersSpriteClient(
      spriteName,
      this.env.SPRITES_API_KEY,
      this.env.SPRITES_API_URL,
    );
    try {
      await sprite.killSession(processId, "SIGTERM");
      this.logger.debug("Agent process terminated");
    } catch (error) {
      if (error instanceof SpritesError && error.statusCode === 404) {
        this.logger.debug("Agent process already gone on cancel");
        return;
      }
      this.logger.warn("Failed to terminate agent process", {
        error,
        fields: { processId },
      });
    }
  }

  /** Force-kills the active agent process. Used on session delete. */
  async kill(): Promise<void> {
    const serverState = this.getServerState();
    const processId = serverState.agentProcessId;
    const spriteName = serverState.spriteName;
    if (!processId || !spriteName) return;

    const sprite = new WorkersSpriteClient(
      spriteName,
      this.env.SPRITES_API_KEY,
      this.env.SPRITES_API_URL,
    );
    try {
      await sprite.killSession(processId, "SIGTERM");
    } catch (error) {
      if (!(error instanceof SpritesError && error.statusCode === 404)) {
        this.logger.warn("Failed to kill agent process", { error });
      }
    }
    this.updateAgentProcessId(null);
  }

  /**
   * Returns the per-session webhook bearer token, generating and persisting
   * it on first use.
   */
  ensureWebhookToken(): string {
    const existing = this.secretRepository.get("webhook_token");
    if (existing) return existing;
    const token = crypto.randomUUID() + crypto.randomUUID().replace(/-/g, "");
    this.secretRepository.set("webhook_token", token);
    return token;
  }

  // ============================================
  // Private
  // ============================================

  private async doSpawn(
    input: DispatchMessageInput,
  ): Promise<DispatchMessageResult> {
    const serverState = this.getServerState();
    const clientState = this.getClientState();
    const sessionId = serverState.sessionId;
    const spriteName = serverState.spriteName;
    const userId = serverState.userId;

    if (!sessionId || !spriteName || !serverState.repoCloned) {
      return failure(
        managerError("SESSION_NOT_READY", "Session provisioning is not complete"),
      );
    }
    if (!userId) {
      return failure(managerError("USER_NOT_FOUND", "Session user id is missing"));
    }

    const settings: AgentSettings = input.model
      ? ({ ...clientState.agentSettings, model: input.model } as AgentSettings)
      : clientState.agentSettings;
    const agentMode: AgentMode = input.agentMode ?? clientState.agentMode;

    const attachmentsResult = await this.attachmentService.resolveAttachments(
      sessionId,
      input.userMessage.attachmentIds,
    );
    if (!attachmentsResult.ok) {
      return failure(mapAttachmentResolutionError(attachmentsResult.error));
    }
    const resolvedAttachments = attachmentsResult.value.agentAttachments;

    const credentialResult = await this.loadCredentialSnapshot(settings, userId);
    if (!credentialResult.ok) {
      return failure(credentialResult.error);
    }
    const credentialSnapshot = credentialResult.value;

    const sprite = new WorkersSpriteClient(
      spriteName,
      this.env.SPRITES_API_KEY,
      this.env.SPRITES_API_URL,
    );

    await this.writeCredentialFiles(sprite, credentialSnapshot);
    await this.writeVmAgentScript(sprite);

    const webhookToken = this.ensureWebhookToken();
    const webhookUrl = this.buildWebhookUrl(sessionId);

    const initialMessageWithAttachments: AgentInputMessage = {
      content: input.userMessage.content,
      attachments:
        resolvedAttachments.length > 0
          ? (resolvedAttachments as AgentInputAttachment[])
          : undefined,
    };

    // Wrap bun in a shell so we can redirect stdout/stderr to a log file on
    // the sprite. The child stdin is /dev/null because webhook-mode is
    // spawn-and-forget: the initial turn is already in argv and control
    // messages must not keep the process coupled to websocket-backed stdin.
    // `exec` replaces the shell with bun so we don't leak a wrapper process.
    // "$@" preserves argv boundaries so JSON args with spaces/quotes stay
    // intact.
    const agentArgs = this.buildAgentArgs({
      settings,
      agentMode,
      initialMessage: initialMessageWithAttachments,
      userMessageId: input.userMessage.id,
      agentSessionId: serverState.agentSessionId ?? undefined,
      model: input.model,
    });
    const logPath = `${VM_AGENT_LOG_DIR}/${sessionId}.log`;
    // Run inside a shell so we can tee stdout/stderr to both the sprite exec
    // TTY and a log file. Sprites only appear to keep detached sessions awake
    // while there is TTY output, so plain file redirection is not enough. We
    // intentionally do NOT wrap with setsid/nohup — `detachable: true` puts
    // the process inside a tmux session on the sprite, and setsid would tear
    // it out of tmux's session group, breaking the keep-running behavior.
    const session = sprite.createSession(
      "sh",
      [
        "-c",
        `mkdir -p ${VM_AGENT_LOG_DIR} && bun "$@" 2>&1 | tee -a ${logPath}`,
        "vm-agent",
        ...agentArgs,
      ],
      {
        cwd: WORKSPACE_DIR,
        // TTY + detachable matches the sprite docs example for sessions that
        // "stay alive after disconnect". Without TTY, sessions appear to be
        // suspended once the spawn websocket closes regardless of
        // `maxRunAfterDisconnect`. Output is redirected to a log file inside
        // the shell wrapper, so we never actually write to the PTY.
        tty: true,
        detachable: true,
        env: {
          SESSION_ID: sessionId,
          DO_WEBHOOK_URL: webhookUrl,
          DO_WEBHOOK_TOKEN: webhookToken,
          ...credentialSnapshot.envVars,
        },
        idleTimeoutMs: 45_000,
        // maxRunAfterDisconnect: "0",
      },
    );

    try {
      const processId = await this.startAndCaptureProcessId(session);
      this.updateAgentProcessId(processId);
      return success({ agentProcessId: processId });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : String(error);
      return failure(managerError("SPAWN_FAILED", message, { cause: message }));
    } finally {
      // Close our setup websocket. The vm-agent keeps running on the sprite
      // for up to maxRunAfterDisconnect.
      try {
        await new Promise((resolve) => setTimeout(resolve, 2_000));
        session.close();
      } catch (error) {
        this.logger.debug("Failed to close setup websocket", { error });
      }
    }
  }

  private async loadCredentialSnapshot(
    settings: AgentSettings,
    userId: string,
  ): Promise<Result<AuthCredentialSnapshot, SpriteAgentProcessManagerError>> {
    const adapter = getProviderCredentialAdapter(
      settings.provider,
      this.env,
      this.logger,
    );
    const snapshot = await adapter.getCredentialSnapshot(userId);
    if (!snapshot.ok) {
      return failure(mapProviderCredentialError(snapshot.error));
    }
    return success(snapshot.value);
  }

  private async writeCredentialFiles(
    sprite: WorkersSpriteClient,
    snapshot: AuthCredentialSnapshot,
  ): Promise<void> {
    for (const file of snapshot.files) {
      await sprite.writeFile(
        file.path,
        file.contents,
        file.mode ? { mode: file.mode } : undefined,
      );
    }
  }

  private async writeVmAgentScript(sprite: WorkersSpriteClient): Promise<void> {
    await sprite.writeFile(
      `${HOME_DIR}/.cloude/agent-webhook.js`,
      VM_AGENT_WEBHOOK_SCRIPT,
    );
  }

  private buildAgentArgs(args: {
    settings: AgentSettings;
    agentMode: AgentMode;
    initialMessage: AgentInputMessage;
    userMessageId: string;
    agentSessionId: string | undefined;
    model: string | undefined;
  }): string[] {
    const cliArgs = [
      "run",
      `${HOME_DIR}/.cloude/agent-webhook.js`,
      "--provider",
      JSON.stringify(args.settings),
      "--agentMode",
      args.agentMode,
      "--initialMessage",
      JSON.stringify(args.initialMessage),
      "--userMessageId",
      args.userMessageId,
    ];
    if (args.agentSessionId) {
      cliArgs.push("--sessionId", args.agentSessionId);
    }
    if (args.model) {
      cliArgs.push("--model", args.model);
    }
    return cliArgs;
  }

  private buildWebhookUrl(sessionId: string): string {
    return `${this.env.WORKER_URL}/internal/session/${sessionId}`;
  }

  /**
   * Waits for the sprite exec's `session_info` frame so we can capture the
   * process id, with a 10s timeout. Runs concurrently with the websocket
   * start() — session_info is pushed automatically once the process boots.
   */
  private async startAndCaptureProcessId(
    session: SpriteWebsocketSession,
  ): Promise<number> {
    let processId: number | null = null;
    let resolveProcessId: (id: number) => void = () => {};
    const processIdPromise = new Promise<number>((resolve) => {
      resolveProcessId = resolve;
    });

    session.onServerMessage((message: SpriteServerMessage) => {
      if (message.type === "session_info" && processId === null) {
        processId = message.session_id;
        this.logger.debug(`captured agent process id: ${processId}`);
        resolveProcessId(processId);
      }
    });

    await session.start();

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(
        () =>
          reject(
            managerError(
              "TURN_DID_NOT_START",
              "Timed out waiting for vm-agent session_info",
            ),
          ),
        10_000,
      );
    });

    return Promise.race([processIdPromise, timeoutPromise]);
  }
}
