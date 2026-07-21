import { failure, type GitHubAuthUrlResponse, success } from "@repo/shared";
import type { Logger } from "@repo/shared";
import type { Env } from "@/shared/types";
import {
  consumeValidOauthState,
  createOauthState,
  peekOauthState,
} from "@/shared/services/oauth-state.service";
import type { AuthServiceResult, RequestLogFields } from "./auth.service";
import {
  GITHUB_INSTALL_PURPOSE,
  GITHUB_NATIVE_LOGIN_CONTINUATION_PURPOSE,
} from "../utils/github-auth-purpose";
import {
  nativeInstallRedirectUri,
  validateNativeInstallRedirectUri,
  validateNativeRedirectUri,
} from "../utils/native-redirect.util";

/** Handles native GitHub App installation URLs and their setup callbacks. */
export class NativeGitHubInstallationService {
  constructor(private readonly deps: {
    env: Env;
    getInstallUrl(): string;
    clearRepoListingSync(userId: string): Promise<void>;
    logger: Logger;
  }) {}

  /** Creates a one-time installation URL paired with an allowlisted native callback. */
  async createUrl(params: {
    userId: string;
    nativeRedirectUri: string;
  } & RequestLogFields): Promise<AuthServiceResult<GitHubAuthUrlResponse>> {
    const redirectResult = nativeInstallRedirectUri(
      params.nativeRedirectUri,
      this.deps.env,
    );
    if (!redirectResult.ok) {
      this.deps.logger.warn("Rejecting native GitHub installation start", {
        fields: { reason: redirectResult.error.message, userId: params.userId },
      });
      return failure({
        domain: "auth",
        status: 400,
        code: "INVALID_ORIGIN",
        message: redirectResult.error.message,
      });
    }

    const state = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    await createOauthState(this.deps.env, {
      state,
      expiresAt,
      redirectOrigin: redirectResult.value,
      purpose: GITHUB_INSTALL_PURPOSE,
      userId: params.userId,
    });

    const installUrl = new URL(this.deps.getInstallUrl());
    installUrl.searchParams.set("state", state);
    this.deps.logger.info("Starting native GitHub installation flow", {
      fields: {
        expiresAt,
        requestId: params.requestId,
        userAgent: params.userAgent,
        userId: params.userId,
      },
    });

    return success({ url: installUrl.toString(), state });
  }

  /** Validates an installation setup callback and returns its native redirect. */
  async createCallbackRedirect(params: {
    state: string | undefined;
  }): Promise<AuthServiceResult<{ redirectUrl: string }>> {
    if (!params.state) {
      return failure({
        domain: "auth",
        status: 400,
        code: "MISSING_INSTALL_CALLBACK_PARAMS",
        message: "Missing GitHub installation state.",
      });
    }

    const pendingStateRecord = await peekOauthState(this.deps.env, params.state);
    if (!pendingStateRecord?.redirectOrigin || !pendingStateRecord.userId) {
      this.deps.logger.warn("GitHub installation callback rejected", {
        fields: { statePrefix: params.state.slice(0, 8) },
      });
      return this.invalidState();
    }

    const isLoginContinuation = pendingStateRecord.purpose
      === GITHUB_NATIVE_LOGIN_CONTINUATION_PURPOSE;
    const isStandaloneInstallation = pendingStateRecord.purpose === GITHUB_INSTALL_PURPOSE;
    if (!isLoginContinuation && !isStandaloneInstallation) {
      return this.invalidState();
    }

    const stateRecord = isStandaloneInstallation
      ? await consumeValidOauthState(this.deps.env, params.state)
      : pendingStateRecord;
    if (!stateRecord?.redirectOrigin || !stateRecord.userId) {
      return this.invalidState();
    }

    const redirectResult = isLoginContinuation
      ? validateNativeRedirectUri(stateRecord.redirectOrigin, this.deps.env)
      : validateNativeInstallRedirectUri(stateRecord.redirectOrigin, this.deps.env);
    if (!redirectResult.ok) {
      return failure({
        domain: "auth",
        status: 400,
        code: "INVALID_ORIGIN",
        message: redirectResult.error.message,
      });
    }

    await this.deps.clearRepoListingSync(stateRecord.userId);

    const target = new URL(redirectResult.value);
    target.searchParams.set("state", params.state);
    return success({ redirectUrl: target.toString() });
  }

  private invalidState(): AuthServiceResult<never> {
    return failure({
      domain: "auth",
      status: 400,
      code: "INVALID_INSTALL_STATE",
      message: "Invalid or expired GitHub installation session. Try again.",
    });
  }
}
