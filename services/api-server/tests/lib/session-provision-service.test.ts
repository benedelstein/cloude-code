import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ClientState, Logger, SessionRuntimeConfigSnapshot } from "@repo/shared";
import type { Env } from "../../src/shared/types";
import type { ServerState } from "../../src/modules/session-agent/repositories/server-state.repository";
import { SessionProvisionService } from "../../src/modules/session-agent/services/session-provision.service";

const mockState = vi.hoisted(() => ({
  events: [] as string[],
  setNetworkPolicy: vi.fn(),
  execHttp: vi.fn(),
  ensureSpriteStartupToolchain: vi.fn(),
  configureGitRemote: vi.fn(),
  getReadOnlyTokenForRepo: vi.fn(),
}));

vi.mock("@/shared/integrations/sprites/WorkersSpriteClient", () => {
  class WorkersSpriteClient {
    public name: string;
    constructor(name: string) {
      this.name = name;
    }
    setNetworkPolicy = mockState.setNetworkPolicy;
    execHttp = mockState.execHttp;
  }
  return {
    WorkersSpriteClient,
  };
});

vi.mock("@/shared/integrations/sprites/network-policy", () => ({
  buildBootstrapNetworkPolicy: () => [{ domain: "bootstrap", action: "allow" }],
  buildFinalNetworkPolicy: () => [{ domain: "final", action: "allow" }],
}));

vi.mock("@/shared/integrations/sprites/startup-toolchain", () => ({
  ensureSpriteStartupToolchain: mockState.ensureSpriteStartupToolchain,
}));

