import {
  failure,
  type GitHubAuthUrlResponse,
  type GitHubReauthTokenResponse,
  type LogoutResponse,
  type NativeTokenResponse,
  type RefreshResponse,
  type Result,
  success,
  type TokenResponse,
  type UserInfo,
} from "@repo/shared";
import type { Logger } from "@repo/shared";
import { createLogger } from "@/shared/logging";
import type { Env } from "@/shared/types";
import {
  encrypt,
  generateOpaqueToken,
  sha256,
  timingSafeCompare,
} from "@/shared/utils/crypto";
import {
  consumeValidOauthState,
  createOauthState,
  peekOauthState,
} from "@/shared/services/oauth-state.service";
import { UserRepository } from "../repositories/user.repository";
import { UserSessionRepository } from "../repositories/user-session.repository";
import { validateRedirectOrigin } from "../utils/preview-origin.util";
import {
  looksLikeNativeRedirectUri,
  validateNativeRedirectUri,
} from "../utils/native-redirect.util";
import {
  GITHUB_LOGIN_OAUTH_PURPOSE,
  GITHUB_NATIVE_LOGIN_CONTINUATION_PURPOSE,
  GITHUB_NATIVE_LOGIN_OAUTH_PURPOSE,
  GITHUB_REAUTH_OAUTH_PURPOSE,
} from "../utils/github-auth-purpose";
import { NativeAccessTokenService } from "./native-access-token.service";
import { NativeGitHubInstallationService } from "./native-github-installation.service";
const WEB_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const REFRESH_TOKEN_TTL_MS = 60 * 24 * 60 * 60 * 1000;
const ROTATION_GRACE_MS = 60_000;

type AuthServiceStatus = 400 | 401 | 403 | 500;

export interface AuthServiceError {
  domain: "auth";
  status: AuthServiceStatus;
  message: string;
  code:
    | "INVALID_ORIGIN"
    | "MISSING_INSTALL_CALLBACK_PARAMS"
    | "INVALID_INSTALL_STATE"
    | "MISSING_OAUTH_CALLBACK_PARAMS"
    | "INVALID_OAUTH_STATE"
    | "GITHUB_TOKEN_EXCHANGE_FAILED"
    | "GITHUB_ACCOUNT_MISMATCH"
    | "USER_CREATE_FAILED"
    | "USER_NOT_FOUND"
    | "INVALID_REFRESH_TOKEN";
}

export type AuthServiceResult<T> = Result<T, AuthServiceError>;

export interface RequestLogFields {
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

interface GitHubLoginExchange {
  oauth: GitHubOAuthTokenResult;
  user: {
    id: string;
    githubId: number;
    githubLogin: string;
    githubName: string | null;
    githubAvatarUrl: string | null;
  };
  encryptedGitHubAccessToken: string;
  encryptedGitHubRefreshToken: string | null;
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
  clearRepoListingSync(userId: string): Promise<void>;
  logger?: Logger;
}

export class AuthService {
  private readonly env: Env;
  private readonly github: AuthGitHubClient;
  private readonly logger: Logger;
  private readonly userRepository: UserRepository;
  private readonly userSessionRepository: UserSessionRepository;
  private readonly nativeAccessTokenService: NativeAccessTokenService;
  private readonly nativeGitHubInstallationService: NativeGitHubInstallationService;

  constructor(deps: AuthServiceDeps) {
    const logger = deps.logger ?? createLogger("auth.service.ts");
    this.env = deps.env;
    this.github = deps.github;
    this.logger = logger.scope("auth.service.ts");
    this.userRepository = new UserRepository(deps.env.DB);
    this.userSessionRepository = new UserSessionRepository(deps.env.DB);
    this.nativeAccessTokenService = new NativeAccessTokenService(deps.env);
    this.nativeGitHubInstallationService = new NativeGitHubInstallationService({
      env: deps.env,
      getInstallUrl: () => deps.github.getInstallUrl(),
      clearRepoListingSync: deps.clearRepoListingSync,
      logger: this.logger,
    });
  }

