import {
  failure,
  type GitHubAuthUrlResponse,
  type GitHubReauthTokenResponse,
  type LogoutResponse,
  type RefreshResponse,
  success,
  type UserInfo,
} from "@repo/shared";
import type { Logger } from "@repo/shared";
import { createLogger } from "@/shared/logging";
import type { Env } from "@/shared/types";
import { encrypt, generateOpaqueToken, sha256 } from "@/shared/utils/crypto";
import {
  consumeValidExternalAuthState,
  createExternalAuthState,
  peekExternalAuthState,
} from "@/shared/services/external-auth-state.service";
import { UserRepository } from "../repositories/user.repository";
import { UserSessionRepository } from "../repositories/user-session.repository";
import type {
  AuthGitHubClient,
  AuthServiceError,
  AuthServiceResult,
  RequestLogFields,
} from "../types/auth.types";
import { validateRedirectOrigin } from "../utils/preview-origin.util";
import {
  GITHUB_LOGIN_OAUTH_PURPOSE,
  GITHUB_REAUTH_OAUTH_PURPOSE,
} from "../utils/github-auth-purpose";
import { NativeAccessTokenService } from "./native-access-token.service";
import { GitHubInstallationService } from "./github-installation.service";
import { GitHubSignInFlowService } from "./github-sign-in-flow.service";

const REFRESH_TOKEN_TTL_MS = 60 * 24 * 60 * 60 * 1000;
const ROTATION_GRACE_MS = 60_000;

export type {
  AuthGitHubClient,
  AuthServiceError,
  AuthServiceResult,
  RequestLogFields,
};

export interface AuthServiceDeps {
  env: Env;
  github: AuthGitHubClient;
  clearRepoListingSync(userId: string): Promise<void>;
  logger?: Logger;
}

/**
 * Session, GitHub reauthorization, and GitHub App installation behavior for an
 * already-known or already-authenticated user. New GitHub sign-ins belong to
 * `GitHubSignInFlowService`.
 */
export class AuthService {
  private readonly env: Env;
  private readonly github: AuthGitHubClient;
  private readonly logger: Logger;
  private readonly userRepository: UserRepository;
  private readonly userSessionRepository: UserSessionRepository;
  private readonly nativeAccessTokenService: NativeAccessTokenService;
  private readonly installationService: GitHubInstallationService;
  private readonly signInFlowService: GitHubSignInFlowService;

  constructor(deps: AuthServiceDeps) {
    const logger = deps.logger ?? createLogger("auth.service.ts");
    this.env = deps.env;
    this.github = deps.github;
    this.logger = logger.scope("auth.service.ts");
    this.userRepository = new UserRepository(deps.env.DB);
    this.userSessionRepository = new UserSessionRepository(deps.env.DB);
    this.nativeAccessTokenService = new NativeAccessTokenService(deps.env);
    this.installationService = new GitHubInstallationService({
      env: deps.env,
      getInstallUrl: () => deps.github.getInstallUrl(),
      clearRepoListingSync: deps.clearRepoListingSync,
      logger: this.logger,
    });
    this.signInFlowService = new GitHubSignInFlowService(deps);
  }

  async createGitHubInstallationUrl(params: {
    userId: string;
    nativeRedirectUri: string;
  } & RequestLogFields): Promise<AuthServiceResult<GitHubAuthUrlResponse>> {
    return this.installationService.createUrl(params);
  }

  async createGitHubInstallationCallbackRedirect(params: {
    state: string | undefined;
  }): Promise<AuthServiceResult<{ redirectUrl: string }>> {
    return this.installationService.createCallbackRedirect(params);
  }

  /**
   * GET /auth/callback dispatch.
   *
   * The state row's purpose decides the flow: a sign-in attempt is completed
   * server-side by `GitHubSignInFlowService`, while GitHub reauthorization
   * still bounces its code to the originating web origin.
   */
  async createGitHubCallbackRedirect(params: {
    code: string | undefined;
    state: string | undefined;
    oauthError: string | undefined;
  } & RequestLogFields): Promise<AuthServiceResult<{ redirectUrl: string }>> {
    if (!params.state) {
      this.logger.warn("OAuth callback missing state");
      return failure({
        domain: "auth",
        status: 400,
        code: "MISSING_OAUTH_CALLBACK_PARAMS",
        message: "Missing GitHub authorization state.",
      });
    }

    const stateRecord = await peekExternalAuthState(this.env, params.state);
    if (!stateRecord) {
      this.logger.warn("OAuth callback failed due to unknown or expired state", {
        fields: { statePrefix: params.state.slice(0, 8) },
      });
      return failure({
        domain: "auth",
        status: 400,
        code: "INVALID_OAUTH_STATE",
        message: "Invalid or expired sign-in session. Try again.",
      });
    }

    if (stateRecord.purpose === GITHUB_LOGIN_OAUTH_PURPOSE) {
      return this.signInFlowService.handleOAuthCallback({
        code: params.code,
        oauthError: params.oauthError,
        state: params.state,
        requestId: params.requestId,
        userAgent: params.userAgent,
      });
    }

    if (
      stateRecord.purpose !== GITHUB_REAUTH_OAUTH_PURPOSE
      || !stateRecord.redirectOrigin
      || !params.code
    ) {
      return failure({
        domain: "auth",
        status: 400,
        code: "INVALID_OAUTH_STATE",
        message: "Invalid or expired sign-in session. Try again.",
      });
    }

    const originResult = validateRedirectOrigin(stateRecord.redirectOrigin, this.env);
    if (!originResult.ok) {
      this.logger.error("OAuth callback rejected stored origin", {
        fields: { reason: originResult.error.message },
      });
      return failure({
        domain: "auth",
        status: 400,
        code: "INVALID_ORIGIN",
        message: originResult.error.message,
      });
    }

    const target = new URL("/api/auth/github/reauth/finalize", originResult.value);
    target.searchParams.set("code", params.code);
    target.searchParams.set("state", params.state);

    return success({ redirectUrl: target.toString() });
  }