vi.mock("@/shared/integrations/git/git-setup.service", () => ({
  configureGitRemote: mockState.configureGitRemote,
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
    startupScriptCompleted: false,
    finalNetworkPolicyApplied: false,
    ...overrides,
  };
}

function createRuntimeConfig(
  overrides: Partial<SessionRuntimeConfigSnapshot> = {},
): SessionRuntimeConfigSnapshot {
  return {
    sourceEnvironmentId: null,
    sourceEnvironmentName: null,
    repoId: 1,
    network: { mode: "default" },
    plainEnvVars: {},
    startupScript: null,
    resolvedAt: "2026-05-29T00:00:00.000Z",
    schemaVersion: 1,
    ...overrides,
  };
}

function createService(
  serverState: ServerState,
  clientState: ClientState,
  envOverrides: Partial<Env> = {},
  runtimeConfig: SessionRuntimeConfigSnapshot = createRuntimeConfig(),
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
    getRuntimeConfig: () => runtimeConfig,
    updateServerState,
    updatePartialState,
    synthesizeStatus: () => "provisioning",
    ensureGitProxySecret: vi.fn(() => "git-proxy-secret"),
    githubTokenProvider: {
      getReadOnlyTokenForRepo: mockState.getReadOnlyTokenForRepo,
    },
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

  it("runs startup toolchain after bootstrap network policy and before clone", async () => {
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
      "setNetworkPolicy",
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

  it("runs startup script before applying final network policy", async () => {
    const serverState = createServerState();
    const { service } = createService(
      serverState,
      createClientState(),
    );
    mockState.execHttp.mockImplementation(async (command: string) => {
      if (command.startsWith("test -d")) {
        mockState.events.push("cloneCheck");
        return { stdout: "empty", stderr: "", exitCode: 0 };
      }
      if (command.includes("git -c")) {
        mockState.events.push("cloneRepo");
        return { stdout: "", stderr: "", exitCode: 0 };
      }
      if (command.includes("git rev-parse")) {
        return { stdout: "main", stderr: "", exitCode: 0 };
      }
      if (command.includes("timeout")) {
        mockState.events.push("startupScript");
        return { stdout: "", stderr: "", exitCode: 0 };
      }
      return { stdout: "", stderr: "", exitCode: 0 };
    });

    const runtimeConfig = {
      sourceEnvironmentId: null,
      sourceEnvironmentName: null,
      repoId: 1,
      network: { mode: "locked" as const },
      plainEnvVars: {},
      startupScript: "pnpm install",
      resolvedAt: "2026-05-29T00:00:00.000Z",
      schemaVersion: 1 as const,
    };
    const serviceWithScript = new SessionProvisionService({
      logger: createLogger(),
      env: {
        SPRITES_API_KEY: "sprites-key",
        SPRITES_API_URL: "https://api.sprites.test",
        WORKER_URL: "https://worker.test",
      } as Env,
      spritesCoordinator: {
        createSprite: vi.fn(async () => {
          mockState.events.push("createSprite");
          return { name: "sprite-1", status: "running" };
        }),
      } as never,
      getServerState: () => serverState,
      getClientState: () => createClientState(),
      getRuntimeConfig: () => runtimeConfig,
      updateServerState: (partial) => Object.assign(serverState, partial),
      updatePartialState: vi.fn(),
      synthesizeStatus: () => "provisioning",
      ensureGitProxySecret: vi.fn(() => "git-proxy-secret"),
      githubTokenProvider: {
        getReadOnlyTokenForRepo: mockState.getReadOnlyTokenForRepo,
      },
    });

    await serviceWithScript.ensureProvisioned();

    expect(mockState.events).toEqual([
      "createSprite",
      "setNetworkPolicy",
      "startupToolchain",
      "cloneCheck",
      "cloneRepo",
      "startupScript",
      "setNetworkPolicy",
    ]);
    expect(service).toBeDefined();
  });

  it("records startup script failure and continues provisioning", async () => {
    const serverState = createServerState();
    const updatePartialState = vi.fn();
    mockState.execHttp.mockImplementation(async (command: string) => {
      if (command.startsWith("test -d")) {
        mockState.events.push("cloneCheck");
        return { stdout: "empty", stderr: "", exitCode: 0 };
      }
      if (command.includes("git -c")) {
        mockState.events.push("cloneRepo");
        return { stdout: "", stderr: "", exitCode: 0 };
      }
      if (command.includes("git rev-parse")) {
        return { stdout: "main", stderr: "", exitCode: 0 };
      }
      if (command.includes("timeout")) {
        mockState.events.push("startupScript");
        return {
          stdout: "",
          stderr: "bash: line 1: pnpm: command not found",
          exitCode: 127,
        };
      }
      return { stdout: "", stderr: "", exitCode: 0 };
    });

    const service = new SessionProvisionService({
      logger: createLogger(),
      env: {
        SPRITES_API_KEY: "sprites-key",
        SPRITES_API_URL: "https://api.sprites.test",
        WORKER_URL: "https://worker.test",
      } as Env,
      spritesCoordinator: {
        createSprite: vi.fn(async () => {
          mockState.events.push("createSprite");
          return { name: "sprite-1", status: "running" };
        }),
      } as never,
      getServerState: () => serverState,
      getClientState: () => createClientState(),
      getRuntimeConfig: () => createRuntimeConfig({
        startupScript: "pnpm install",
      }),
      updateServerState: (partial) => Object.assign(serverState, partial),
      updatePartialState,
      synthesizeStatus: () => "ready",
      ensureGitProxySecret: vi.fn(() => "git-proxy-secret"),
      githubTokenProvider: {
        getReadOnlyTokenForRepo: mockState.getReadOnlyTokenForRepo,
      },
    });

    await service.ensureProvisioned();

    expect(mockState.events).toEqual([
      "createSprite",
      "setNetworkPolicy",
      "startupToolchain",
      "cloneCheck",
      "cloneRepo",
      "startupScript",
      "setNetworkPolicy",
    ]);
    expect(serverState.startupScriptCompleted).toBe(true);
    expect(serverState.finalNetworkPolicyApplied).toBe(true);
    expect(updatePartialState).toHaveBeenCalledWith({
      lastError: "Startup script failed (exit 127): bash: line 1: pnpm: command not found",
      status: "ready",
    });
  });
});