  async createGitHubAuthorizationUrl(params: {
    requestedOrigin?: string;
    nativeRedirectUri?: string;
    continueToInstallation?: boolean;
  } & RequestLogFields): Promise<AuthServiceResult<GitHubAuthUrlResponse>> {
    let redirectTarget: string;
    if (params.nativeRedirectUri !== undefined) {
      // Native app flow: the callback 302s straight to a custom scheme.
      const nativeResult = validateNativeRedirectUri(
        params.nativeRedirectUri,
        this.env,
      );
      if (!nativeResult.ok) {
        this.logger.warn("Rejecting native GitHub OAuth start", {
          fields: { reason: nativeResult.error.message },
        });
        return failure({
          domain: "auth",
          status: 400,
          code: "INVALID_ORIGIN",
          message: nativeResult.error.message,
        });
      }
      redirectTarget = nativeResult.value;
    } else {
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
      redirectTarget = originResult.value;
    }

    const state = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

    this.logger.info("Starting GitHub OAuth flow", {
      fields: {
        expiresAt,
        redirectOrigin: redirectTarget,
        requestId: params.requestId,
        userAgent: params.userAgent,
      },
    });

    const usesNativeContinuation = params.nativeRedirectUri !== undefined
      && params.continueToInstallation;
    const continuationToken = usesNativeContinuation
      ? generateOpaqueToken()
      : undefined;
    await createOauthState(this.env, {
      state,
      expiresAt,
      redirectOrigin: redirectTarget,
      purpose: usesNativeContinuation
        ? GITHUB_NATIVE_LOGIN_OAUTH_PURPOSE
        : GITHUB_LOGIN_OAUTH_PURPOSE,
      codeVerifier: continuationToken ? await sha256(continuationToken) : null,
    });

    return success({
      url: this.github.getAuthUrl(state),
      state,
      continuationToken,
    });
  }

  async createGitHubInstallationUrl(params: {
    userId: string;
    nativeRedirectUri: string;
  } & RequestLogFields): Promise<AuthServiceResult<GitHubAuthUrlResponse>> {
    return this.nativeGitHubInstallationService.createUrl(params);
  }

  async createGitHubInstallationCallbackRedirect(params: {
    state: string | undefined;
  }): Promise<AuthServiceResult<{ redirectUrl: string }>> {
    return this.nativeGitHubInstallationService.createCallbackRedirect(params);
  }

