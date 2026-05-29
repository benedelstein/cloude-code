import { describe, expect, it, vi } from "vitest";
import { configureGitRemote } from "../../src/shared/integrations/git/git-setup.service";

describe("configureGitRemote", () => {
  it("keeps fetch pointed at GitHub by default", async () => {
    const sprite = { execHttp: vi.fn(async () => ({ stdout: "", stderr: "", exitCode: 0 })) };

    await configureGitRemote(sprite as never, {
      workspaceDir: "/workspace",
      githubRemoteUrl: "https://github.com/owner/repo.git",
      cloneUrl: "https://worker.test/git-proxy/session/github.com/owner/repo.git",
      proxyBaseUrl: "https://worker.test/git-proxy/session",
      gitProxySecret: "secret",
    });

    expect(sprite.execHttp.mock.calls[0]?.[0]).toContain(
      "git remote set-url origin https://github.com/owner/repo.git",
    );
  });

  it("uses git proxy for fetch when requested", async () => {
    const sprite = { execHttp: vi.fn(async () => ({ stdout: "", stderr: "", exitCode: 0 })) };

    await configureGitRemote(sprite as never, {
      workspaceDir: "/workspace",
      githubRemoteUrl: "https://github.com/owner/repo.git",
      cloneUrl: "https://worker.test/git-proxy/session/github.com/owner/repo.git",
      proxyBaseUrl: "https://worker.test/git-proxy/session",
      gitProxySecret: "secret",
      useProxyForFetch: true,
    });

    expect(sprite.execHttp.mock.calls[0]?.[0]).toContain(
      "git remote set-url origin https://worker.test/git-proxy/session/github.com/owner/repo.git",
    );
  });
});