  async createGitHubReauthAuthorizationUrl(params: {
    userId: string;
    requestedOrigin?: string;
  } & RequestLogFields): Promise<AuthServiceResult<GitHubAuthUrlResponse>> {
    const redirectOrigin = params.requestedOrigin ?? this.env.WEB_ORIGIN;
    const originResult = validateRedirectOrigin(redirectOrigin, this.env);
    if (!originResult.ok) {
      this.logger.warn("Rejecting GitHub reauth start", {
        fields: { reason: originResult.error.message, userId: params.userId },
      });
      return failure({
        domain: "auth",
        status: 400,
        code: "INVALID_ORIGIN",
        message: originResult.error.message,
      });
    }

    const state = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

    this.logger.info("Starting GitHub reauth flow", {
      fields: {
        expiresAt,
        redirectOrigin: originResult.value,
        requestId: params.requestId,
        userAgent: params.userAgent,
        userId: params.userId,
      },
    });

    await createExternalAuthState(this.env, {
      state,
      expiresAt,
      redirectOrigin: originResult.value,
      purpose: GITHUB_REAUTH_OAUTH_PURPOSE,
      userId: params.userId,
    });

    return success({
      url: this.github.getAuthUrl(state),
      state,
    });
  }

  async exchangeGitHubReauthCode(params: {
    userId: string;
    code: string;
    state: string;
  } & RequestLogFields): Promise<AuthServiceResult<GitHubReauthTokenResponse>> {
    if (!params.code || !params.state) {
      this.logger.error("GitHub reauth callback missing code or state", {
        fields: {
          hasCode: Boolean(params.code),
          hasState: Boolean(params.state),
          requestId: params.requestId,
          userId: params.userId,
        },
      });
      return failure({
        domain: "auth",
        status: 400,
        code: "MISSING_OAUTH_CALLBACK_PARAMS",
        message: "Missing code or state",
      });
    }

    const stateRecord = await consumeValidExternalAuthState(this.env, params.state);
    if (
      !stateRecord
      || stateRecord.purpose !== GITHUB_REAUTH_OAUTH_PURPOSE
      || stateRecord.userId !== params.userId
    ) {
      this.logger.error("GitHub reauth callback rejected: invalid or expired state", {
        fields: {
          requestId: params.requestId,
          statePrefix: params.state.slice(0, 8),
          userId: params.userId,
        },
      });
      return failure({
        domain: "auth",
        status: 400,
        code: "INVALID_OAUTH_STATE",
        message: "Invalid or expired state",
      });
    }

    const currentUser = await this.userRepository.getById(params.userId);
    if (!currentUser) {
      this.logger.warn("GitHub reauth callback rejected: user not found", {
        fields: {
          requestId: params.requestId,
          userId: params.userId,
        },
      });
      return failure({
        domain: "auth",
        status: 401,
        code: "USER_NOT_FOUND",
        message: "User not found",
      });
    }

    let result;
    try {
      result = await this.github.exchangeOAuthCode(params.code);
    } catch (error) {
      this.logger.error("GitHub reauth OAuth code exchange failed", {
        error,
        fields: {
          requestId: params.requestId,
          statePrefix: params.state.slice(0, 8),
          userId: params.userId,
        },
      });
      return failure({
        domain: "auth",
        status: 400,
        code: "GITHUB_TOKEN_EXCHANGE_FAILED",
        message: "Failed to exchange OAuth code",
      });
    }

    if (result.user.id !== currentUser.githubId) {
      this.logger.warn("GitHub reauth account mismatch", {
        fields: {
          expectedGithubId: currentUser.githubId,
          actualGithubId: result.user.id,
          userId: params.userId,
        },
      });
      return failure({
        domain: "auth",
        status: 403,
        code: "GITHUB_ACCOUNT_MISMATCH",
        message: "Reconnect using the same GitHub account.",
      });
    }

    const encryptedGitHubAccessToken = await encrypt(
      result.accessToken,
      this.env.TOKEN_ENCRYPTION_KEY,
    );
    const encryptedGitHubRefreshToken = result.refreshToken
      ? await encrypt(result.refreshToken, this.env.TOKEN_ENCRYPTION_KEY)
      : null;

    await this.userRepository.upsertFromGitHubIdentity({
      id: crypto.randomUUID(),
      githubId: result.user.id,
      githubLogin: result.user.login,
      githubName: result.user.name,
      githubAvatarUrl: result.user.avatarUrl,
    });
    await this.userSessionRepository.upsertGitHubCredentials({
      userId: params.userId,
      encryptedAccessToken: encryptedGitHubAccessToken,
      accessTokenExpiresAt: result.expiresAt ?? null,
      encryptedRefreshToken: encryptedGitHubRefreshToken,
      refreshTokenExpiresAt: result.refreshTokenExpiresAt ?? null,
    });

    this.logger.info("GitHub reauth succeeded", {
      fields: {
        githubLogin: result.user.login,
        requestId: params.requestId,
        userId: params.userId,
      },
    });

    return success({
      ok: true,
      installUrl: this.github.getInstallUrl(),
    });
  }

