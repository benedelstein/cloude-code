import type { Result } from "@repo/shared";

export type GitHubCredentialError =
  | {
      code: "GITHUB_AUTH_REQUIRED";
      status: 401;
      message: string;
    }
  | {
      code: "GITHUB_UNAVAILABLE";
      status: 503;
      message: string;
    };

export type GitHubCredentialResult = Result<
  { accessToken: string },
  GitHubCredentialError
>;
