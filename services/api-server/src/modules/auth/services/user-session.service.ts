import { decrypt, encrypt } from "@/shared/utils/crypto";
import { createLogger } from "@/shared/logging";
import type { Env } from "@/shared/types";
import type { AuthContext } from "@/shared/types/auth";
import type { RefreshedToken } from "@/shared/types/github";
import type {
  GitHubCredentialError,
  GitHubCredentialResult,
} from "@/shared/types/github-credential";
import { failure, success } from "@repo/shared";
import { UserSessionRepository } from "../repositories/user-session.repository";

const logger = createLogger("user-session.service.ts");

export interface GitHubUserTokenRefreshProvider {
  refreshUserToken(refreshToken: string): Promise<RefreshedToken>;
}

export interface UserSessionServiceDeps {
  env: Env;
  githubTokenRefreshProvider?: GitHubUserTokenRefreshProvider;
}

export class UserSessionService {
  private readonly repository: UserSessionRepository;
  private readonly env: Env;
  private readonly githubTokenRefreshProvider: GitHubUserTokenRefreshProvider | null;

  constructor(deps: Env | UserSessionServiceDeps) {
    this.env = "DB" in deps ? deps : deps.env;
    this.githubTokenRefreshProvider = "DB" in deps
      ? null
      : deps.githubTokenRefreshProvider ?? null;
    this.repository = new UserSessionRepository(this.env.DB);
  }

  async getAuthenticatedUserIdBySessionToken(
    sessionToken: string,
  ): Promise<AuthContext | null> {
    return await this.repository.getActiveAuthSessionUserIdByToken(sessionToken);
  }

  async getValidGitHubCredentialByUserId(
    userId: string,
  ): Promise<GitHubCredentialResult> {
    const credentials = await this.repository.getGitHubCredentialsByUserId(userId);
    if (!credentials) {
      return failure(this.githubAuthRequiredError());
    }

    return this.ensureValidGitHubCredential({
      userId,
      encryptedGithubAccessToken: credentials.encryptedAccessToken,
      tokenExpiresAt: credentials.accessTokenExpiresAt,
    });
  }

  async getValidGitHubAccessTokenByUserId(
    userId: string,
  ): Promise<string | null> {
    const result = await this.getValidGitHubCredentialByUserId(userId);
    return result.ok ? result.value.accessToken : null;
  }

  async forceRefreshGitHubCredentialByUserId(
    userId: string,
  ): Promise<GitHubCredentialResult> {
    return this.refreshGitHubCredential(userId);
  }

  /**
   * Forces a GitHub user token refresh using the stored per-user credentials.
   * @param userId - Authenticated user id.
   * @returns The refreshed GitHub access token, or null when refresh is not possible.
   */
  async forceRefreshGitHubAccessTokenByUserId(
    userId: string,
  ): Promise<string | null> {
    const result = await this.forceRefreshGitHubCredentialByUserId(userId);
    return result.ok ? result.value.accessToken : null;
  }

  async revokeAllSessionsByGithubId(githubId: number): Promise<void> {
    await this.repository.revokeAllSessionsByGithubId(githubId);
  }

  async revokeGitHubCredentialsByGithubId(githubId: number): Promise<void> {
    await this.repository.deleteGitHubCredentialsByGithubId(githubId);
  }

  // ensures access token is valid, refreshing if needed.
  private async ensureValidGitHubAccessToken(params: {
    userId: string;
    encryptedGithubAccessToken: string;
    tokenExpiresAt: string | null;
  }): Promise<string | null> {
    const result = await this.ensureValidGitHubCredential(params);
    return result.ok ? result.value.accessToken : null;
  }

  private async ensureValidGitHubCredential(params: {
    userId: string;
    encryptedGithubAccessToken: string;
    tokenExpiresAt: string | null;
  }): Promise<GitHubCredentialResult> {
    const currentAccessToken = await decrypt(
      params.encryptedGithubAccessToken,
      this.env.TOKEN_ENCRYPTION_KEY,
    );

    if (
      !params.tokenExpiresAt
      || new Date(params.tokenExpiresAt).getTime() > Date.now()
    ) {
      return success({ accessToken: currentAccessToken });
    }

    return this.refreshGitHubCredential(params.userId);
  }

  private async refreshGitHubAccessToken(userId: string): Promise<string | null> {
    const result = await this.refreshGitHubCredential(userId);
    return result.ok ? result.value.accessToken : null;
  }

  private async refreshGitHubCredential(userId: string): Promise<GitHubCredentialResult> {
    const credentials = await this.repository.getGitHubCredentialsByUserId(userId);
    if (!credentials?.encryptedRefreshToken) {
      return failure(this.githubAuthRequiredError());
    }
    if (!this.githubTokenRefreshProvider) {
      logger.warn("Cannot refresh GitHub user token without refresh provider", {
        fields: { userId },
      });
      return failure(this.githubAuthRequiredError());
    }

    try {
      const decryptedRefreshToken = await decrypt(
        credentials.encryptedRefreshToken,
        this.env.TOKEN_ENCRYPTION_KEY,
      );
      const refreshed = await this.githubTokenRefreshProvider.refreshUserToken(
        decryptedRefreshToken,
      );
      const encryptedAccessToken = await encrypt(
        refreshed.accessToken,
        this.env.TOKEN_ENCRYPTION_KEY,
      );
      const encryptedRefreshTokenNext = await encrypt(
        refreshed.refreshToken,
        this.env.TOKEN_ENCRYPTION_KEY,
      );

      await this.repository.updateGitHubCredentials({
        userId,
        encryptedAccessToken,
        accessTokenExpiresAt: refreshed.expiresAt,
        encryptedRefreshToken: encryptedRefreshTokenNext,
        refreshTokenExpiresAt: refreshed.refreshTokenExpiresAt ?? null,
      });

      return success({ accessToken: refreshed.accessToken });
    } catch (error) {
      logger.warn("Failed to refresh GitHub user token", {
        error,
        fields: { userId },
      });
      return failure(this.githubRefreshError(error));
    }
  }

  private githubAuthRequiredError(): GitHubCredentialError {
    return {
      code: "GITHUB_AUTH_REQUIRED",
      status: 401,
      message: "Reconnect GitHub to continue.",
    };
  }

  private githubRefreshUnavailableError(): GitHubCredentialError {
    return {
      code: "GITHUB_UNAVAILABLE",
      status: 503,
      message: "GitHub is unavailable. Try again shortly.",
    };
  }

  private githubRefreshError(error: unknown): GitHubCredentialError {
    if (this.isGitHubRefreshAuthFailure(error)) {
      return this.githubAuthRequiredError();
    }
    return this.githubRefreshUnavailableError();
  }

  private isGitHubRefreshAuthFailure(error: unknown): boolean {
    if (typeof error !== "object" || error === null || !("status" in error)) {
      return false;
    }
    const status = (error as { status?: unknown }).status;
    return status === 400 || status === 401;
  }
}
