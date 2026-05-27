import {
  failure,
  type GitHubAuthUrlResponse,
  type LogoutResponse,
  type Result,
  success,
  type TokenResponse,
  type UserInfo,
} from "@repo/shared";
import type { Logger } from "@repo/shared";
import { createLogger } from "@/shared/logging";
import type { Env } from "@/shared/types";
import { encrypt } from "@/shared/utils/crypto";
import type { AuthUser } from "../types/auth.types";
import {
  consumeValidOauthState,
  createOauthState,
  peekOauthRedirectOrigin,
} from "@/shared/services/oauth-state.service";
import { UserRepository } from "../repositories/user.repository";
import { UserSessionRepository } from "../repositories/user-session.repository";
import { validateRedirectOrigin } from "../utils/preview-origin.util";

type AuthServiceStatus = 400 | 500;

export interface AuthServiceError {
  domain: "auth";
  status: AuthServiceStatus;
  message: string;
  code:
    | "INVALID_ORIGIN"
    | "MISSING_OAUTH_CALLBACK_PARAMS"
    | "INVALID_OAUTH_STATE"
    | "GITHUB_TOKEN_EXCHANGE_FAILED"
    | "USER_CREATE_FAILED";
}

type AuthServiceResult<T> = Result<T, AuthServiceError>;

interface RequestLogFields {
  requestId: string | null;
  userAgent: string | null;
}

interface GitHubOAuthUser {
  id: number;
  login: string;
  name: string | null;
  avatarUrl: string;
}

interface GitHubOAuthTokenResult {
  accessToken: string;
  refreshToken: string | undefined;
  refreshTokenExpiresAt: string | undefined;
  expiresAt: string | undefined;
  user: GitHubOAuthUser;
}

/** Contract for github functions needed for auth */
export interface AuthGitHubClient {
  getAuthUrl(state: string): string;
  getInstallUrl(): string;
  exchangeOAuthCode(code: string): Promise<GitHubOAuthTokenResult>;
  hasInstallations(accessToken: string): Promise<boolean>;
}

export interface AuthServiceDeps {
  env: Env;
  github: AuthGitHubClient;
  logger?: Logger;
}

export class AuthService {
  private readonly env: Env;
  private readonly github: AuthGitHubClient;
  private readonly logger: Logger;
  private readonly userRepository: UserRepository;
  private readonly userSessionRepository: UserSessionRepository;

  constructor(deps: AuthServiceDeps) {
    const logger = deps.logger ?? createLogger("auth.service.ts");
    this.env = deps.env;
    this.github = deps.github;
    this.logger = logger.scope("auth.service.ts");
    this.userRepository = new UserRepository(deps.env.DB);
    this.userSessionRepository = new UserSessionRepository(deps.env.DB);
  }

