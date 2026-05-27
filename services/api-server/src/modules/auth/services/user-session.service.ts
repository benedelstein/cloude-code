import { decrypt, encrypt } from "@/shared/utils/crypto";
import { createLogger } from "@/shared/logging";
import type { Env } from "@/shared/types";
import type { RefreshedToken } from "@/shared/types/github";
import { UserSessionRepository } from "../repositories/user-session.repository";

const logger = createLogger("user-session.service.ts");

export interface AuthenticatedUserSession {
  id: string;
  githubId: number;
  githubLogin: string;
  githubName: string | null;
  githubAvatarUrl: string | null;
  githubAccessToken: string;
}

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

  /**
   * Fetches an authenticated user by session token.
   * If their github credentials are expired, the token is refreshed.
   * @param sessionToken - The session token, sent from the client
   * @returns The authenticated user session, or null if the session token is invalid or expired.
   */
  async getAuthenticatedUserBySessionToken(
    sessionToken: string,
  ): Promise<AuthenticatedUserSession | null> {
    const session = await this.repository.getActiveAuthSessionByToken(sessionToken);
    if (!session) {
      return null;
    }

    const githubAccessToken = await this.ensureValidGitHubAccessToken({
      userId: session.id,
      encryptedGithubAccessToken: session.githubAccessToken,
      tokenExpiresAt: session.tokenExpiresAt,
    });

    if (!githubAccessToken) {
      return null;
    }

    return {
      id: session.id,
      githubId: session.githubId,
      githubLogin: session.githubLogin,
      githubName: session.githubName,
      githubAvatarUrl: session.githubAvatarUrl,
      githubAccessToken,
    };
  }

  async getValidGitHubAccessTokenByUserId(
    userId: string,
  ): Promise<string | null> {
    const credentials = await this.repository.getGitHubCredentialsByUserId(userId);
    if (!credentials) {
      return null;
    }

    return this.ensureValidGitHubAccessToken({
      userId,
      encryptedGithubAccessToken: credentials.encryptedAccessToken,
      tokenExpiresAt: credentials.accessTokenExpiresAt,
    });
  }

  /**
   * Forces a GitHub user token refresh using the stored per-user credentials.
   * @param userId - Authenticated user id.
   * @returns The refreshed GitHub access token, or null when refresh is not possible.
   */
  async forceRefreshGitHubAccessTokenByUserId(
    userId: string,
  ): Promise<string | null> {
    return this.refreshGitHubAccessToken(userId);
  }

  async revokeAllSessionsByGithubId(githubId: number): Promise<void> {
    await this.repository.revokeAllSessionsByGithubId(githubId);
  }

  // ensures access token is valid, refreshing if needed.
  private async ensureValidGitHubAccessToken(params: {
    userId: string;
    encryptedGithubAccessToken: string;
    tokenExpiresAt: string | null;
  }): Promise<string | null> {
    const currentAccessToken = await decrypt(
      params.encryptedGithubAccessToken,
      this.env.TOKEN_ENCRYPTION_KEY,
    );

    if (
      !params.tokenExpiresAt
      || new Date(params.tokenExpiresAt).getTime() > Date.now()
    ) {
      return currentAccessToken;
    }

    // TODO: why does this live in this service? can it be moved to github?
    return this.refreshGitHubAccessToken(params.userId);
  }

  private async refreshGitHubAccessToken(userId: string): Promise<string | null> {
    const credentials = await this.repository.getGitHubCredentialsByUserId(userId);
    if (!credentials?.encryptedRefreshToken) {
      return null;
    }
    if (!this.githubTokenRefreshProvider) {
      logger.warn("Cannot refresh GitHub user token without refresh provider", {
        fields: { userId },
      });
      return null;
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

      return refreshed.accessToken;
    } catch (error) {
      logger.warn("Failed to refresh GitHub user token", {
        error,
        fields: { userId },
      });
      return null;
    }
  }
}
