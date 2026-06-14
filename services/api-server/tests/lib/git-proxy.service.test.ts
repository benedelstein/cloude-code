import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ClientState, Logger } from "@repo/shared";
import { GitProxyService } from "../../src/shared/integrations/git/git-proxy.service";
import type { GitProxyTokenProvider } from "../../src/shared/integrations/git/git.providers";
import { SessionGitProxyService } from "../../src/modules/session-agent/services/session-git-proxy.service";
import type { SecretRepository } from "../../src/modules/session-agent/repositories/secret.repository";
import type { ServerState } from "../../src/modules/session-agent/repositories/server-state.repository";
import type { Env } from "../../src/shared/types";

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

function createService(params: {
  tokenProvider?: GitProxyTokenProvider;
  gitProxySecret?: string | null;
  repoFullName?: string | null;
  sessionId?: string | null;
  pushedBranch?: string | null;
} = {}): GitProxyService {
  return new GitProxyService({
    tokenProvider: params.tokenProvider ?? {
      getInstallationTokenForRepo: vi.fn(async () => ({
        ok: true,
        value: "installation-token",
      })),
    },
    secretProvider: {
      getGitProxySecret: () => params.gitProxySecret ?? "secret",
    },
    repoPolicyProvider: {
      getAllowedRepoFullName: () => params.repoFullName ?? "ben/repo",
      getSessionId: () => params.sessionId ?? "abcd-session",
      getPushedBranch: () => params.pushedBranch ?? null,
    },
    logger: createLogger(),
  });
}

function createRequest(path: string, init: RequestInit = {}): Request {
  return new Request(`https://worker.test${path}`, {
    ...init,
    headers: {
      Authorization: "Bearer secret",
      ...init.headers,
    },
  });
}

const ZERO_SHA = "0000000000000000000000000000000000000000";
const ONE_SHA = "1111111111111111111111111111111111111111";

/** Frames a payload as a git pkt-line (4-hex length prefix + payload). */
function pktLine(payload: string): string {
  return (payload.length + 4).toString(16).padStart(4, "0") + payload;
}

/** Builds a receive-pack command list: one ref update + flush packet. */
function createPushBody(branch: string): string {
  const command = `${ZERO_SHA} ${ONE_SHA} refs/heads/${branch}\0 report-status`;
  return pktLine(`${command}\n`) + "0000";
}

