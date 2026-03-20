import type { UIMessageChunk } from "ai";
import {
  type AgentOutput,
  type AgentInputAttachment,
  type ClientState,
  type Logger,
  type ServerMessage,
  type SessionSettings,
  decodeAgentOutput,
  encodeAgentInput,
} from "@repo/shared";
import {
  WorkersSprite,
  SpritesCoordinator,
  type SpriteWebsocketSession,
  type SpriteServerMessage,
} from "@/lib/sprites";
import type { Env } from "@/types";
import VM_AGENT_SCRIPT from "@repo/vm-agent/dist/vm-agent.bundle.js";
import { MessageAccumulator } from "@/lib/message-accumulator";
import { applyDerivedStateFromParts } from "@/durable-objects/session-agent-derived-state";
import type { MessageRepository } from "@/durable-objects/repositories/message-repository";
import type { LatestPlanRepository } from "@/durable-objects/repositories/latest-plan-repository";
import type { ServerState } from "@/durable-objects/repositories/server-state-repository";

const HOME_DIR = "/home/sprite";
const WORKSPACE_DIR = "/home/sprite/workspace";

export interface StartAgentParams {
  spriteName: string;
  agentSessionId: string | null;
  settings: SessionSettings;
  sessionId: string;
  /** Provider-specific environment variables (credentials, etc.) */
  envVars: Record<string, string>;
}

export interface AgentProcessManagerOptions {
  logger: Logger;
  env: Env;
  spritesCoordinator: SpritesCoordinator;
  messageRepository: MessageRepository;
  latestPlanRepository: LatestPlanRepository;
  broadcastMessage: (msg: ServerMessage) => void;
  updateClientState: (partial: Partial<ClientState>) => void;
  updateServerState: (partial: Partial<ServerState>) => void;
  getClientState: () => ClientState;
}

/**
 * Manages the lifecycle of the agent process WebSocket session running on a Sprite VM.
 * Handles all agent I/O: stdout/stderr parsing, chunk streaming, and message accumulation.
 */
export class AgentProcessManager {
  private readonly logger: Logger;
  private readonly env: Env;
  private readonly spritesCoordinator: SpritesCoordinator;
  private readonly messageRepository: MessageRepository;
  private readonly latestPlanRepository: LatestPlanRepository;
  private readonly broadcastMessage: (msg: ServerMessage) => void;
  private readonly updateClientState: (partial: Partial<ClientState>) => void;
  private readonly updateServerState: (partial: Partial<ServerState>) => void;
  private readonly getClientState: () => ClientState;

  private agentWebsocketSession: SpriteWebsocketSession | null = null;
  private pendingChunks: UIMessageChunk[] = [];
  private messageAccumulator: MessageAccumulator = new MessageAccumulator();
  private agentStdoutBuffer = "";

  constructor(options: AgentProcessManagerOptions) {
    this.logger = options.logger.scope("agent-process-manager");
    this.env = options.env;
    this.spritesCoordinator = options.spritesCoordinator;
    this.messageRepository = options.messageRepository;
    this.latestPlanRepository = options.latestPlanRepository;
    this.broadcastMessage = options.broadcastMessage;
    this.updateClientState = options.updateClientState;
    this.updateServerState = options.updateServerState;
    this.getClientState = options.getClientState;
  }

  isConnected(): boolean {
    return this.agentWebsocketSession?.isConnected ?? false;
  }

  getPendingChunks(): UIMessageChunk[] {
    return this.pendingChunks;
  }

  cancel(): void {
    if (this.agentWebsocketSession) {
      this.agentWebsocketSession.write(encodeAgentInput({ type: "cancel" }) + "\n");
    }
  }

  /**
   * Starts a new agent process session on the sprite VM.
   * Writes the agent script, launches the process, and attaches stdin/stdout handlers.
   */
  async startAgentSession(params: StartAgentParams): Promise<void> {
    const { spriteName, agentSessionId, settings, sessionId, envVars } = params;
    const sprite = new WorkersSprite(spriteName, this.env.SPRITES_API_KEY, this.env.SPRITES_API_URL);

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
  async sendMessage(
    content: string | undefined,
    attachments: AgentInputAttachment[],
    model?: string,
  ): Promise<void> {
    if (!this.agentWebsocketSession) {
      throw new Error("Agent session not connected");
    }
    this.updateClientState({ isResponding: true });
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

  private setupAgentSessionHandlers(session: SpriteWebsocketSession): void {
    session.onStdout((data: string) => {
      this.handleAgentStdout(data);
    });

    session.onStderr((data: string) => {
      this.logger.error(`vm-agent stderr: ${data}`);
    });

    session.onExit((code: number) => {
      this.logger.info(`vm-agent exited with code ${code}`);
      this.agentStdoutBuffer = "";
      this.agentWebsocketSession = null;
      // Clear any in-progress chunk buffer if agent exits mid-stream
      this.pendingChunks = [];
      this.messageAccumulator.reset();
      this.updateClientState({ isResponding: false });
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
    switch (output.type) {
      case "ready": {
        this.broadcastMessage({ type: "agent.ready" });
        break;
      }
      case "error": {
        this.logger.error(`vm-agent error: ${output.error}`);
        this.broadcastMessage({
          type: "error",
          code: "AGENT_ERROR",
          message: output.error,
        });
        break;
      }
      case "debug": {
        this.logger.debug(`[vm-agent debug] ${output.message}`);
        break;
      }
      case "stream": {
        // Buffer chunk for reconnect replay
        this.pendingChunks.push(output.chunk as UIMessageChunk);

        this.broadcastMessage({
          type: "agent.chunk",
          chunk: output.chunk,
        });

        // Accumulate chunks into UIMessage and extract derived state (todos, plan)
        const { finished, completedParts } = this.messageAccumulator.process(
          output.chunk as UIMessageChunk,
        );
        applyDerivedStateFromParts(
          {
            state: this.getClientState(),
            latestPlanRepository: this.latestPlanRepository,
            updatePartialState: (partial) => this.updateClientState(partial),
          },
          completedParts,
          this.messageAccumulator.getMessageId(),
        );

        if (finished) {
          const message = this.messageAccumulator.getMessage();
          const state = this.getClientState();
          if (message && state.sessionId) {
            const stored = this.messageRepository.create(state.sessionId, message);
            this.broadcastMessage({
              type: "agent.finish",
              message: stored.message,
            });
          }

          // Reset accumulator and chunk buffer for next message
          this.messageAccumulator.reset();
          this.pendingChunks = [];
          this.updateClientState({ isResponding: false });
        }
        break;
      }
      case "sessionId": {
        // Persist the agent provider's session ID so it can be resumed on reconnect
        this.logger.info(`Storing agent session ID: ${output.sessionId}`);
        this.updateServerState({ agentSessionId: output.sessionId });
        break;
      }
    }
  }

  private handleAgentServerMessage(msg: SpriteServerMessage): void {
    switch (msg.type) {
      case "session_info":
        // session_id here is the OS process ID of the agent, not the agent's own session ID
        this.logger.info(`vm-agent process id: ${JSON.stringify(msg.session_id)}`);
        this.updateServerState({ lastKnownAgentProcessId: msg.session_id });
        break;
      default:
        break;
    }
  }
}
