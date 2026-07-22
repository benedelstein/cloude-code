import {
  failure,
  type GitHubSignInStartResponse,
  type NativeGitHubSignInCompleteResponse,
  success,
  type UserInfo,
  type WebGitHubSignInCompleteResponse,
} from "@repo/shared";
import type { Logger } from "@repo/shared";
import { createLogger } from "@/shared/logging";
import type { Env } from "@/shared/types";
import { encrypt, generateOpaqueToken, sha256 } from "@/shared/utils/crypto";
import {
  consumeValidExternalAuthState,
  createExternalAuthState,
} from "@/shared/services/external-auth-state.service";
import type {
  AuthGitHubClient,
  AuthServiceResult,
  RequestLogFields,
} from "../types/auth.types";
import { UserRepository } from "../repositories/user.repository";
import { UserSessionRepository } from "../repositories/user-session.repository";
import {
  SignInAttemptRepository,
  type SignInAttemptRecord,
  type SignInClientType,
} from "../repositories/sign-in-attempt.repository";
import { GITHUB_LOGIN_OAUTH_PURPOSE } from "../utils/github-auth-purpose";
import { validateNativeRedirectUri } from "../utils/native-redirect.util";
import { validateRedirectOrigin } from "../utils/preview-origin.util";
import { validateReturnToPath } from "../utils/return-to.util";
import { GitHubInstallationService } from "./github-installation.service";
import { NativeAccessTokenService } from "./native-access-token.service";

/** The BFF route that claims a web attempt and sets the session cookie. */
export const WEB_SIGN_IN_COMPLETE_PATH = "/api/auth/github/complete";

const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;
/** Web claims its session immediately after OAuth, before any installation. */
const WEB_ATTEMPT_TTL_MS = 10 * 60 * 1000;
/**
 * One `ASWebAuthenticationSession` covers OAuth, repository selection, and an
 * organization-approval request before iOS can claim anything.
 */
const NATIVE_ATTEMPT_TTL_MS = 30 * 60 * 1000;

const WEB_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const REFRESH_TOKEN_TTL_MS = 60 * 24 * 60 * 60 * 1000;

export interface GitHubSignInFlowDeps {
  env: Env;
  github: AuthGitHubClient;
  clearRepoListingSync(userId: string): Promise<void>;
  logger?: Logger;
}

/**
 * One server-owned GitHub sign-in state machine for every client.
 *
 * Both clients start an attempt, hand the browser to GitHub, and later claim
 * the completed identity with a raw claim token. The server exchanges the
 * authorization code exactly once and never forwards it to a client. Only
 * the final credential issuance is client-specific: web gets an opaque
 * session token, native gets an access/refresh pair.
 */
export class GitHubSignInFlowService {
  private readonly env: Env;
  private readonly github: AuthGitHubClient;
  private readonly logger: Logger;
  private readonly attempts: SignInAttemptRepository;
  private readonly userRepository: UserRepository;
  private readonly userSessionRepository: UserSessionRepository;
  private readonly nativeAccessTokenService: NativeAccessTokenService;
  private readonly installationService: GitHubInstallationService;

  constructor(deps: GitHubSignInFlowDeps) {
    const logger = deps.logger ?? createLogger("github-sign-in-flow.service.ts");
    this.env = deps.env;
    this.github = deps.github;
    this.logger = logger.scope("github-sign-in-flow.service.ts");
    this.attempts = new SignInAttemptRepository(deps.env.DB);
    this.userRepository = new UserRepository(deps.env.DB);
    this.userSessionRepository = new UserSessionRepository(deps.env.DB);
    this.nativeAccessTokenService = new NativeAccessTokenService(deps.env);
    this.installationService = new GitHubInstallationService({
      env: deps.env,
      getInstallUrl: () => deps.github.getInstallUrl(),
      clearRepoListingSync: deps.clearRepoListingSync,
      logger: this.logger,
    });
  }

  /** Creates a web-bound attempt for the BFF start route. */
  async startWeb(params: {
    origin: string;
    returnTo: string;
  } & RequestLogFields): Promise<AuthServiceResult<GitHubSignInStartResponse>> {
    const originResult = validateRedirectOrigin(params.origin, this.env);
    if (!originResult.ok) {
      this.logger.warn("Rejecting web GitHub sign-in start", {
        fields: { reason: originResult.error.message },
      });
      return failure({
        domain: "auth",
        status: 400,
        code: "INVALID_ORIGIN",
        message: originResult.error.message,
      });
    }

    const returnToResult = validateReturnToPath(params.returnTo);
    if (!returnToResult.ok) {
      this.logger.warn("Rejecting web GitHub sign-in start", {
        fields: { reason: returnToResult.error.message },
      });
      return failure({
        domain: "auth",
        status: 400,
        code: "INVALID_RETURN_TO",
        message: returnToResult.error.message,
      });
    }

    return this.createAttempt({
      clientType: "web",
      completionTarget: originResult.value,
      returnTo: returnToResult.value,
      ttlMs: WEB_ATTEMPT_TTL_MS,
      requestId: params.requestId,
      userAgent: params.userAgent,
    });
  }

