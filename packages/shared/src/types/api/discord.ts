import { z } from "zod";

export const DiscordSessionRequest = z.object({
  discordUserId: z.string().min(1),
  discordUsername: z.string().min(1).optional(),
  prompt: z.string().trim().min(1).max(4000),
  guildId: z.string().min(1).optional(),
  channelId: z.string().min(1).optional(),
});
export type DiscordSessionRequest = z.infer<typeof DiscordSessionRequest>;

export const DiscordRepoCandidate = z.object({
  repoId: z.number(),
  repoFullName: z.string(),
  reason: z.string().optional(),
});
export type DiscordRepoCandidate = z.infer<typeof DiscordRepoCandidate>;

export const DiscordSessionSuccessResponse = z.object({
  ok: z.literal(true),
  sessionId: z.uuid(),
  title: z.string().nullable(),
  repoId: z.number(),
  repoFullName: z.string(),
  sessionUrl: z.string().url().optional(),
  routingReason: z.string().optional(),
});
export type DiscordSessionSuccessResponse = z.infer<
  typeof DiscordSessionSuccessResponse
>;

export const DiscordSessionErrorResponse = z.object({
  ok: z.literal(false),
  code: z.enum([
    "DISCORD_NOT_LINKED",
    "DISCORD_NOT_CONFIGURED",
    "GITHUB_AUTH_REQUIRED",
    "NO_REPO_MATCH",
    "AMBIGUOUS_REPO_MATCH",
    "SESSION_CREATE_FAILED",
    "UNAUTHORIZED",
  ]),
  message: z.string(),
  candidates: z.array(DiscordRepoCandidate).optional(),
  linkUrl: z.string().url().optional(),
  linkExpiresAt: z.iso.datetime().optional(),
});
export type DiscordSessionErrorResponse = z.infer<
  typeof DiscordSessionErrorResponse
>;

export const DiscordSessionResponse = z.discriminatedUnion("ok", [
  DiscordSessionSuccessResponse,
  DiscordSessionErrorResponse,
]);
export type DiscordSessionResponse = z.infer<typeof DiscordSessionResponse>;

export const DiscordLinkClaimRequest = z.object({
  token: z.string().min(20).max(256),
});
export type DiscordLinkClaimRequest = z.infer<typeof DiscordLinkClaimRequest>;

export const DiscordLinkClaimResponse = z.object({
  ok: z.literal(true),
  discordUserId: z.string(),
  discordUsername: z.string().nullable(),
  expiresAt: z.iso.datetime(),
});
export type DiscordLinkClaimResponse = z.infer<typeof DiscordLinkClaimResponse>;
