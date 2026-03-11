import { UserInfo } from "@repo/shared";
import { z } from "zod";

export const githubAuthPopupMessageType = {
  authSuccess: "auth:success",
  authError: "auth:error",
  installComplete: "github:install:complete",
} as const;

export const GitHubAuthSuccessMessage = z.object({
  type: z.literal(githubAuthPopupMessageType.authSuccess),
  user: UserInfo,
  hasInstallations: z.boolean(),
  installUrl: z.string(),
});
export type GitHubAuthSuccessMessage = z.infer<typeof GitHubAuthSuccessMessage>;

export const GitHubAuthErrorMessage = z.object({
  type: z.literal(githubAuthPopupMessageType.authError),
  error: z.string(),
});
export type GitHubAuthErrorMessage = z.infer<typeof GitHubAuthErrorMessage>;

export const GitHubInstallCompleteMessage = z.object({
  type: z.literal(githubAuthPopupMessageType.installComplete),
});
export type GitHubInstallCompleteMessage = z.infer<typeof GitHubInstallCompleteMessage>;

export const GitHubAuthPopupMessage = z.discriminatedUnion("type", [
  GitHubAuthSuccessMessage,
  GitHubAuthErrorMessage,
  GitHubInstallCompleteMessage,
]);
export type GitHubAuthPopupMessage = z.infer<typeof GitHubAuthPopupMessage>;