  /** Creates a native-bound attempt for the iOS start route. */
  async startNative(params: {
    redirectUri: string;
  } & RequestLogFields): Promise<AuthServiceResult<GitHubSignInStartResponse>> {
    const redirectResult = validateNativeRedirectUri(params.redirectUri, this.env);
    if (!redirectResult.ok) {
      this.logger.warn("Rejecting native GitHub sign-in start", {
        fields: { reason: redirectResult.error.message },
      });
      return failure({
        domain: "auth",
        status: 400,
        code: "INVALID_ORIGIN",
        message: redirectResult.error.message,
      });
    }

    return this.createAttempt({
      clientType: "native",
      completionTarget: redirectResult.value,
      returnTo: null,
      ttlMs: NATIVE_ATTEMPT_TTL_MS,
      requestId: params.requestId,
      userAgent: params.userAgent,
    });
  }

  /**
   * Handles the GitHub OAuth callback for a sign-in attempt: consumes the
   * one-time state, exchanges the code, persists identity and credentials,
   * decides whether installation is needed, and hands the browser onward.
   */
  async handleOAuthCallback(params: {
    code: string | undefined;
    oauthError: string | undefined;
    state: string;
  } & RequestLogFields): Promise<AuthServiceResult<{ redirectUrl: string }>> {
    const stateRecord = await consumeValidExternalAuthState(this.env, params.state);
    if (
      stateRecord?.purpose !== GITHUB_LOGIN_OAUTH_PURPOSE
      || !stateRecord.signInAttemptId
    ) {
      this.logger.warn("Sign-in OAuth callback rejected: invalid or consumed state", {
        fields: {
          requestId: params.requestId,
          statePrefix: params.state.slice(0, 8),
        },
      });
      return this.invalidOAuthState();
    }

    const attempt = await this.attempts.getUnexpired(stateRecord.signInAttemptId);
    if (!attempt || attempt.status !== "awaiting_oauth") {
      this.logger.warn("Sign-in OAuth callback rejected: attempt is not awaiting OAuth", {
        fields: {
          attemptIdPrefix: stateRecord.signInAttemptId.slice(0, 8),
          requestId: params.requestId,
        },
      });
      return this.invalidOAuthState();
    }

    if (params.oauthError || !params.code) {
      await this.attempts.markFailed(attempt.id);
      this.logger.info("GitHub sign-in denied at GitHub", {
        fields: {
          attemptIdPrefix: attempt.id.slice(0, 8),
          clientType: attempt.clientType,
          requestId: params.requestId,
        },
      });
      return success({
        redirectUrl: this.clientCallbackUrl(attempt, "OAUTH_DENIED"),
      });
    }

    const exchanged = await this.exchangeIdentity(params.code, params);
    if (!exchanged) {
      await this.attempts.markFailed(attempt.id);
      return success({
        redirectUrl: this.clientCallbackUrl(attempt, "SIGN_IN_FAILED"),
      });
    }

    const { user, githubAccessToken } = exchanged;
    await this.attempts.markIdentityReady({
      id: attempt.id,
      userId: user.id,
    });

    const hasInstallations = await this.checkHasInstallations(githubAccessToken);
    let installUrl: string | null = null;
    if (!hasInstallations) {
      try {
        const candidate = await this.installationService.createSignInInstallationUrl({
          clientType: attempt.clientType,
          userId: user.id,
          signInAttemptId: attempt.id,
          returnTarget: attempt.clientType === "web" ? this.finalReturnUrl(attempt) : null,
        });
        await this.attempts.setInstallUrl({ id: attempt.id, installUrl: candidate });
        installUrl = candidate;
      } catch (error) {
        this.logger.error("Failed to prepare optional GitHub installation", {
          error,
          fields: {
            attemptIdPrefix: attempt.id.slice(0, 8),
            clientType: attempt.clientType,
            requestId: params.requestId,
          },
        });
      }
    }

    this.logger.info("GitHub sign-in identity ready", {
      fields: {
        attemptIdPrefix: attempt.id.slice(0, 8),
        clientType: attempt.clientType,
        hasInstallations,
        installationPrepared: installUrl !== null,
        requestId: params.requestId,
      },
    });

    // Web reaches its final auth handoff before optional installation. Native
    // without an installation reaches its final handoff from the setup callback.
    if (attempt.clientType === "web") {
      return this.issueCompletionCallback(attempt);
    }

    return installUrl
      ? success({ redirectUrl: installUrl })
      : this.issueCompletionCallback(attempt);
  }

