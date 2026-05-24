import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentSettings, ClientState, Logger } from "@repo/shared";
import type { Env } from "../../src/types";
import type { ServerState } from "../../src/durable-objects/repositories/server-state-repository";

const mockState = vi.hoisted(() => ({
  attachSession: vi.fn(),
  createSession: vi.fn(),
  execHttp: vi.fn(),
  writeFile: vi.fn(),
  killSession: vi.fn(),
  getCredentialSnapshot: vi.fn(),
  resolveAttachments: vi.fn(),
}));

vi.mock("@repo/vm-agent/dist/vm-agent-webhook.bundle.js", () => ({
  default: "// mocked vm-agent bundle",
}));

vi.mock("@/lib/providers/sprite-provider", () => {
  class SpritesError extends Error {
    constructor(
      message: string,
      public statusCode: number,
      public responseText?: string,
    ) {
      super(message);
    }
  }
  class WorkersSpriteClient {
    public name: string;
    constructor(name: string) {
      this.name = name;
    }
    attachSession = mockState.attachSession;
    createSession = mockState.createSession;
    execHttp = mockState.execHttp;
    writeFile = mockState.writeFile;
    killSession = mockState.killSession;
  }
  return { WorkersSpriteClient, SpritesError };
});

vi.mock("@/lib/providers/ai-credential-provider", () => ({
  getProviderCredentialAdapter: () => ({
    getCredentialSnapshot: mockState.getCredentialSnapshot,
  }),
}));

vi.mock("../../src/durable-objects/lib/agent-attachment-service", () => ({
  AgentAttachmentService: class {
    resolveAttachments = mockState.resolveAttachments;
  },
}));

import { encodeAgentInput, encodeAgentOutput } from "@repo/shared";
import { SpritesError } from "../../src/lib/sprites";
import { SpriteAgentProcessManager } from "../../src/durable-objects/lib/SpriteAgentProcessManager";

function createLogger(): Logger {
  return {
    log() {},
    debug() {},
    info() {},
    warn() {},
    error() {},
    scope() {
      return this;
    },
  };
}

const agentSettings: AgentSettings = {
  provider: "openai-codex",
  model: "gpt-5.3-codex",
  maxTokens: 8192,
};

function createClientState(): ClientState {
  return {
    sessionId: "session-1",
    status: "ready",
    repoFullName: "ben/repo",
    repoUrl: "https://github.com/ben/repo",
    baseBranch: "main",
    branchName: "cloude/session-1",
    agentSettings,
    agentMode: "edit",
    messages: [],
    todos: null,
    plan: null,
    latestPr: null,
    editorUrl: null,
    lastError: null,
    pulledBranch: null,
    pullRequest: null,
    pushedBranch: null,
    pendingUserMessage: null,
    activeTurn: null,
    providerConnection: null,
    createdAt: new Date(),
  } as ClientState;
}

function createServerState(overrides: Partial<ServerState> = {}): ServerState {
  return {
    sessionId: "session-1",
    userId: "user-1",
    spriteName: "sprite-1",
    repoCloned: true,
    agentSessionId: "provider-session-1",
    agentProcessId: null,
    activeUserMessageId: null,
    webhookToken: null,
    ...overrides,
  } as ServerState;
}

function createManager(serverState: ServerState) {
  const updateAgentProcessId = vi.fn((agentProcessId: number | null) => {
    serverState.agentProcessId = agentProcessId;
  });
  const manager = new SpriteAgentProcessManager({
    env: {
      SPRITES_API_KEY: "sprites-key",
      SPRITES_API_URL: "https://api.sprites.test",
      WORKER_URL: "https://worker.test",
    } as Env,
    logger: createLogger(),
    secretRepository: {
      get: vi.fn(() => "webhook-token"),
      set: vi.fn(),
      delete: vi.fn(),
    } as never,
    getServerState: () => serverState,
    updateAgentProcessId,
    getClientState: createClientState,
  });

  return { manager, updateAgentProcessId };
}

