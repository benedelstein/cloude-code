import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  ClientState,
  Logger,
  SessionEnvironmentSnapshot,
  SessionSetupRun,
  SessionSetupTask,
} from "@repo/shared";
import type { Env } from "../../src/shared/types";
import type { ServerState } from "../../src/modules/session-agent/repositories/server-state.repository";
import {
  SessionProvisionService,
  type SessionSetupTaskReporter,
} from "../../src/modules/session-agent/services/session-provision.service";

const mockState = vi.hoisted(() => ({
  events: [] as string[],
  setNetworkPolicy: vi.fn(),
  execHttp: vi.fn(),
  execWs: vi.fn(),
  ensureSpriteStartupToolchain: vi.fn(),
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
    execWs = mockState.execWs;
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

function createClientState(args: {
  prepareTask?: (task: SessionSetupTask) => SessionSetupTask;
} = {}): ClientState {
  return {
    repoFullName: "ben/repo",
    baseBranch: "main",
    agentSettings: {
      provider: "openai-codex",
      model: "gpt-5.5",
      maxTokens: 8192,
    },
    sessionSetupRun: createSetupRun(args.prepareTask),
  } as ClientState;
}

function createSetupRun(
  prepareTask?: (task: SessionSetupTask) => SessionSetupTask,
): SessionSetupRun {
  const tasks = [
    createSetupTask("cloud_container", true),
    createSetupTask("repository", true),
    {
      ...createSetupTask("setup_script", false),
      output: null,
      skipReason: null,
    },
    createSetupTask("network_policy", true),
    createSetupTask("initial_agent_start", true),
  ] as SessionSetupTask[];

  return {
    id: "setup-run-1",
    mode: "create",
    status: "running",
    startedAt: "2026-06-03T00:00:00.000Z",
    completedAt: null,
    tasks: prepareTask ? tasks.map(prepareTask) : tasks,
  };
}

function createSetupTask<Id extends SessionSetupTask["id"], IsBlocking extends boolean>(
  id: Id,
  isBlocking: IsBlocking,
): Extract<SessionSetupTask, { id: Id }> {
  return {
    id,
    isBlocking,
    status: "pending",
    startedAt: null,
    completedAt: null,
    error: null,
  } as Extract<SessionSetupTask, { id: Id }>;
}

function completeTask(task: SessionSetupTask): SessionSetupTask {
  return {
    ...task,
    status: "completed",
    startedAt: "2026-06-03T00:00:00.000Z",
    completedAt: "2026-06-03T00:00:00.000Z",
    error: null,
  };
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

function createEnvironmentSnapshot(
  overrides: Partial<SessionEnvironmentSnapshot> = {},
): SessionEnvironmentSnapshot {
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

function createSetupReporter(): SessionSetupTaskReporter {
  return {
    startTask: vi.fn(),
    completeTask: vi.fn(),
    failTask: vi.fn(),
    skipTask: vi.fn(),
  };
}

function createService(
  serverState: ServerState,
  clientState: ClientState,
  envOverrides: Partial<Env> = {},
  environmentSnapshot: SessionEnvironmentSnapshot = createEnvironmentSnapshot(),
  setupReporter?: SessionSetupTaskReporter,
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
    getEnvironmentSnapshot: () => environmentSnapshot,
    updateServerState,
    updatePartialState,
    synthesizeStatus: () => "preparing",
    ensureGitProxySecret: vi.fn(() => "git-proxy-secret"),
    githubTokenProvider: {
      getReadOnlyTokenForRepo: mockState.getReadOnlyTokenForRepo,
    },
    setupReporter,
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
    mockState.execWs.mockImplementation(async (command: string) => {
      if (command.includes("timeout")) {
        mockState.events.push("startupScript");
      }
      return { stdout: "", stderr: "", exitCode: 0 };
    });
    mockState.getReadOnlyTokenForRepo.mockResolvedValue({
      ok: true,
      value: "readonly-token",
    });
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
  });

  it("does not fail the run directly when a blocking task reports failure", async () => {
    mockState.ensureSpriteStartupToolchain.mockImplementation(async () => {
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
    const setupReporter = createSetupReporter();
    const { service } = createService(
      serverState,
      createClientState(),
      {},
      createEnvironmentSnapshot(),
      setupReporter,
    );

    await expect(service.ensureProvisioned()).rejects.toThrow(
      "Codex CLI repair script failed.",
    );
    expect(setupReporter.failTask).toHaveBeenCalledWith(
      "cloud_container",
      "Codex CLI repair script failed.",
    );
  });

  it("reports final network policy failures through the network policy task", async () => {
    mockState.setNetworkPolicy.mockRejectedValueOnce(new Error("Policy failed"));
    const serverState = createServerState({
      spriteName: "sprite-1",
      startupToolchain: {
        contractHash: "hash-1",
        checkedAt: 1,
        results: [],
      },
      repoCloned: true,
      startupScriptCompleted: true,
    });
    const setupReporter = createSetupReporter();
    const { service } = createService(
      serverState,
      createClientState(),
      {},
      createEnvironmentSnapshot(),
      setupReporter,
    );

    await expect(service.ensureProvisioned()).rejects.toThrow("Policy failed");
    expect(setupReporter.failTask).toHaveBeenCalledWith("network_policy", "Policy failed");
  });

  it("keeps fetch pointed at GitHub by default", async () => {
    const serverState = createServerState();
    const { service } = createService(serverState, createClientState());

    await service.ensureProvisioned();

    const remoteConfigCommand = getRemoteConfigCommand();
    expect(remoteConfigCommand).toContain(
      "git remote set-url origin https://github.com/ben/repo.git",
    );
    expect(remoteConfigCommand).toContain(
      "git remote set-url --push origin https://worker.test/git-proxy/session-1/github.com/ben/repo.git",
    );
    expect(remoteConfigCommand).toContain(
      "git config --add \"http.https://worker.test/git-proxy/session-1/.extraHeader\" \"Authorization: Bearer git-proxy-secret\"",
    );
  });

  it("uses the git proxy for fetch in locked network mode", async () => {
    const serverState = createServerState();
    const { service } = createService(
      serverState,
      createClientState(),
      {},
      createEnvironmentSnapshot({ network: { mode: "locked" } }),
    );

    await service.ensureProvisioned();

    expect(getRemoteConfigCommand()).toContain(
      "git remote set-url origin https://worker.test/git-proxy/session-1/github.com/ben/repo.git",
    );
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
      return { stdout: "", stderr: "", exitCode: 0 };
    });
    mockState.execWs.mockImplementation(async (command: string) => {
      if (command.includes("timeout")) {
        mockState.events.push("startupScript");
      }
      return { stdout: "", stderr: "", exitCode: 0 };
    });

    const environmentSnapshot = {
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
      getEnvironmentSnapshot: () => environmentSnapshot,
      updateServerState: (partial) => Object.assign(serverState, partial),
      updatePartialState: vi.fn(),
      synthesizeStatus: () => "preparing",
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

  it("reports setup task transitions without owning setup state", async () => {
    const serverState = createServerState();
    const setupReporter = createSetupReporter();
    const environmentSnapshot = createEnvironmentSnapshot({
      startupScript: "echo setup",
    });
    mockState.execWs.mockResolvedValue({
      stdout: "setup ok",
      stderr: "",
      exitCode: 0,
    });
    const { service } = createService(
      serverState,
      createClientState(),
      {},
      environmentSnapshot,
      setupReporter,
    );

    await service.ensureProvisioned();

    expect(setupReporter.startTask).toHaveBeenNthCalledWith(1, "cloud_container");
    expect(setupReporter.startTask).toHaveBeenNthCalledWith(2, "repository");
    expect(setupReporter.startTask).toHaveBeenNthCalledWith(3, "setup_script");
    expect(setupReporter.startTask).toHaveBeenNthCalledWith(4, "network_policy");
    expect(setupReporter.completeTask).toHaveBeenCalledWith("cloud_container");
    expect(setupReporter.completeTask).toHaveBeenCalledWith("repository");
    expect(setupReporter.completeTask).toHaveBeenCalledWith("setup_script", {
      stdout: "setup ok",
      stderr: "",
      exitCode: 0,
      truncated: false,
    });
    expect(setupReporter.completeTask).toHaveBeenCalledWith("network_policy");
  });

  it("reports cloud container task when the sprite exists but toolchain is missing", async () => {
    const serverState = createServerState({
      spriteName: "sprite-1",
    });
    const setupReporter = createSetupReporter();
    const { service } = createService(
      serverState,
      createClientState(),
      {},
      createEnvironmentSnapshot(),
      setupReporter,
    );

    await service.ensureProvisioned();

    expect(setupReporter.startTask).toHaveBeenCalledWith("cloud_container");
    expect(setupReporter.completeTask).toHaveBeenCalledWith("cloud_container");
    expect(mockState.ensureSpriteStartupToolchain).toHaveBeenCalledOnce();
    expect(setupReporter.startTask).toHaveBeenCalledWith("repository");
  });

  it("skips cloud container task when the setup task is already terminal", async () => {
    const serverState = createServerState({
      spriteName: "sprite-1",
      startupToolchain: {
        contractHash: "hash-1",
        checkedAt: 1,
        results: [],
      },
    });
    const setupReporter = createSetupReporter();
    const { service } = createService(
      serverState,
      createClientState({
        prepareTask: (task) =>
          task.id === "cloud_container" ? completeTask(task) : task,
      }),
      {},
      createEnvironmentSnapshot(),
      setupReporter,
    );

    await service.ensureProvisioned();

    expect(setupReporter.startTask).not.toHaveBeenCalledWith("cloud_container");
    expect(setupReporter.completeTask).not.toHaveBeenCalledWith("cloud_container");
    expect(mockState.ensureSpriteStartupToolchain).not.toHaveBeenCalled();
    expect(setupReporter.startTask).toHaveBeenCalledWith("repository");
  });

  it("reports skipped setup scripts with a no environment skip reason", async () => {
    const serverState = createServerState();
    const setupReporter = createSetupReporter();
    const { service } = createService(
      serverState,
      createClientState(),
      {},
      createEnvironmentSnapshot({
        repoId: 123,
        startupScript: null,
      }),
      setupReporter,
    );

    await service.ensureProvisioned();

    expect(setupReporter.startTask).toHaveBeenCalledWith("setup_script");
    expect(setupReporter.skipTask).toHaveBeenCalledWith("setup_script", {
      kind: "no_environment",
      repoId: 123,
    });
  });

  it("reports skipped setup scripts with a no script skip reason", async () => {
    const serverState = createServerState();
    const setupReporter = createSetupReporter();
    const sourceEnvironmentId = "123e4567-e89b-12d3-a456-426614174000";
    const { service } = createService(
      serverState,
      createClientState(),
      {},
      createEnvironmentSnapshot({
        sourceEnvironmentId,
        sourceEnvironmentName: "Default",
        startupScript: "",
      }),
      setupReporter,
    );

    await service.ensureProvisioned();

    expect(setupReporter.skipTask).toHaveBeenCalledWith("setup_script", {
      kind: "no_script",
      environmentId: sourceEnvironmentId,
      environmentName: "Default",
    });
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
      return { stdout: "", stderr: "", exitCode: 0 };
    });
    mockState.execWs.mockImplementation(async (command: string) => {
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
      getEnvironmentSnapshot: () => createEnvironmentSnapshot({
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
    expect(updatePartialState).not.toHaveBeenCalledWith(
      expect.objectContaining({
        lastError: "Startup script failed with exit code 127 after 0ms",
      }),
    );
  });

  it("reports startup script failure as a nonfatal setup task failure", async () => {
    const serverState = createServerState();
    const setupReporter = createSetupReporter();
    mockState.execWs.mockImplementation(async (command: string) => {
      if (command.includes("timeout")) {
        return {
          stdout: "",
          stderr: "setup failed",
          exitCode: 1,
        };
      }
      return { stdout: "", stderr: "", exitCode: 0 };
    });
    const { service } = createService(
      serverState,
      createClientState(),
      {},
      createEnvironmentSnapshot({ startupScript: "exit 1" }),
      setupReporter,
    );

    await service.ensureProvisioned();

    expect(setupReporter.failTask).toHaveBeenCalledWith(
      "setup_script",
      expect.stringMatching(/^Startup script failed with exit code 1 after \d+ms$/),
      {
        stdout: "",
        stderr: "setup failed",
        exitCode: 1,
        truncated: false,
      },
    );
    expect(serverState.finalNetworkPolicyApplied).toBe(true);
  });
});

function getRemoteConfigCommand(): string {
  const remoteConfigCall = mockState.execHttp.mock.calls.find(([command]) =>
    String(command).includes("git remote set-url origin"));
  expect(remoteConfigCall).toBeDefined();
  return String(remoteConfigCall?.[0]);
}