  /** Issues the opaque web session for an identity-ready web attempt. */
  async completeWeb(params: {
    attemptId: string;
    claimToken: string;
    completionCode: string;
  } & RequestLogFields): Promise<AuthServiceResult<WebGitHubSignInCompleteResponse>> {
    const claimed = await this.claim(params, "web");
    if (!claimed.ok) {
      return claimed;
    }

    const { attempt, user } = claimed.value;
    const sessionToken = generateOpaqueToken();
    await this.userSessionRepository.createAuthSession(
      sessionToken,
      user.id,
      new Date(Date.now() + WEB_SESSION_TTL_MS).toISOString(),
    );

    this.logger.info("GitHub sign-in completed", {
      fields: {
        attemptIdPrefix: attempt.id.slice(0, 8),
        clientType: "web",
        githubLogin: user.githubLogin,
        requestId: params.requestId,
      },
    });

    return success({
      token: sessionToken,
      user: toUserInfo(user),
      redirectUrl: attempt.installUrl ?? this.finalReturnUrl(attempt),
    });
  }

  /** Issues the native access/refresh pair for an identity-ready native attempt. */
  async completeNative(params: {
    attemptId: string;
    claimToken: string;
    completionCode: string;
  } & RequestLogFields): Promise<AuthServiceResult<NativeGitHubSignInCompleteResponse>> {
    const claimed = await this.claim(params, "native");
    if (!claimed.ok) {
      return claimed;
    }

    const { attempt, user } = claimed.value;
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

    this.logger.info("GitHub sign-in completed", {
      fields: {
        attemptIdPrefix: attempt.id.slice(0, 8),
        clientType: "native",
        githubLogin: user.githubLogin,
        requestId: params.requestId,
      },
    });

    return success({
      accessToken,
      refreshToken,
      refreshTokenExpiresAt,
      user: toUserInfo(user),
    });
  }

  private async createAttempt(params: {
    clientType: SignInClientType;
    completionTarget: string;
    returnTo: string | null;
    ttlMs: number;
  } & RequestLogFields): Promise<AuthServiceResult<GitHubSignInStartResponse>> {
    await this.attempts.deleteExpired();

    const attemptId = crypto.randomUUID();
    const claimToken = generateOpaqueToken();
    const state = crypto.randomUUID();

    await this.attempts.create({
      id: attemptId,
      clientType: params.clientType,
      claimTokenHash: await sha256(claimToken),
      completionTarget: params.completionTarget,
      returnTo: params.returnTo,
      expiresAt: new Date(Date.now() + params.ttlMs).toISOString(),
    });
    await createExternalAuthState(this.env, {
      state,
      expiresAt: new Date(Date.now() + OAUTH_STATE_TTL_MS).toISOString(),
      purpose: GITHUB_LOGIN_OAUTH_PURPOSE,
      signInAttemptId: attemptId,
    });

    this.logger.info("Starting GitHub sign-in", {
      fields: {
        attemptIdPrefix: attemptId.slice(0, 8),
        clientType: params.clientType,
        requestId: params.requestId,
        userAgent: params.userAgent,
      },
    });

    return success({
      authorizeUrl: this.github.getAuthUrl(state),
      attemptId,
      claimToken,
    });
  }

  /**
   * Verifies both browser-separated secrets and atomically consumes the exact
   * pair so concurrent or repeated claims cannot issue a second session.
   */
  private async claim(
    params: { attemptId: string; claimToken: string; completionCode: string },
    clientType: SignInClientType,
  ): Promise<AuthServiceResult<{
    attempt: SignInAttemptRecord;
    user: SignedInUser;
  }>> {
    const claimTokenHash = await sha256(params.claimToken);
    const completionCodeHash = await sha256(params.completionCode);
    const consumed = await this.attempts.claim({
      id: params.attemptId,
      claimTokenHash,
      completionCodeHash,
      clientType,
    });
    if (!consumed?.userId) {
      return this.invalidAttempt();
    }

    const user = await this.userRepository.getById(consumed.userId);
    if (!user) {
      return failure({
        domain: "auth",
        status: 500,
        code: "USER_NOT_FOUND",
        message: "User not found",
      });
    }

    return success({ attempt: consumed, user });
  }