describe("SpriteAgentProcessManager", () => {
  beforeEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
    mockState.getCredentialSnapshot.mockResolvedValue({
      ok: true,
      value: { envVars: {}, files: [] },
    });
    mockState.resolveAttachments.mockResolvedValue({
      ok: true,
      value: { agentAttachments: [] },
    });
    mockState.execHttp.mockResolvedValue({ stdout: "", stderr: "", exitCode: 1 });
    mockState.writeFile.mockResolvedValue(undefined);
    mockState.killSession.mockResolvedValue(undefined);
  });

  it("gracefully cancels the active turn with a matching cancel ack", async () => {
    let stdoutHandler: ((chunk: string) => void) | undefined;
    const existingSession = {
      start: vi.fn().mockResolvedValue(undefined),
      write: vi.fn(() => {
        stdoutHandler?.(
          encodeAgentOutput({
            type: "cancel_ack",
            userMessageId: "user-message-2",
          }) + "\n",
        );
      }),
      close: vi.fn(),
      onStdout: vi.fn((handler) => {
        stdoutHandler = handler;
        return vi.fn();
      }),
      onError: vi.fn(() => vi.fn()),
      onExit: vi.fn(() => vi.fn()),
    };
    mockState.attachSession.mockReturnValue(existingSession);

    const serverState = createServerState({
      agentProcessId: 42,
      activeUserMessageId: "user-message-2",
    });
    const { manager, updateAgentProcessId } = createManager(serverState);

    const result = await manager.cancelActiveTurn();

    expect(result).toEqual({ processPreserved: true });
    expect(existingSession.write).toHaveBeenCalledWith(
      encodeAgentInput({ type: "cancel", userMessageId: "user-message-2" }) + "\n",
    );
    expect(mockState.killSession).not.toHaveBeenCalled();
    expect(updateAgentProcessId).not.toHaveBeenCalledWith(null);
  });

  it("kills the active process when cancel ack times out", async () => {
    vi.useFakeTimers();
    let stdoutHandler: ((chunk: string) => void) | undefined;
    const existingSession = {
      start: vi.fn().mockResolvedValue(undefined),
      write: vi.fn(() => {
        stdoutHandler?.(
          encodeAgentOutput({
            type: "cancel_ack",
            userMessageId: "different-message",
          }) + "\n",
        );
      }),
      close: vi.fn(),
      onStdout: vi.fn((handler) => {
        stdoutHandler = handler;
        return vi.fn();
      }),
      onError: vi.fn(() => vi.fn()),
      onExit: vi.fn(() => vi.fn()),
    };
    mockState.attachSession.mockReturnValue(existingSession);

    const serverState = createServerState({
      agentProcessId: 42,
      activeUserMessageId: "user-message-2",
    });
    const { manager, updateAgentProcessId } = createManager(serverState);

    const cancelPromise = manager.cancelActiveTurn();
    await vi.advanceTimersByTimeAsync(2_000);
    const result = await cancelPromise;

    expect(result).toEqual({ processPreserved: false });
    expect(mockState.killSession).toHaveBeenCalledWith(42, "SIGTERM");
    expect(updateAgentProcessId).toHaveBeenCalledWith(null);
    vi.useRealTimers();
  });

  it("attaches to an idle vm-agent process and sends the new message on stdin", async () => {
    let stdoutHandler: ((chunk: string) => void) | undefined;
    const existingSession = {
      start: vi.fn().mockResolvedValue(undefined),
      write: vi.fn(() => {
        stdoutHandler?.("debug log\n");
        stdoutHandler?.(
          encodeAgentOutput({
            type: "stdin_ack",
            userMessageId: "user-message-2",
          }) + "\n",
        );
      }),
      close: vi.fn(),
      onStdout: vi.fn((handler) => {
        stdoutHandler = handler;
        return vi.fn();
      }),
      onError: vi.fn(() => vi.fn()),
      onExit: vi.fn(() => vi.fn()),
    };
    mockState.attachSession.mockReturnValue(existingSession);

    const serverState = createServerState({ agentProcessId: 42 });
    const { manager, updateAgentProcessId } = createManager(serverState);

    const result = await manager.dispatchMessage({
      userMessage: { id: "user-message-2", content: "second turn", attachmentIds: [] },
      model: "gpt-5.2-codex",
      agentMode: "plan",
    });

    expect(result.ok).toBe(true);
    expect(mockState.attachSession).toHaveBeenCalledWith("42", { idleTimeoutMs: 10_000 });
    expect(existingSession.start).toHaveBeenCalledOnce();
    expect(existingSession.write).toHaveBeenCalledWith(
      encodeAgentInput({
        type: "chat",
        userMessageId: "user-message-2",
        message: { content: "second turn" },
        model: "gpt-5.2-codex",
        agentMode: "plan",
      }) + "\n",
    );
    expect(existingSession.close).toHaveBeenCalledOnce();
    expect(mockState.createSession).not.toHaveBeenCalled();
    expect(updateAgentProcessId).not.toHaveBeenCalledWith(null);
  });

  it("waits for a stdin ack split across stdout chunks", async () => {
    let stdoutHandler: ((chunk: string) => void) | undefined;
    const existingSession = {
      start: vi.fn().mockResolvedValue(undefined),
      write: vi.fn(() => {
        const ackLine =
          encodeAgentOutput({
            type: "stdin_ack",
            userMessageId: "user-message-2",
          }) + "\n";
        stdoutHandler?.(ackLine.slice(0, 12));
        stdoutHandler?.(ackLine.slice(12));
      }),
      close: vi.fn(),
      onStdout: vi.fn((handler) => {
        stdoutHandler = handler;
        return vi.fn();
      }),
      onError: vi.fn(() => vi.fn()),
      onExit: vi.fn(() => vi.fn()),
    };
    mockState.attachSession.mockReturnValue(existingSession);

    const serverState = createServerState({ agentProcessId: 42 });
    const { manager, updateAgentProcessId } = createManager(serverState);

    const result = await manager.dispatchMessage({
      userMessage: { id: "user-message-2", content: "second turn", attachmentIds: [] },
      model: "gpt-5.2-codex",
      agentMode: "plan",
    });

    expect(result.ok).toBe(true);
    expect(existingSession.write).toHaveBeenCalledWith(
      encodeAgentInput({
        type: "chat",
        userMessageId: "user-message-2",
        message: { content: "second turn" },
        model: "gpt-5.2-codex",
        agentMode: "plan",
      }) + "\n",
    );
    expect(existingSession.close).toHaveBeenCalledOnce();
    expect(mockState.createSession).not.toHaveBeenCalled();
    expect(updateAgentProcessId).not.toHaveBeenCalledWith(null);
  });

  it("spawns a fresh process when an attached process exits after stdin write without ack", async () => {
    let exitHandler: ((code: number) => void) | undefined;
    const uncertainSession = {
      start: vi.fn().mockResolvedValue(undefined),
      write: vi.fn(() => {
        exitHandler?.(1);
      }),
      close: vi.fn(),
      onStdout: vi.fn(() => vi.fn()),
      onError: vi.fn(() => vi.fn()),
      onExit: vi.fn((handler) => {
        exitHandler = handler;
        return vi.fn();
      }),
    };
    const spawnSession = {
      start: vi.fn().mockResolvedValue(undefined),
      close: vi.fn(),
      onServerMessage: vi.fn((handler) => {
        handler({ type: "session_info", session_id: 84, tty: true });
        return vi.fn();
      }),
    };
    mockState.attachSession.mockReturnValue(uncertainSession);
    mockState.createSession.mockReturnValue(spawnSession);

    const serverState = createServerState({ agentProcessId: 42 });
    const { manager, updateAgentProcessId } = createManager(serverState);

    const result = await manager.dispatchMessage({
      userMessage: { id: "user-message-3", content: "fresh turn", attachmentIds: [] },
    });

    expect(result.ok).toBe(true);
    expect(updateAgentProcessId).toHaveBeenCalledWith(null);
    expect(mockState.killSession).toHaveBeenCalledWith(42, "SIGTERM");
    expect(mockState.createSession).toHaveBeenCalledOnce();
    expect(updateAgentProcessId).toHaveBeenLastCalledWith(84);
  });

  it("fails when an attached process does not ack and cannot be stopped", async () => {
    let exitHandler: ((code: number) => void) | undefined;
    const uncertainSession = {
      start: vi.fn().mockResolvedValue(undefined),
      write: vi.fn(() => {
        exitHandler?.(1);
      }),
      close: vi.fn(),
      onStdout: vi.fn(() => vi.fn()),
      onError: vi.fn(() => vi.fn()),
      onExit: vi.fn((handler) => {
        exitHandler = handler;
        return vi.fn();
      }),
    };
    mockState.attachSession.mockReturnValue(uncertainSession);
    mockState.killSession.mockRejectedValue(new Error("kill failed"));

    const serverState = createServerState({ agentProcessId: 42 });
    const { manager, updateAgentProcessId } = createManager(serverState);

    const result = await manager.dispatchMessage({
      userMessage: { id: "user-message-3", content: "fresh turn", attachmentIds: [] },
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("TURN_DID_NOT_START");
    }
    expect(updateAgentProcessId).toHaveBeenCalledWith(null);
    expect(mockState.killSession).toHaveBeenCalledWith(42, "SIGTERM");
    expect(mockState.createSession).not.toHaveBeenCalled();
  });

  it("resets a stale process id and falls back to spawning when attach returns 404", async () => {
    const staleSession = {
      start: vi.fn().mockRejectedValue(new SpritesError("not found", 404)),
      write: vi.fn(),
      close: vi.fn(),
      onServerMessage: vi.fn((handler) => {
        handler({ type: "session_info", session_id: 84, tty: true });
        return vi.fn();
      }),
    };
    const spawnSession = {
      start: vi.fn().mockResolvedValue(undefined),
      close: vi.fn(),
      onServerMessage: vi.fn((handler) => {
        handler({ type: "session_info", session_id: 84, tty: true });
        return vi.fn();
      }),
    };
    mockState.attachSession.mockReturnValue(staleSession);
    mockState.createSession.mockReturnValue(spawnSession);

    const serverState = createServerState({ agentProcessId: 42 });
    const { manager, updateAgentProcessId } = createManager(serverState);

    const result = await manager.dispatchMessage({
      userMessage: { id: "user-message-3", content: "fresh turn", attachmentIds: [] },
    });

    expect(result.ok).toBe(true);
    expect(updateAgentProcessId).toHaveBeenCalledWith(null);
    expect(mockState.createSession).toHaveBeenCalledOnce();
    expect(updateAgentProcessId).toHaveBeenLastCalledWith(84);
  });

  it("returns a spawn failure when sprite setup file writes fail", async () => {
    mockState.getCredentialSnapshot.mockResolvedValue({
      ok: true,
      value: {
        envVars: {},
        files: [
          {
            path: "/home/sprite/.codex/auth.json",
            contents: "{}",
            mode: "0600",
          },
        ],
      },
    });
    mockState.writeFile.mockRejectedValue(
      new SpritesError("Failed to write file /home/sprite/.codex/auth.json: 503", 503),
    );

    const serverState = createServerState();
    const { manager } = createManager(serverState);

    const result = await manager.dispatchMessage({
      userMessage: { id: "user-message-4", content: "fresh turn", attachmentIds: [] },
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("SPAWN_FAILED");
      expect(result.error.message).toBe(
        "Failed to write file /home/sprite/.codex/auth.json: 503",
      );
    }
    expect(mockState.createSession).not.toHaveBeenCalled();
  });
});
