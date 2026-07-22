import type { Result } from "@repo/shared";

export type { AuthContext, AuthUser } from "@/shared/types/auth";

export type AuthServiceStatus = 400 | 401 | 403 | 409 | 500;

export type AuthServiceErrorCode =
  | "INVALID_ORIGIN"
  | "INVALID_RETURN_TO"
  | "MISSING_INSTALL_CALLBACK_PARAMS"
  | "INVALID_INSTALL_STATE"
  | "MISSING_OAUTH_CALLBACK_PARAMS"
  | "INVALID_OAUTH_STATE"
  | "GITHUB_TOKEN_EXCHANGE_FAILED"
  | "GITHUB_ACCOUNT_MISMATCH"
  | "USER_CREATE_FAILED"
  | "USER_NOT_FOUND"
  | "INVALID_REFRESH_TOKEN"
  /** Unknown, expired, unready, claimed, failed, wrong-client, or secret-mismatched. */
  | "INVALID_SIGN_IN_ATTEMPT";

export interface AuthServiceError {
  domain: "auth";
  status: AuthServiceStatus;
  message: string;
  code: AuthServiceErrorCode;
}

export type AuthServiceResult<T> = Result<T, AuthServiceError>;

/** Non-secret request metadata attached to structured auth logs. */
export interface RequestLogFields {
  requestId: string | null;
  userAgent: string | null;
}

export interface GitHubOAuthUser {
  id: number;
  login: string;
  name: string | null;
  avatarUrl: string;
}

export interface GitHubOAuthTokenResult {
  accessToken: string;
  refreshToken: string | undefined;
  refreshTokenExpiresAt: string | undefined;
  expiresAt: string | undefined;
  user: GitHubOAuthUser;
}

/** Contract for the GitHub functions the auth module needs. */
export interface AuthGitHubClient {
  getAuthUrl(state: string): string;
  getInstallUrl(): string;
  exchangeOAuthCode(code: string): Promise<GitHubOAuthTokenResult>;
  hasInstallations(accessToken: string): Promise<boolean>;
}
