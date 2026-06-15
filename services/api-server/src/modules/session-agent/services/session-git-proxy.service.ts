import type { ClientState, Logger } from "@repo/shared";
import type { Env } from "@/shared/types";
import type { SecretRepository } from "../repositories/secret.repository";
import type { ServerState } from "../repositories/server-state.repository";
import type {
  SessionRepoAccessError,
  SessionRepoAccessResult,
} from "@/shared/types/repo-access";
import type { GitHubAppResult } from "@/shared/types/github";
import type { GitCredentialResult } from "@/shared/types/session-agent";
import { GitProxyService } from "@/shared/integrations/git/git-proxy.service";
import type {
  GitProxyProviderError,
  GitProxyProviderResult,
  GitProxyRepoPolicyProvider,
  GitProxySecretProvider,
  GitProxyTokenProvider,
} from "@/shared/integrations/git/git.providers";

export interface SessionGitProxyServiceDeps {
  logger: Logger;
  env: Env;
  secretRepository: SecretRepository;
  getServerState: () => ServerState;
  getClientState: () => ClientState;
  updatePartialState: (partial: Partial<ClientState>) => void;
  updatePushedBranch: (branch: string) => void;
  assertSessionRepoAccess: () => Promise<SessionRepoAccessResult>;
  enforceSessionAccessBlocked: () => Promise<void>;
  githubTokenProvider: {
    getInstallationTokenForRepo(repoFullName: string): Promise<GitHubAppResult<string>>;
    getReadOnlyTokenForRepo(repoFullName: string): Promise<GitHubAppResult<string>>;
  };
}

/**
 * Session-scoped adapter around the agnostic `GitProxyService`.
 * Owns the git-proxy shared secret (persisted via `SecretRepository`),
 * and access-control/pushed-branch state mutation. Installation tokens stay
 * in the GitHub module's D1 token cache.
 */
