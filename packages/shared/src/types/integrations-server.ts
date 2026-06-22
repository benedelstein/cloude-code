import { z } from "zod";

/**
 * Bot → server session creation (Discord/Slack/Teams), authenticated with bot
 * tokens. Server-side only — not part of the client API contract, hence not
 * in @repo/api-contract and never transpiled to Swift.
 */
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

export const TeamsExternalUser = BaseExternalUser.extend({
  provider: z.literal("teams"),
  tenantId: z.string().min(1).optional(),
  teamId: z.string().min(1).optional(),
});
export type TeamsExternalUser = z.infer<typeof TeamsExternalUser>;

export const GenericExternalUser = BaseExternalUser.extend({
  provider: z.literal("generic"),
  namespace: z.string().min(1).optional(),
});
export type GenericExternalUser = z.infer<typeof GenericExternalUser>;

export const IntegrationExternalUser = z.discriminatedUnion("provider", [
  DiscordExternalUser,
  SlackExternalUser,
  TeamsExternalUser,
  GenericExternalUser,
]);
export type IntegrationExternalUser = z.infer<typeof IntegrationExternalUser>;

export const IntegrationSessionRequest = z.object({
  externalUser: IntegrationExternalUser,
  prompt: z.string().trim().min(1).max(4000),
});
export type IntegrationSessionRequest = z.infer<typeof IntegrationSessionRequest>;

export const IntegrationRepoCandidate = z.object({
  repoId: z.number().int(),
  repoFullName: z.string(),
  reason: z.string().optional(),
});
export type IntegrationRepoCandidate = z.infer<typeof IntegrationRepoCandidate>;

export const IntegrationSessionSuccessResponse = z.object({
  ok: z.literal(true),
  sessionId: z.uuid(),
  title: z.string().nullable(),
  repoId: z.number().int(),
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
    "GITHUB_AUTH_REQUIRED",
    "REPO_LISTING_FAILED",
    "NO_REPO_MATCH",
    "AMBIGUOUS_REPO_MATCH",
    "SESSION_CREATE_FAILED",
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
