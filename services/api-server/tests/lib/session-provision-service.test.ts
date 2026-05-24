import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ClientState, Logger } from "@repo/shared";
import type { Env } from "../../src/types";
import type { ServerState } from "../../src/durable-objects/repositories/server-state-repository";
import { SessionProvisionService } from "../../src/durable-objects/lib/SessionProvisionService";

const mockState = vi.hoisted(() => ({
  events: [] as string[],
  setNetworkPolicy: vi.fn(),
  execHttp: vi.fn(),
  ensureSpriteStartupToolchain: vi.fn(),
  configureGitRemote: vi.fn(),
  getReadOnlyTokenForRepo: vi.fn(),
}));

vi.mock("@/lib/sprites", () => {
  class WorkersSpriteClient {
    public name: string;
    constructor(name: string) {
      this.name = name;
    }
    setNetworkPolicy = mockState.setNetworkPolicy;
    execHttp = mockState.execHttp;
  }
  return { WorkersSpriteClient };
});

vi.mock("@/lib/sprites/startup-toolchain", () => ({
  ensureSpriteStartupToolchain: mockState.ensureSpriteStartupToolchain,
}));

vi.mock("@/lib/git-setup", () => ({
  configureGitRemote: mockState.configureGitRemote,
}));

vi.mock("@/lib/github/github-app", () => ({
  GitHubAppService: class {
    getReadOnlyTokenForRepo = mockState.getReadOnlyTokenForRepo;
  },
}));

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

function createClientState(): ClientState {
  return {
    repoFullName: "ben/repo",
    baseBranch: "main",
    agentSettings: {
      provider: "openai-codex",
      model: "gpt-5.5",
      maxTokens: 8192,
    },
  } as ClientState;
}

function createServerState(overrides: Partial<ServerState> = {}): ServerState {
  return {
    initialized: true,
    sessionId: "session-1",
    userId: "user-1",
    spriteName: null,
    repoCloned: false,
    agentSessionId: null,
    agentProcessId: null,
    activeUserMessageId: null,
    startupToolchain: null,
    ...overrides,
  };
}

function createService(
  serverState: ServerState,
  clientState: ClientState,
  envOverrides: Partial<Env> = {},
) {
  const updateServerState = vi.fn((partial: Partial<ServerState>) => {
    Object.assign(serverState, partial);
  });
  const updatePartialState = vi.fn();
  const spritesCoordinator = {
    createSprite: vi.fn(async () => {
      mockState.events.push("createSprite");
      return { name: "sprite-1", status: "running" };
    }),
  };

  const service = new SessionProvisionService({
    logger: createLogger(),
    env: {
      SPRITES_API_KEY: "sprites-key",
      SPRITES_API_URL: "https://api.sprites.test",
      WORKER_URL: "https://worker.test",
      ...envOverrides,
    } as Env,
    spritesCoordinator: spritesCoordinator as never,
    getServerState: () => serverState,
    getClientState: () => clientState,
    updateServerState,
    updatePartialState,
    synthesizeStatus: () => "provisioning",
    refreshGitHubToken: vi.fn(async () => undefined),
    ensureGitProxySecret: vi.fn(() => "git-proxy-secret"),
  });

  return { service, updateServerState, spritesCoordinator };
}

describe("SessionProvisionService startup toolchain", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockState.events.length = 0;
    mockState.setNetworkPolicy.mockImplementation(async () => {
      mockState.events.push("setNetworkPolicy");
    });
    mockState.ensureSpriteStartupToolchain.mockImplementation(async () => {
      mockState.events.push("startupToolchain");
      return {
        ok: true,
        value: {
          contractHash: "hash-1",
          checkedAt: 1,
          results: [],
        },
      };
    });
    mockState.execHttp.mockImplementation(async (command: string) => {
      if (command.startsWith("test -d")) {
        mockState.events.push("cloneCheck");
        return { stdout: "empty", stderr: "", exitCode: 0 };
      }
      if (command.startsWith("mkdir -p")) {
        return { stdout: "", stderr: "", exitCode: 0 };
      }
      if (command.includes("git -c")) {
        mockState.events.push("cloneRepo");
        return { stdout: "", stderr: "", exitCode: 0 };
      }
      if (command.includes("git rev-parse")) {
        return { stdout: "main", stderr: "", exitCode: 0 };
      }
      return { stdout: "", stderr: "", exitCode: 0 };
    });
    mockState.getReadOnlyTokenForRepo.mockResolvedValue({
      ok: true,
      value: "readonly-token",
    });
    mockState.configureGitRemote.mockResolvedValue(undefined);
  });

  it("runs startup toolchain after network policy and before clone", async () => {
    const serverState = createServerState();
    const { service, updateServerState } = createService(
      serverState,
      createClientState(),
    );

    await service.ensureProvisioned();

    expect(mockState.events).toEqual([
      "createSprite",
      "setNetworkPolicy",
      "startupToolchain",
      "cloneCheck",
      "cloneRepo",
    ]);
    expect(updateServerState).toHaveBeenCalledWith({
      startupToolchain: {
        contractHash: "hash-1",
        checkedAt: 1,
        results: [],
      },
    });
    expect(mockState.ensureSpriteStartupToolchain).toHaveBeenCalledWith(
      expect.objectContaining({
        codexMinVersion: undefined,
      }),
    );
  });

  it("passes CODEX_MIN_VERSION to startup toolchain checks", async () => {
    const serverState = createServerState();
    const { service } = createService(
      serverState,
      createClientState(),
      { CODEX_MIN_VERSION: "0.140.0" },
    );

    await service.ensureProvisioned();

    expect(mockState.ensureSpriteStartupToolchain).toHaveBeenCalledWith(
      expect.objectContaining({
        codexMinVersion: "0.140.0",
      }),
    );
  });

  it("blocks clone when startup toolchain fails", async () => {
    mockState.ensureSpriteStartupToolchain.mockImplementation(async () => {
      mockState.events.push("startupToolchain");
      return {
        ok: false,
        error: {
          domain: "startup_toolchain",
          code: "CHECK_FAILED",
          message: "Codex CLI repair script failed.",
          provider: "openai-codex",
          checkId: "openai-codex.cli",
        },
      };
    });

    const serverState = createServerState();
    const { service } = createService(serverState, createClientState());

    await expect(service.ensureProvisioned()).rejects.toThrow(
      "Codex CLI repair script failed.",
    );
    expect(mockState.events).toEqual([
      "createSprite",
      "setNetworkPolicy",
      "startupToolchain",
    ]);
    expect(mockState.configureGitRemote).not.toHaveBeenCalled();
  });
});
