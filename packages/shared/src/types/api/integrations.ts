import { z } from "zod";

export const IntegrationProvider = z.enum(["discord", "slack", "generic"]);
export type IntegrationProvider = z.infer<typeof IntegrationProvider>;

const BaseExternalUser = z.object({
  id: z.string().min(1),
  displayName: z.string().min(1).optional(),
});

export const DiscordExternalUser = BaseExternalUser.extend({
  provider: z.literal("discord"),
  username: z.string().min(1).optional(),
});
export type DiscordExternalUser = z.infer<typeof DiscordExternalUser>;

export const SlackExternalUser = BaseExternalUser.extend({
  provider: z.literal("slack"),
  teamId: z.string().min(1).optional(),
});
export type SlackExternalUser = z.infer<typeof SlackExternalUser>;

export const GenericExternalUser = BaseExternalUser.extend({
  provider: z.literal("generic"),
  namespace: z.string().min(1).optional(),
});
export type GenericExternalUser = z.infer<typeof GenericExternalUser>;

export const IntegrationExternalUser = z.discriminatedUnion("provider", [
  DiscordExternalUser,
  SlackExternalUser,
  GenericExternalUser,
]);
export type IntegrationExternalUser = z.infer<typeof IntegrationExternalUser>;

export const IntegrationSessionContext = z.object({
  guildId: z.string().min(1).optional(),
  channelId: z.string().min(1).optional(),
  teamId: z.string().min(1).optional(),
  threadId: z.string().min(1).optional(),
}).optional();
export type IntegrationSessionContext = z.infer<typeof IntegrationSessionContext>;

export const IntegrationSessionRequest = z.object({
  externalUser: IntegrationExternalUser,
  prompt: z.string().trim().min(1).max(4000),
  context: IntegrationSessionContext,
});
export type IntegrationSessionRequest = z.infer<typeof IntegrationSessionRequest>;

export const IntegrationRepoCandidate = z.object({
  repoId: z.number(),
  repoFullName: z.string(),
  reason: z.string().optional(),
});
export type IntegrationRepoCandidate = z.infer<typeof IntegrationRepoCandidate>;

export const IntegrationSessionSuccessResponse = z.object({
  ok: z.literal(true),
  sessionId: z.uuid(),
  title: z.string().nullable(),
  repoId: z.number(),
  repoFullName: z.string(),
  sessionUrl: z.string().url().optional(),
  routingReason: z.string().optional(),
});
export type IntegrationSessionSuccessResponse = z.infer<
  typeof IntegrationSessionSuccessResponse
>;

export const IntegrationSessionErrorResponse = z.object({
  ok: z.literal(false),
  code: z.enum([
    "EXTERNAL_USER_NOT_LINKED",
    "INTEGRATION_NOT_CONFIGURED",
    "GITHUB_AUTH_REQUIRED",
    "NO_REPO_MATCH",
    "AMBIGUOUS_REPO_MATCH",
    "SESSION_CREATE_FAILED",
    "UNAUTHORIZED",
  ]),
  message: z.string(),
  candidates: z.array(IntegrationRepoCandidate).optional(),
  linkUrl: z.string().url().optional(),
  linkExpiresAt: z.iso.datetime().optional(),
});
export type IntegrationSessionErrorResponse = z.infer<
  typeof IntegrationSessionErrorResponse
>;

export const IntegrationSessionResponse = z.discriminatedUnion("ok", [
  IntegrationSessionSuccessResponse,
  IntegrationSessionErrorResponse,
]);
export type IntegrationSessionResponse = z.infer<typeof IntegrationSessionResponse>;

export const IntegrationLinkClaimRequest = z.object({
  token: z.string().min(20).max(256),
});
export type IntegrationLinkClaimRequest = z.infer<typeof IntegrationLinkClaimRequest>;

export const IntegrationLinkClaimResponse = z.object({
  ok: z.literal(true),
  provider: IntegrationProvider,
  externalUserId: z.string(),
  externalUsername: z.string().nullable(),
  expiresAt: z.iso.datetime(),
});
export type IntegrationLinkClaimResponse = z.infer<typeof IntegrationLinkClaimResponse>;