  async createGitHubCallbackRedirect(params: {
    code: string | undefined;
    state: string | undefined;
  } & RequestLogFields): Promise<AuthServiceResult<{ redirectUrl: string }>> {
    if (!params.code || !params.state) {
      this.logger.warn("OAuth callback missing code or state");
      return failure({
        domain: "auth",
        status: 400,
        code: "MISSING_OAUTH_CALLBACK_PARAMS",
        message: "Missing GitHub authorization code or state.",
      });
    }

    const stateRecord = await peekOauthState(this.env, params.state);
    if (!stateRecord?.redirectOrigin) {
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

    // Native flow: bounce straight to the app's custom scheme. Checked first
    // because the web origin validator rejects URIs with paths.
    if (looksLikeNativeRedirectUri(stateRecord.redirectOrigin)) {
      const nativeResult = validateNativeRedirectUri(
        stateRecord.redirectOrigin,
        this.env,
      );
      if (!nativeResult.ok) {
        this.logger.error("OAuth callback rejected stored native redirect URI", {
          fields: { reason: nativeResult.error.message },
        });
        return failure({
          domain: "auth",
          status: 400,
          code: "INVALID_ORIGIN",
          message: nativeResult.error.message,
        });
      }

      if (stateRecord.purpose === GITHUB_NATIVE_LOGIN_OAUTH_PURPOSE) {
        if (!stateRecord.codeVerifier) {
          return failure({
            domain: "auth",
            status: 400,
            code: "INVALID_OAUTH_STATE",
            message: "Invalid or expired sign-in session. Try again.",
          });
        }
        const exchanged = await this.exchangeNativeGitHubIdentity({
          code: params.code,
          state: params.state,
          requestId: params.requestId,
          userAgent: params.userAgent,
        });
        if (!exchanged.ok) {
          return exchanged;
        }

        const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
        await createOauthState(this.env, {
          state: params.state,
          expiresAt,
          redirectOrigin: nativeResult.value,
          purpose: GITHUB_NATIVE_LOGIN_CONTINUATION_PURPOSE,
          userId: exchanged.value.user.id,
          codeVerifier: stateRecord.codeVerifier,
        });

        if (!exchanged.value.hasInstallations) {
          const installUrl = new URL(this.github.getInstallUrl());
          installUrl.searchParams.set("state", params.state);
          return success({ redirectUrl: installUrl.toString() });
        }

        const target = new URL(nativeResult.value);
        target.searchParams.set("state", params.state);
        return success({ redirectUrl: target.toString() });
      }

      const target = new URL(nativeResult.value);
      target.searchParams.set("code", params.code);
      target.searchParams.set("state", params.state);
      return success({ redirectUrl: target.toString() });
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

    const targetPath = stateRecord.purpose === GITHUB_REAUTH_OAUTH_PURPOSE
      ? "/api/auth/github/reauth/finalize"
      : "/api/auth/finalize";
    const target = new URL(targetPath, originResult.value);
    target.searchParams.set("code", params.code);
    target.searchParams.set("state", params.state);

    return success({ redirectUrl: target.toString() });
  }

  async exchangeGitHubAuthorizationCode(params: {
    code: string;
    state: string;
  } & RequestLogFields): Promise<AuthServiceResult<TokenResponse>> {
    const exchanged = await this.exchangeGitHubLoginCode({
      ...params,
      client: "web",
    });
    if (!exchanged.ok) {
      return exchanged;
    }

    const {
      oauth,
      user,
      encryptedGitHubAccessToken,
      encryptedGitHubRefreshToken,
    } = exchanged.value;
    const sessionToken = generateOpaqueToken();
    const sessionExpiresAt = new Date(
      Date.now() + WEB_SESSION_TTL_MS,
    ).toISOString();

    await this.userSessionRepository.createAuthSessionWithGitHubCredentials({
      sessionToken,
      userId: user.id,
      sessionExpiresAt,
      encryptedAccessToken: encryptedGitHubAccessToken,
      accessTokenExpiresAt: oauth.expiresAt ?? null,
      encryptedRefreshToken: encryptedGitHubRefreshToken,
      refreshTokenExpiresAt: oauth.refreshTokenExpiresAt ?? null,
    });

    const hasInstallations = await this.checkHasInstallations(oauth.accessToken);

    this.logger.info("GitHub OAuth login succeeded", {
      fields: {
        client: "web",
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

  async exchangeNativeGitHubAuthorizationCode(params: {
    code: string;
    state: string;
  } & RequestLogFields): Promise<AuthServiceResult<NativeTokenResponse>> {
    const exchanged = await this.exchangeNativeGitHubIdentity(params);
    if (!exchanged.ok) {
      return exchanged;
    }

    return this.issueNativeSession(
      exchanged.value.user,
      exchanged.value.hasInstallations,
      params.requestId,
    );
  }

  /** Completes a native login after OAuth and optional installation navigation. */
  async completeNativeGitHubLogin(params: {
    state: string;
    token: string;
  } & RequestLogFields): Promise<AuthServiceResult<NativeTokenResponse>> {
    const pendingStateRecord = await peekOauthState(this.env, params.state);
    const presentedTokenHash = await sha256(params.token);
    if (
      !pendingStateRecord?.userId
      || pendingStateRecord.purpose !== GITHUB_NATIVE_LOGIN_CONTINUATION_PURPOSE
      || !pendingStateRecord.redirectOrigin
      || !pendingStateRecord.codeVerifier
      || !timingSafeCompare(pendingStateRecord.codeVerifier, presentedTokenHash)
      || !validateNativeRedirectUri(pendingStateRecord.redirectOrigin, this.env).ok
    ) {
      return failure({
        domain: "auth",
        status: 400,
        code: "INVALID_OAUTH_STATE",
        message: "Native sign-in is not ready or has expired.",
      });
    }

    const stateRecord = await consumeValidOauthState(this.env, params.state);
    if (!stateRecord?.userId) {
      return failure({
        domain: "auth",
        status: 400,
        code: "INVALID_OAUTH_STATE",
        message: "Native sign-in is not ready or has expired.",
      });
    }

    const user = await this.userRepository.getById(stateRecord.userId);
    if (!user) {
      return failure({
        domain: "auth",
        status: 500,
        code: "USER_NOT_FOUND",
        message: "User not found",
      });
    }

    return this.issueNativeSession(user, undefined, params.requestId);
  }

  private async exchangeNativeGitHubIdentity(params: {
    code: string;
    state: string;
  } & RequestLogFields): Promise<AuthServiceResult<{
    user: GitHubLoginExchange["user"];
    hasInstallations: boolean;
  }>> {
    const exchanged = await this.exchangeGitHubLoginCode({
      ...params,
      client: "native",
    });
    if (!exchanged.ok) {
      return exchanged;
    }

    const {
      oauth,
      user,
      encryptedGitHubAccessToken,
      encryptedGitHubRefreshToken,
    } = exchanged.value;
    await this.userSessionRepository.upsertGitHubCredentials({
      userId: user.id,
      encryptedAccessToken: encryptedGitHubAccessToken,
      accessTokenExpiresAt: oauth.expiresAt ?? null,
      encryptedRefreshToken: encryptedGitHubRefreshToken,
      refreshTokenExpiresAt: oauth.refreshTokenExpiresAt ?? null,
    });

    const hasInstallations = await this.checkHasInstallations(oauth.accessToken);
    return success({ user, hasInstallations });
  }

  private async issueNativeSession(
    user: GitHubLoginExchange["user"],
    knownHasInstallations: boolean | undefined,
    requestId: string | null,
  ): Promise<AuthServiceResult<NativeTokenResponse>> {
    const refreshToken = generateOpaqueToken();
    const refreshTokenExpiresAt = new Date(
      Date.now() + REFRESH_TOKEN_TTL_MS,
    ).toISOString();
    const refreshSessionId = crypto.randomUUID();

    await this.userSessionRepository.createRefreshSession({
      refreshSessionId,
      userId: user.id,
      refreshTokenHash: await sha256(refreshToken),
      refreshExpiresAt: refreshTokenExpiresAt,
    });

    const accessToken = await this.nativeAccessTokenService.sign({
      userId: user.id,
      refreshSessionId,
    });
    const hasInstallations = knownHasInstallations ?? false;

    this.logger.info("GitHub OAuth login succeeded", {
      fields: {
        client: "native",
        githubLogin: user.githubLogin,
        hasInstallations,
        requestId,
      },
    });

    return success({
      accessToken,
      refreshToken,
      refreshTokenExpiresAt,
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

  private async exchangeGitHubLoginCode(params: {
    code: string;
    state: string;
    client: "web" | "native";
  } & RequestLogFields): Promise<AuthServiceResult<GitHubLoginExchange>> {
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

    const stateRecord = await peekOauthState(this.env, params.state);
    if (
      !stateRecord
      || (
        stateRecord.purpose !== null
        && stateRecord.purpose !== GITHUB_LOGIN_OAUTH_PURPOSE
        && !(
          params.client === "native"
          && stateRecord.purpose === GITHUB_NATIVE_LOGIN_OAUTH_PURPOSE
        )
      )
    ) {
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
    const redirectOrigin = stateRecord.redirectOrigin;
    const stateIsNative = redirectOrigin !== null
      && looksLikeNativeRedirectUri(redirectOrigin);
    if (params.client === "native") {
      if (
        redirectOrigin === null
        || !validateNativeRedirectUri(redirectOrigin, this.env).ok
      ) {
        this.logger.error("Native OAuth callback rejected: non-native state", {
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
    } else if (stateIsNative) {
      this.logger.error("Web OAuth callback rejected: native state", {
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
    const consumedStateRecord = await consumeValidOauthState(this.env, params.state);
    if (!consumedStateRecord) {
      this.logger.error("GitHub OAuth callback rejected: state already consumed", {
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

    let oauth: GitHubOAuthTokenResult;
    try {
      oauth = await this.github.exchangeOAuthCode(params.code);
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

    const encryptedGitHubAccessToken = await encrypt(
      oauth.accessToken,
      this.env.TOKEN_ENCRYPTION_KEY,
    );
    const encryptedGitHubRefreshToken = oauth.refreshToken
      ? await encrypt(oauth.refreshToken, this.env.TOKEN_ENCRYPTION_KEY)
      : null;

    await this.userRepository.upsertFromGitHubIdentity({
      id: crypto.randomUUID(),
      githubId: oauth.user.id,
      githubLogin: oauth.user.login,
      githubName: oauth.user.name,
      githubAvatarUrl: oauth.user.avatarUrl,
    });

    const user = await this.userRepository.getByGitHubId(oauth.user.id);
    if (!user) {
      return failure({
        domain: "auth",
        status: 500,
        code: "USER_CREATE_FAILED",
        message: "Failed to create user",
      });
    }

    return success({
      oauth,
      user,
      encryptedGitHubAccessToken,
      encryptedGitHubRefreshToken,
    });
  }

  private async checkHasInstallations(accessToken: string): Promise<boolean> {
    try {
      return await this.github.hasInstallations(accessToken);
    } catch (error) {
      this.logger.error("Failed to check for GitHub app installations", { error });
      return false;
    }
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

    await createOauthState(this.env, {
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

    const stateRecord = await consumeValidOauthState(this.env, params.state);
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
