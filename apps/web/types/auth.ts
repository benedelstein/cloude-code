import { z } from "zod";

/**
 * GitHub reauthorization still runs in a popup: it reconnects credentials for
 * an already-authenticated user and must leave the current page in place.
 * GitHub sign-in itself is a same-tab redirect and has no popup messages.
 */
export const githubAuthPopupMessageType = {
  githubReauthSuccess: "github:reauth:success",
  githubReauthError: "github:reauth:error",
} as const;

export const GitHubReauthSuccessMessage = z.object({
  type: z.literal(githubAuthPopupMessageType.githubReauthSuccess),
  installUrl: z.string(),
});
export type GitHubReauthSuccessMessage = z.infer<typeof GitHubReauthSuccessMessage>;

export const GitHubReauthErrorMessage = z.object({
  type: z.literal(githubAuthPopupMessageType.githubReauthError),
  error: z.string(),
});
export type GitHubReauthErrorMessage = z.infer<typeof GitHubReauthErrorMessage>;

export const GitHubAuthPopupMessage = z.discriminatedUnion("type", [
  GitHubReauthSuccessMessage,
  GitHubReauthErrorMessage,
]);
export type GitHubAuthPopupMessage = z.infer<typeof GitHubAuthPopupMessage>;
