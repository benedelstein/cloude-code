import { failure, type GitHubAuthUrlResponse, success } from "@repo/shared";
import type { Logger } from "@repo/shared";
import type { Env } from "@/shared/types";
import {
  consumeValidExternalAuthState,
  createExternalAuthState,
} from "@/shared/services/external-auth-state.service";
import type { AuthServiceResult, RequestLogFields } from "../types/auth.types";
import { GITHUB_INSTALL_PURPOSE } from "../utils/github-auth-purpose";
import {
  nativeInstallRedirectUri,
  validateNativeInstallRedirectUri,
} from "../utils/native-redirect.util";

/**
 * Installation callback state covers the GitHub App repository-selection and
 * organization-approval-request journey for both chained sign-in and
 * authenticated repository management.
 */
const INSTALL_STATE_TTL_MS = 30 * 60 * 1000;

/**
 * GitHub App installation navigation and its setup callback.
 *
 * Installation is a repository-access grant, not an authentication step. A
 * consumed callback only authorizes the stored return redirect and a listing
 * refresh; webhook processing and a fresh repository listing remain the
 * authority for what the installation actually reaches.
 */
export class GitHubInstallationService {
  constructor(private readonly deps: {
    env: Env;
    getInstallUrl(): string;
    clearRepoListingSync(userId: string): Promise<void>;
    logger: Logger;
  }) {}

  /**
   * Authenticated repository management: a one-time installation URL paired
   * with an allowlisted native callback. Separate from sign-in.
   */
  async createUrl(params: {
    userId: string;
    nativeRedirectUri: string;
  } & RequestLogFields): Promise<AuthServiceResult<GitHubAuthUrlResponse>> {
    const redirectResult = nativeInstallRedirectUri(
      params.nativeRedirectUri,
      this.deps.env,
    );
    if (!redirectResult.ok) {
      this.deps.logger.warn("Rejecting GitHub installation start", {
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
    await createExternalAuthState(this.deps.env, {
      state,
      expiresAt: this.expiresAt(),
      redirectOrigin: redirectResult.value,
      purpose: GITHUB_INSTALL_PURPOSE,
      userId: params.userId,
    });

    const installUrl = new URL(this.deps.getInstallUrl());
    installUrl.searchParams.set("state", state);
    this.deps.logger.info("Starting GitHub installation flow", {
      fields: {
        requestId: params.requestId,
        userAgent: params.userAgent,
        userId: params.userId,
      },
    });

    return success({ url: installUrl.toString(), state });
  }

  /**
   * Chained sign-in installation: continues the same browser journey to
   * GitHub App setup and returns to the sign-in attempt's bound client.
   */
  async createSignInInstallationUrl(params: {
    userId: string;
    signInAttemptId: string;
    /** The attempt's already-validated final return target. */
    returnTarget: string;
  }): Promise<string> {
    const state = crypto.randomUUID();
    await createExternalAuthState(this.deps.env, {
      state,
      expiresAt: this.expiresAt(),
      redirectOrigin: params.returnTarget,
      purpose: GITHUB_INSTALL_PURPOSE,
      userId: params.userId,
      signInAttemptId: params.signInAttemptId,
    });

    const installUrl = new URL(this.deps.getInstallUrl());
    installUrl.searchParams.set("state", state);
    return installUrl.toString();
  }

  /**
   * Validates an installation setup callback and returns its stored redirect.
   *
   * `installation_id`, `setup_action`, and repository parameters on the
   * callback are ignored: they are browser-supplied and prove nothing.
   */
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

    const stateRecord = await consumeValidExternalAuthState(
      this.deps.env,
      params.state,
    );
    if (
      !stateRecord?.redirectOrigin
      || !stateRecord.userId
      || stateRecord.purpose !== GITHUB_INSTALL_PURPOSE
    ) {
      this.deps.logger.warn("GitHub installation callback rejected", {
        fields: { statePrefix: params.state.slice(0, 8) },
      });
      return this.invalidState();
    }

    const redirectResult = await this.resolveReturnUrl({
      returnTarget: stateRecord.redirectOrigin,
      signInAttemptId: stateRecord.signInAttemptId,
      state: params.state,
    });
    if (!redirectResult.ok) {
      return redirectResult;
    }

    // Repository availability is resolved by the next listing request, not by
    // this callback. Clearing sync metadata only makes that refresh prompt.
    await this.deps.clearRepoListingSync(stateRecord.userId);

    return success({ redirectUrl: redirectResult.value });
  }

  private async resolveReturnUrl(params: {
    returnTarget: string;
    signInAttemptId: string | null;
    state: string;
  }): Promise<AuthServiceResult<string>> {
    if (!params.signInAttemptId) {
      const redirectResult = validateNativeInstallRedirectUri(
        params.returnTarget,
        this.deps.env,
      );
      if (!redirectResult.ok) {
        return failure({
          domain: "auth",
          status: 400,
          code: "INVALID_ORIGIN",
          message: redirectResult.error.message,
        });
      }
      const target = new URL(redirectResult.value);
      target.searchParams.set("state", params.state);
      return success(target.toString());
    }

    // Chained targets were constructed from the attempt's validated client
    // targets before this state was stored. The installation state owns this
    // redirect for its full lifetime; the shorter sign-in attempt does not.
    return success(params.returnTarget);
  }

  private expiresAt(): string {
    return new Date(Date.now() + INSTALL_STATE_TTL_MS).toISOString();
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
