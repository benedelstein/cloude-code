import type { ClientState, Logger, ServerMessage } from "@repo/shared";
import type { Env } from "@/types";
import type { SecretRepository } from "../repositories/secret-repository";
import type { ServerState } from "../repositories/server-state-repository";
import type {
  SessionRepoAccessError,
  SessionRepoAccessResult,
} from "@/lib/user-session/session-repo-access";
import { handleGitProxy, type GitProxyContext } from "@/lib/git-proxy";

export interface SessionGitProxyServiceDeps {
  logger: Logger;
  env: Env;
  secretRepository: SecretRepository;
  getServerState: () => ServerState;
  getClientState: () => ClientState;
  updatePartialState: (partial: Partial<ClientState>) => void;
  broadcastMessage: (msg: ServerMessage) => void;
  getGitHubInstallationToken: () => string | null;
  setGitHubInstallationToken: (token: string) => void;
  getGitProxySecret: () => string | null;
  assertSessionRepoAccess: () => Promise<SessionRepoAccessResult>;
  enforceSessionAccessBlocked: () => Promise<void>;
}

/**
 * Session-scoped wrapper around the agnostic `handleGitProxy` helper.
 * Owns access-control, state mutations (githubInstallationToken cache, pushedBranch),
 * and the `branch.pushed` broadcast that were previously inlined in the
 * DO's fetch() handler.
 */
export class SessionGitProxyService {
  private readonly logger: Logger;
  private readonly env: Env;
  private readonly secretRepository: SecretRepository;
  private readonly getServerState: () => ServerState;
  private readonly getClientState: () => ClientState;
  private readonly updatePartialState: SessionGitProxyServiceDeps["updatePartialState"];
  private readonly broadcastMessage: SessionGitProxyServiceDeps["broadcastMessage"];
  private readonly getGitHubInstallationToken: () => string | null;
  private readonly setGitHubInstallationToken: (token: string) => void;
  private readonly getGitProxySecret: () => string | null;
  private readonly assertSessionRepoAccess: () => Promise<SessionRepoAccessResult>;
  private readonly enforceSessionAccessBlocked: () => Promise<void>;

  constructor(deps: SessionGitProxyServiceDeps) {
    this.logger = deps.logger.scope("session-git-proxy");
    this.env = deps.env;
    this.secretRepository = deps.secretRepository;
    this.getServerState = deps.getServerState;
    this.getClientState = deps.getClientState;
    this.updatePartialState = deps.updatePartialState;
    this.broadcastMessage = deps.broadcastMessage;
    this.getGitHubInstallationToken = deps.getGitHubInstallationToken;
    this.setGitHubInstallationToken = deps.setGitHubInstallationToken;
    this.getGitProxySecret = deps.getGitProxySecret;
    this.assertSessionRepoAccess = deps.assertSessionRepoAccess;
    this.enforceSessionAccessBlocked = deps.enforceSessionAccessBlocked;
  }

  /**
   * Authenticates the session's repo access, forwards the git request to
   * GitHub, and propagates any resulting token refresh or pushed-branch
   * update into DO state.
   */
  async handleRequest(request: Request): Promise<Response> {
    const accessResult = await this.assertSessionRepoAccess();
    if (!accessResult.ok) {
      return this.respondToAccessFailure(accessResult.error);
    }

    const path = new URL(request.url).pathname;
    const result = await handleGitProxy(request, path, this.buildContext());

    if (result.githubInstallationToken) {
      this.setGitHubInstallationToken(result.githubInstallationToken);
    }

    if (result.pushedBranch && result.response.ok) {
      const clientState = this.getClientState();
      if (result.pushedBranch !== clientState.pushedBranch) {
        this.updatePartialState({ pushedBranch: result.pushedBranch });
        this.broadcastMessage({
          type: "branch.pushed",
          branch: result.pushedBranch,
          repoFullName: clientState.repoFullName ?? "",
        });
      }
    }

    return result.response;
  }

  private buildContext(): GitProxyContext {
    return {
      gitProxySecret: this.getGitProxySecret(),
      repoFullName: this.getClientState().repoFullName,
      sessionId: this.getServerState().sessionId,
      githubInstallationToken: this.getGitHubInstallationToken(),
      pushedBranch: this.getClientState().pushedBranch,
      env: this.env,
      secretRepository: this.secretRepository,
    };
  }

  private async respondToAccessFailure(
    error: SessionRepoAccessError,
  ): Promise<Response> {
    switch (error.code) {
      case "REPO_ACCESS_BLOCKED":
        await this.enforceSessionAccessBlocked();
        return new Response(
          JSON.stringify({ error: error.message, code: error.code }),
          {
            status: error.status,
            headers: { "Content-Type": "application/json" },
          },
        );
      case "GITHUB_AUTH_REQUIRED":
        return new Response(
          JSON.stringify({ error: error.message, code: error.code }),
          {
            status: 401,
            headers: { "Content-Type": "application/json" },
          },
        );
      case "GITHUB_API_ERROR":
        return new Response(
          JSON.stringify({ error: error.message, code: error.code }),
          {
            status: 503,
            headers: { "Content-Type": "application/json" },
          },
        );
      case "SESSION_NOT_FOUND":
        return new Response(
          JSON.stringify({ error: error.message, code: error.code }),
          {
            status: 404,
            headers: { "Content-Type": "application/json" },
          },
        );
      case "INVALID_REPO":
        return new Response(
          JSON.stringify({ error: error.message, code: error.code }),
          {
            status: 400,
            headers: { "Content-Type": "application/json" },
          },
        );
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