  async createGitHubAuthorizationUrl(params: {
    requestedOrigin?: string;
  } & RequestLogFields): Promise<AuthServiceResult<GitHubAuthUrlResponse>> {
    const redirectOrigin = params.requestedOrigin ?? this.env.WEB_ORIGIN;
    const originResult = validateRedirectOrigin(redirectOrigin, this.env);
    if (!originResult.ok) {
      this.logger.warn("Rejecting GitHub OAuth start", {
        fields: { reason: originResult.error.message },
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

    this.logger.info("Starting GitHub OAuth flow", {
      fields: {
        expiresAt,
        redirectOrigin: originResult.value,
        requestId: params.requestId,
        userAgent: params.userAgent,
      },
    });

    await createOauthState(this.env, {
      state,
      expiresAt,
      redirectOrigin: originResult.value,
    });

    return success({
      url: this.github.getAuthUrl(state),
      state,
    });
  }

  async createGitHubCallbackRedirect(params: {
    code: string | undefined;
    state: string | undefined;
  }): Promise<AuthServiceResult<{ redirectUrl: string }>> {
    if (!params.code || !params.state) {
      this.logger.warn("OAuth callback missing code or state");
      return failure({
        domain: "auth",
        status: 400,
        code: "MISSING_OAUTH_CALLBACK_PARAMS",
        message: "Missing GitHub authorization code or state.",
      });
    }

    const storedOrigin = await peekOauthRedirectOrigin(this.env, params.state);
    if (!storedOrigin) {
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

    const originResult = validateRedirectOrigin(storedOrigin, this.env);
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

    const target = new URL("/api/auth/finalize", originResult.value);
    target.searchParams.set("code", params.code);
    target.searchParams.set("state", params.state);

    return success({ redirectUrl: target.toString() });
  }

  async exchangeGitHubAuthorizationCode(params: {
    code: string;
    state: string;
  } & RequestLogFields): Promise<AuthServiceResult<TokenResponse>> {
    this.logger.info("Received GitHub OAuth callback", {
      fields: {
        hasCode: Boolean(params.code),
        requestId: params.requestId,
        statePrefix: params.state?.slice(0, 8) ?? null,
        userAgent: params.userAgent,
      },
    });

    if (!params.code || !params.state) {
      this.logger.error("GitHub OAuth callback missing code or state", {
        fields: {
          hasCode: Boolean(params.code),
          hasState: Boolean(params.state),
          requestId: params.requestId,
        },
      });
      return failure({
        domain: "auth",
        status: 400,
        code: "MISSING_OAUTH_CALLBACK_PARAMS",
        message: "Missing code or state",
      });
    }

    if (!(await consumeValidOauthState(this.env, params.state))) {
      this.logger.error("GitHub OAuth callback rejected: invalid or expired state", {
        fields: {
          requestId: params.requestId,
          statePrefix: params.state.slice(0, 8),
        },
      });
      return failure({
        domain: "auth",
        status: 400,
        code: "INVALID_OAUTH_STATE",
        message: "Invalid or expired state",
      });
    }

    let result;
    try {
      result = await this.github.exchangeOAuthCode(params.code);
    } catch (error) {
      this.logger.error("GitHub OAuth code exchange failed", {
        error,
        fields: {
          requestId: params.requestId,
          statePrefix: params.state.slice(0, 8),
        },
      });
      return failure({
        domain: "auth",
        status: 400,
        code: "GITHUB_TOKEN_EXCHANGE_FAILED",
        message: "Failed to exchange OAuth code",
      });
    }

    const encryptedAccess = await encrypt(
      result.accessToken,
      this.env.TOKEN_ENCRYPTION_KEY,
    );
    const encryptedRefresh = result.refreshToken
      ? await encrypt(result.refreshToken, this.env.TOKEN_ENCRYPTION_KEY)
      : null;

    await this.userRepository.upsertGitHubUser({
      id: crypto.randomUUID(),
      githubId: result.user.id,
      githubLogin: result.user.login,
      githubName: result.user.name,
      githubAvatarUrl: result.user.avatarUrl,
    });

    const user = await this.userRepository.getByGitHubId(result.user.id);
    if (!user) {
      return failure({
        domain: "auth",
        status: 500,
        code: "USER_CREATE_FAILED",
        message: "Failed to create user",
      });
    }

    const sessionToken = crypto.randomUUID();
    const sessionExpiresAt = new Date(
      Date.now() + 30 * 24 * 60 * 60 * 1000,
    ).toISOString();

    await this.userSessionRepository.createAuthSessionWithGitHubCredentials({
      sessionToken,
      userId: user.id,
      sessionExpiresAt,
      encryptedAccessToken: encryptedAccess,
      accessTokenExpiresAt: result.expiresAt ?? null,
      encryptedRefreshToken: encryptedRefresh,
      refreshTokenExpiresAt: result.refreshTokenExpiresAt ?? null,
    });

    let hasInstallations = false;
    try {
      hasInstallations = await this.github.hasInstallations(result.accessToken);
    } catch (error) {
      this.logger.error("Failed to check for GitHub app installations", { error });
    }

    this.logger.info("GitHub OAuth login succeeded", {
      fields: {
        githubLogin: user.githubLogin,
        hasInstallations,
        requestId: params.requestId,
      },
    });

    return success({
      token: sessionToken,
      user: {
        id: user.id,
        login: user.githubLogin,
        name: user.githubName,
        avatarUrl: user.githubAvatarUrl,
      },
      hasInstallations,
      installUrl: this.github.getInstallUrl(),
    });
  }

  getCurrentUser(user: AuthUser): UserInfo {
    return {
      id: user.id,
      login: user.githubLogin,
      name: user.githubName,
      avatarUrl: user.githubAvatarUrl,
    };
  }

  async logout(sessionToken: string): Promise<LogoutResponse> {
    await this.userSessionRepository.deleteByToken(sessionToken);
    return { ok: true };
  }
}