export class SessionGitProxyService implements
  GitProxyTokenProvider,
  GitProxySecretProvider,
  GitProxyRepoPolicyProvider
{
  private readonly logger: Logger;
  private readonly env: Env;
  private readonly secretRepository: SecretRepository;
  private readonly getServerState: () => ServerState;
  private readonly getClientState: () => ClientState;
  private readonly updatePartialState: SessionGitProxyServiceDeps["updatePartialState"];
  private readonly updatePushedBranch: (branch: string) => void;
  private readonly assertSessionRepoAccess: () => Promise<SessionRepoAccessResult>;
  private readonly enforceSessionAccessBlocked: () => Promise<void>;
  private readonly githubTokenProvider: SessionGitProxyServiceDeps["githubTokenProvider"];
  private readonly gitProxyService: GitProxyService;
  /** Shared secret for authenticating sprite → worker git-proxy requests. */
  private gitProxySecret: string | null;

  constructor(deps: SessionGitProxyServiceDeps) {
    this.logger = deps.logger.scope("session-git-proxy");
    this.env = deps.env;
    this.secretRepository = deps.secretRepository;
    this.getServerState = deps.getServerState;
    this.getClientState = deps.getClientState;
    this.updatePartialState = deps.updatePartialState;
    this.updatePushedBranch = deps.updatePushedBranch;
    this.assertSessionRepoAccess = deps.assertSessionRepoAccess;
    this.enforceSessionAccessBlocked = deps.enforceSessionAccessBlocked;
    this.githubTokenProvider = deps.githubTokenProvider;
    this.gitProxySecret = this.secretRepository.get("git_proxy_secret");
    this.gitProxyService = new GitProxyService({
      tokenProvider: this,
      secretProvider: this,
      repoPolicyProvider: this,
      logger: this.logger,
    });
  }

  /** Returns the cached git-proxy secret, generating and persisting it if missing. */
  ensureGitProxySecret(): string {
    if (!this.gitProxySecret) {
      this.gitProxySecret = crypto.randomUUID();
      this.secretRepository.set("git_proxy_secret", this.gitProxySecret);
    }
    return this.gitProxySecret;
  }

  /**
   * Authenticates the session's repo access, forwards the git request to
   * GitHub, and propagates any pushed-branch update into DO state.
   */
  async handleRequest(request: Request): Promise<Response> {
    const accessResult = await this.assertSessionRepoAccess();
    if (!accessResult.ok) {
      return this.respondToAccessFailure(accessResult.error);
    }

    const path = new URL(request.url).pathname;
    const result = await this.gitProxyService.handleRequest(request, path);

    if (result.pushedBranch && result.response.ok) {
      const clientState = this.getClientState();
      if (result.pushedBranch !== clientState.pushedBranch) {
        this.updatePartialState({ pushedBranch: result.pushedBranch });
        this.updatePushedBranch(result.pushedBranch);
      }
    }

    return result.response;
  }

  /**
   * Mints a fresh read-only installation token for the session's repo, used by
   * the sprite's git credential helper for clone/fetch directly against GitHub.
   * Auto-renewing per request, so reads keep working past the ~1h token TTL
   * without a long-lived credential living on the sprite.
   */
  async mintReadCredential(): Promise<GitCredentialResult> {
    const accessResult = await this.assertSessionRepoAccess();
    if (!accessResult.ok) {
      if (accessResult.error.code === "REPO_ACCESS_BLOCKED") {
        await this.enforceSessionAccessBlocked();
      }
      const mapped = this.mapSessionRepoAccessError(accessResult.error);
      return { ok: false, status: mapped.status, message: mapped.message };
    }

    const repoFullName = this.getAllowedRepoFullName();
    if (!repoFullName) {
      return { ok: false, status: 409, message: "repo not configured" };
    }

    const tokenResult = await this.githubTokenProvider.getReadOnlyTokenForRepo(repoFullName);
    if (!tokenResult.ok) {
      const mapped = this.mapGitHubTokenError(tokenResult.error);
      return { ok: false, status: mapped.status, message: mapped.message };
    }

    return { ok: true, username: "x-access-token", password: tokenResult.value };
  }

  getGitProxySecret(): string | null {
    return this.gitProxySecret;
  }

  getAllowedRepoFullName(): string | null {
    return this.getClientState().repoFullName;
  }

  getSessionId(): string | null {
    return this.getServerState().sessionId;
  }

  getPushedBranch(): string | null {
    return this.getClientState().pushedBranch;
  }

  async getInstallationTokenForRepo(
    repoFullName: string,
  ): Promise<GitProxyProviderResult<string>> {
    const tokenResult = await this.githubTokenProvider.getInstallationTokenForRepo(repoFullName);
    if (tokenResult.ok) {
      return tokenResult;
    }

    return {
      ok: false,
      error: this.mapGitHubTokenError(tokenResult.error),
    };
  }

  private mapGitHubTokenError(error: {
    code: string;
    message: string;
  }): GitProxyProviderError {
    switch (error.code) {
      case "INVALID_REPO":
        return { code: "INVALID_REPO", status: 400, message: error.message };
      case "REPO_NOT_ACCESSIBLE":
        return { code: "REPO_NOT_ACCESSIBLE", status: 403, message: error.message };
      case "INSTALLATION_NOT_FOUND":
        return { code: "INSTALLATION_NOT_FOUND", status: 404, message: error.message };
      case "GITHUB_AUTH_ERROR":
        return { code: "GITHUB_AUTH_ERROR", status: 503, message: error.message };
      case "GITHUB_API_ERROR":
        return { code: "GITHUB_API_ERROR", status: 503, message: error.message };
      default:
        return { code: "TOKEN_UNAVAILABLE", status: 503, message: error.message };
    }
  }

  private async respondToAccessFailure(
    error: SessionRepoAccessError,
  ): Promise<Response> {
    if (error.code === "REPO_ACCESS_BLOCKED") {
      await this.enforceSessionAccessBlocked();
    }
    const mapped = this.mapSessionRepoAccessError(error);
    return new Response(
      JSON.stringify({ error: mapped.message, code: mapped.code }),
      {
        status: mapped.status,
        headers: { "Content-Type": "application/json" },
      },
    );
  }

  private mapSessionRepoAccessError(error: SessionRepoAccessError): {
    status: 400 | 401 | 403 | 404 | 503;
    code: SessionRepoAccessError["code"];
    message: string;
  } {
    switch (error.code) {
      case "REPO_ACCESS_BLOCKED":
        return { status: error.status, code: error.code, message: error.message };
      case "GITHUB_AUTH_REQUIRED":
        return { status: 401, code: error.code, message: error.message };
      case "GITHUB_API_ERROR":
      case "GITHUB_UNAVAILABLE":
        return { status: 503, code: error.code, message: error.message };
      case "SESSION_NOT_FOUND":
        return { status: 404, code: error.code, message: error.message };
      case "INVALID_REPO":
        return { status: 400, code: error.code, message: error.message };
      default: {
        const exhaustiveCheck: never = error;
        this.logger.error("Unhandled session repo access error", {
          fields: { error: JSON.stringify(exhaustiveCheck) },
        });
        throw new Error(
          `Unhandled session repo access error: ${JSON.stringify(exhaustiveCheck)}`,
        );
      }
    }
  }
}
