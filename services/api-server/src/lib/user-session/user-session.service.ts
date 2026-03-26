import { decrypt, encrypt } from "@/lib/utils/crypto";
import { GitHubAppService } from "@/lib/github";
import { createLogger } from "@/lib/logger";
import type { Env } from "@/types";
import { UserSessionRepository } from "@/repositories/user-session-repository";

const logger = createLogger("user-session.service.ts");

export interface AuthenticatedUserSession {
  id: string;
  githubId: number;
  githubLogin: string;
  githubName: string | null;
  githubAvatarUrl: string | null;
  githubAccessToken: string;
}

export class UserSessionService {
  private readonly repository: UserSessionRepository;
  private readonly env: Env;

  constructor(env: Env) {
    this.env = env;
    this.repository = new UserSessionRepository(env.DB);
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
      sessionToken: session.sessionToken,
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
    const latestSession = await this.repository.getLatestActiveAuthSessionByUserId(userId);
    if (!latestSession) {
      return null;
    }

    return this.ensureValidGitHubAccessToken({
      userId,
      encryptedGithubAccessToken: latestSession.githubAccessToken,
      tokenExpiresAt: latestSession.tokenExpiresAt,
      sessionToken: latestSession.sessionToken,
    });
  }

  // ensures access token is valid, refreshing if needed.
  private async ensureValidGitHubAccessToken(params: {
    userId: string;
    encryptedGithubAccessToken: string;
    tokenExpiresAt: string | null;
    sessionToken: string;
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

    return this.refreshGitHubAccessToken({
      userId: params.userId,
      sessionToken: params.sessionToken,
    });
  }

  private async refreshGitHubAccessToken(params: {
    userId: string;
    sessionToken: string;
  }): Promise<string | null> {
    const encryptedRefreshToken = await this.repository.getRefreshTokenByUserId(
      params.userId,
    );
    if (!encryptedRefreshToken) {
      return null;
    }

    try {
      const github = new GitHubAppService(this.env, logger);
      const decryptedRefreshToken = await decrypt(
        encryptedRefreshToken,
        this.env.TOKEN_ENCRYPTION_KEY,
      );
      const refreshed = await github.refreshUserToken(decryptedRefreshToken);
      const encryptedAccessToken = await encrypt(
        refreshed.accessToken,
        this.env.TOKEN_ENCRYPTION_KEY,
      );
      const encryptedRefreshTokenNext = await encrypt(
        refreshed.refreshToken,
        this.env.TOKEN_ENCRYPTION_KEY,
      );

      await this.repository.updateSessionAndRefreshToken({
        sessionToken: params.sessionToken,
        githubAccessToken: encryptedAccessToken,
        tokenExpiresAt: refreshed.expiresAt,
        userId: params.userId,
        encryptedRefreshToken: encryptedRefreshTokenNext,
        refreshTokenExpiresAt: refreshed.refreshTokenExpiresAt ?? null,
      });

      return refreshed.accessToken;
    } catch (error) {
      logger.warn("Failed to refresh GitHub user token", {
        error,
        fields: { userId: params.userId },
      });
      return null;
    }
  }
}