describe("GitProxyService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", vi.fn(async () => new Response("ok")));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("forwards allowed requests using an installation token provider", async () => {
    const fetchGitHub = vi.fn(async () => new Response("ok"));
    vi.stubGlobal("fetch", fetchGitHub);
    const tokenProvider: GitProxyTokenProvider = {
      getInstallationTokenForRepo: vi.fn(async () => ({
        ok: true,
        value: "provider-token",
      })),
    };
    const service = createService({ tokenProvider });

    const result = await service.handleRequest(
      createRequest("/git-proxy/abcd-session/github.com/ben/repo.git/info/refs?service=git-upload-pack"),
      "/git-proxy/abcd-session/github.com/ben/repo.git/info/refs",
    );

    expect(result.response.status).toBe(200);
    expect(tokenProvider.getInstallationTokenForRepo).toHaveBeenCalledWith("ben/repo");
    expect(fetchGitHub).toHaveBeenCalledWith(
      "https://github.com/ben/repo.git/info/refs?service=git-upload-pack",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: `Basic ${btoa("x-access-token:provider-token")}`,
        }),
      }),
    );
  });

  it("returns provider errors without throwing", async () => {
    const service = createService({
      tokenProvider: {
        getInstallationTokenForRepo: vi.fn(async () => ({
          ok: false,
          error: {
            code: "GITHUB_API_ERROR",
            status: 503,
            message: "GitHub unavailable",
          },
        })),
      },
    });

    const result = await service.handleRequest(
      createRequest("/git-proxy/abcd-session/github.com/ben/repo.git/info/refs"),
      "/git-proxy/abcd-session/github.com/ben/repo.git/info/refs",
    );

    expect(result.response.status).toBe(503);
    await expect(result.response.text()).resolves.toBe("GitHub unavailable");
  });

  it("rejects repos outside the session policy", async () => {
    const result = await createService().handleRequest(
      createRequest("/git-proxy/abcd-session/github.com/other/repo.git/info/refs"),
      "/git-proxy/abcd-session/github.com/other/repo.git/info/refs",
    );

    expect(result.response.status).toBe(403);
    await expect(result.response.text()).resolves.toBe("repo not allowed");
  });

  it("rejects pushes to branches outside the session policy", async () => {
    const result = await createService().handleRequest(
      createRequest("/git-proxy/abcd-session/github.com/ben/repo.git/git-receive-pack", {
        method: "POST",
        body: createPushBody("main"),
      }),
      "/git-proxy/abcd-session/github.com/ben/repo.git/git-receive-pack",
    );

    expect(result.response.status).toBe(403);
    await expect(result.response.text()).resolves.toContain("branch must start");
  });

  it("rejects a second ref-update smuggled behind a padded capability list", async () => {
    // The allowed branch is the first command, with capabilities padded past
    // the old 2 KiB scan window, followed by a disallowed second command.
    const padding = "x".repeat(4096);
    const allowed = `${ZERO_SHA} ${ONE_SHA} refs/heads/cloude/work-abcd\0 report-status ${padding}`;
    const smuggled = `${ZERO_SHA} ${ONE_SHA} refs/heads/main`;
    const body = pktLine(`${allowed}\n`) + pktLine(`${smuggled}\n`) + "0000";

    const result = await createService().handleRequest(
      createRequest("/git-proxy/abcd-session/github.com/ben/repo.git/git-receive-pack", {
        method: "POST",
        body,
      }),
      "/git-proxy/abcd-session/github.com/ben/repo.git/git-receive-pack",
    );

    expect(result.response.status).toBe(403);
    await expect(result.response.text()).resolves.toContain("branch must start");
  });

  it("does not scan ref-like bytes in the packfile after the flush packet", async () => {
    // A legitimate command list, a flush, then packfile bytes that look like a
    // forbidden ref-update. The packfile must never be parsed as a command.
    const command = `${ZERO_SHA} ${ONE_SHA} refs/heads/cloude/work-abcd\0 report-status`;
    const packfileLookalike = `${ZERO_SHA} ${ONE_SHA} refs/heads/main`;
    const body = pktLine(`${command}\n`) + "0000" + packfileLookalike;

    const result = await createService().handleRequest(
      createRequest("/git-proxy/abcd-session/github.com/ben/repo.git/git-receive-pack", {
        method: "POST",
        body,
      }),
      "/git-proxy/abcd-session/github.com/ben/repo.git/git-receive-pack",
    );

    expect(result.response.status).toBe(200);
  });

  it("rejects pushes to non-branch refs such as tags", async () => {
    const command = `${ZERO_SHA} ${ONE_SHA} refs/tags/v1.0.0\0 report-status`;
    const body = pktLine(`${command}\n`) + "0000";

    const result = await createService().handleRequest(
      createRequest("/git-proxy/abcd-session/github.com/ben/repo.git/git-receive-pack", {
        method: "POST",
        body,
      }),
      "/git-proxy/abcd-session/github.com/ben/repo.git/git-receive-pack",
    );

    expect(result.response.status).toBe(403);
    await expect(result.response.text()).resolves.toContain("only branch updates are allowed");
  });

  it("rejects a push body with no flush packet", async () => {
    const command = `${ZERO_SHA} ${ONE_SHA} refs/heads/cloude/work-abcd\0 report-status`;
    const body = pktLine(`${command}\n`); // truncated: missing flush

    const result = await createService().handleRequest(
      createRequest("/git-proxy/abcd-session/github.com/ben/repo.git/git-receive-pack", {
        method: "POST",
        body,
      }),
      "/git-proxy/abcd-session/github.com/ben/repo.git/git-receive-pack",
    );

    expect(result.response.status).toBe(403);
    await expect(result.response.text()).resolves.toContain("flush packet");
  });
});

describe("SessionGitProxyService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", vi.fn(async () => new Response("ok")));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("persists pushed-branch side effects without storing installation tokens in DO secrets", async () => {
    const clientState = {
      repoFullName: "ben/repo",
      pushedBranch: null,
    } as ClientState;
    const serverState = {
      sessionId: "abcd-session",
      userId: "user-1",
    } as ServerState;
    const secretRepository = {
      get: vi.fn(() => "secret"),
      set: vi.fn(),
      delete: vi.fn(),
    } as unknown as SecretRepository;
    const updatePartialState = vi.fn((partial: Partial<ClientState>) => {
      Object.assign(clientState, partial);
    });
    const updatePushedBranch = vi.fn();
    const service = new SessionGitProxyService({
      logger: createLogger(),
      env: {} as Env,
      secretRepository,
      getServerState: () => serverState,
      getClientState: () => clientState,
      updatePartialState,
      updatePushedBranch,
      assertSessionRepoAccess: vi.fn(async () => ({
        ok: true,
        value: {
          userId: "user-1",
          repoId: 1,
          installationId: 2,
          repoFullName: "ben/repo",
        },
      })),
      enforceSessionAccessBlocked: vi.fn(),
      githubTokenProvider: {
        getInstallationTokenForRepo: vi.fn(async () => ({
          ok: true,
          value: "github-module-token",
        })),
      },
    });

    const response = await service.handleRequest(
      createRequest("/git-proxy/abcd-session/github.com/ben/repo.git/git-receive-pack", {
        method: "POST",
        body: createPushBody("cloude/change-abcd"),
      }),
    );

    expect(response.status).toBe(200);
    expect(updatePartialState).toHaveBeenCalledWith({
      pushedBranch: "cloude/change-abcd",
    });
    expect(updatePushedBranch).toHaveBeenCalledWith("cloude/change-abcd");
    expect(secretRepository.set).not.toHaveBeenCalledWith(
      "github_token",
      expect.any(String),
    );
  });
});