  /**
   * Exchanges the authorization code and persists identity and credentials.
   * Returns `null` when the identity could not be established; the caller
   * turns that into a failed attempt and a client-visible error redirect.
   */
  private async exchangeIdentity(
    code: string,
    log: RequestLogFields,
  ): Promise<{ user: SignedInUser; githubAccessToken: string } | null> {
    let oauth;
    try {
      oauth = await this.github.exchangeOAuthCode(code);
    } catch (error) {
      this.logger.error("GitHub OAuth code exchange failed", {
        error,
        fields: { requestId: log.requestId },
      });
      return null;
    }

    await this.userRepository.upsertFromGitHubIdentity({
      id: crypto.randomUUID(),
      githubId: oauth.user.id,
      githubLogin: oauth.user.login,
      githubName: oauth.user.name,
      githubAvatarUrl: oauth.user.avatarUrl,
    });
    const user = await this.userRepository.getByGitHubId(oauth.user.id);
    if (!user) {
      this.logger.error("GitHub sign-in failed to create user", {
        fields: { requestId: log.requestId },
      });
      return null;
    }

    // GitHub credentials are persisted independently of any app session, so a
    // client that never claims still leaves a usable credential behind.
    await this.userSessionRepository.upsertGitHubCredentials({
      userId: user.id,
      encryptedAccessToken: await encrypt(
        oauth.accessToken,
        this.env.TOKEN_ENCRYPTION_KEY,
      ),
      accessTokenExpiresAt: oauth.expiresAt ?? null,
      encryptedRefreshToken: oauth.refreshToken
        ? await encrypt(oauth.refreshToken, this.env.TOKEN_ENCRYPTION_KEY)
        : null,
      refreshTokenExpiresAt: oauth.refreshTokenExpiresAt ?? null,
    });

    return { user, githubAccessToken: oauth.accessToken };
  }

  private async checkHasInstallations(accessToken: string): Promise<boolean> {
    try {
      return await this.github.hasInstallations(accessToken);
    } catch (error) {
      this.logger.error("Failed to check for GitHub app installations", { error });
      return false;
    }
  }

  /** The bound client's final callback. */
  private clientCallbackUrl(
    attempt: SignInAttemptRecord,
    errorCode: string | null,
    completionCode: string | null = null,
  ): string {
    const target = attempt.clientType === "web"
      ? new URL(WEB_SIGN_IN_COMPLETE_PATH, attempt.completionTarget)
      : new URL(attempt.completionTarget);
    target.searchParams.set("attemptId", attempt.id);
    if (errorCode) {
      target.searchParams.set("error", errorCode);
    }
    if (completionCode) {
      target.searchParams.set("completionCode", completionCode);
    }
    return target.toString();
  }

  private async issueCompletionCallback(
    attempt: SignInAttemptRecord,
  ): Promise<AuthServiceResult<{ redirectUrl: string }>> {
    const completionCode = await this.attempts.issueCompletionCode(attempt.id);
    if (!completionCode) {
      return this.invalidAttempt();
    }
    return success({
      redirectUrl: this.clientCallbackUrl(attempt, null, completionCode),
    });
  }

  /** Returns the final client target after optional GitHub App installation. */
  private finalReturnUrl(attempt: SignInAttemptRecord): string {
    return attempt.clientType === "web"
      ? new URL(attempt.returnTo ?? "/", attempt.completionTarget).toString()
      : attempt.completionTarget;
  }

  private invalidAttempt(): AuthServiceResult<never> {
    return failure({
      domain: "auth",
      status: 400,
      code: "INVALID_SIGN_IN_ATTEMPT",
      message: "Invalid or expired sign-in attempt. Try again.",
    });
  }

  private invalidOAuthState(): AuthServiceResult<never> {
    return failure({
      domain: "auth",
      status: 400,
      code: "INVALID_OAUTH_STATE",
      message: "Invalid or expired sign-in session. Try again.",
    });
  }
}

interface SignedInUser {
  id: string;
  githubLogin: string;
  githubName: string | null;
  githubAvatarUrl: string | null;
}

function toUserInfo(user: SignedInUser): UserInfo {
  return {
    id: user.id,
    login: user.githubLogin,
    name: user.githubName,
    avatarUrl: user.githubAvatarUrl,
  };
}