  async getCurrentUser(userId: string): Promise<AuthServiceResult<UserInfo>> {
    const user = await this.userRepository.getById(userId);
    if (!user) {
      return failure({
        domain: "auth",
        status: 401,
        code: "USER_NOT_FOUND",
        message: "User not found",
      });
    }

    return success({
      id: user.id,
      login: user.githubLogin,
      name: user.githubName,
      avatarUrl: user.githubAvatarUrl,
    });
  }

  /**
   * Rotate a native session: validate the refresh token (current hash, or the
   * previous hash within the 60s grace window), mint a new access/refresh
   * pair, and slide the refresh expiry. Reuse of the previous token outside
   * the grace window revokes the whole session family.
   */
  async refreshSession(
    refreshToken: string,
  ): Promise<AuthServiceResult<RefreshResponse>> {
    const invalid = failure<AuthServiceError>({
      domain: "auth",
      status: 401,
      code: "INVALID_REFRESH_TOKEN",
      message: "Invalid refresh token",
    });

    const presentedHash = await sha256(refreshToken);
    const found = await this.userSessionRepository.getRefreshSessionByTokenHash(
      presentedHash,
    );
    if (!found) {
      this.logger.warn("Refresh rejected: unknown token");
      return invalid;
    }
    if (new Date(found.refreshExpiresAt).getTime() <= Date.now()) {
      this.logger.warn("Refresh rejected: expired", {
        fields: { refreshSessionId: found.id },
      });
      return invalid;
    }
    if (found.matched === "previous") {
      // previousRotatedAt is ISO-8601 (normalized by the repository query)
      const rotatedAt = found.previousRotatedAt
        ? new Date(found.previousRotatedAt).getTime()
        : 0;
      if (Date.now() - rotatedAt > ROTATION_GRACE_MS) {
        this.logger.warn("Refresh token reuse detected; revoking family", {
          fields: { refreshSessionId: found.id, userId: found.userId },
        });
        await this.userSessionRepository.revokeRefreshSession(found.id);
        return invalid;
      }
    }

    const newRefreshToken = generateOpaqueToken();
    const refreshTokenExpiresAt = new Date(
      Date.now() + REFRESH_TOKEN_TTL_MS,
    ).toISOString();
    const user = await this.userRepository.getById(found.userId);
    if (!user) {
      this.logger.warn("Refresh rejected: user missing", {
        fields: { refreshSessionId: found.id, userId: found.userId },
      });
      await this.userSessionRepository.revokeRefreshSession(found.id);
      return invalid;
    }

    await this.userSessionRepository.rotateRefreshSession({
      refreshSessionId: found.id,
      userId: found.userId,
      newRefreshTokenHash: await sha256(newRefreshToken),
      previousRefreshTokenHash: presentedHash,
      refreshExpiresAt: refreshTokenExpiresAt,
    });
    const accessToken = await this.nativeAccessTokenService.sign({
      userId: user.id,
      refreshSessionId: found.id,
    });

    this.logger.info("Refreshed native session", {
      fields: { refreshSessionId: found.id, userId: found.userId },
    });

    return success({
      accessToken,
      refreshToken: newRefreshToken,
      refreshTokenExpiresAt,
    });
  }

  async logout(sessionToken: string): Promise<LogoutResponse> {
    await this.userSessionRepository.deleteByToken(sessionToken);
    return { ok: true };
  }

  async logoutNative(refreshToken: string): Promise<LogoutResponse> {
    const refreshSession = await this.userSessionRepository
      .getRefreshSessionByTokenHash(await sha256(refreshToken));
    if (refreshSession) {
      await this.userSessionRepository.revokeRefreshSession(refreshSession.id);
    }
    return { ok: true };
  }
}
