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

vi.mock("@/lib/sprites", () => {
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

vi.mock("@/lib/providers/provider-credential-adapter", () => ({
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
import { SpritesError } from "@/lib/sprites";
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

  it("falls back to spawning when attached process exits before stdin ack", async () => {
    let exitHandler: ((code: number) => void) | undefined;
    const staleSession = {
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
});
