import { z } from "zod";

export const IntegrationProvider = z.enum(["discord", "slack", "generic"]);
export type IntegrationProvider = z.infer<typeof IntegrationProvider>;

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

export const IntegrationLinkInfo = z.object({
  provider: IntegrationProvider,
  externalUserId: z.string(),
  externalUsername: z.string().nullable(),
  expiresAt: z.string(),
  lastUsedAt: z.string().nullable(),
});
export type IntegrationLinkInfo = z.infer<typeof IntegrationLinkInfo>;

export const IntegrationLinksResponse = z.object({
  links: z.array(IntegrationLinkInfo),
});
export type IntegrationLinksResponse = z.infer<typeof IntegrationLinksResponse>;

export const IntegrationLinkRevokeResponse = z.object({
  ok: z.literal(true),
});
export type IntegrationLinkRevokeResponse = z.infer<typeof IntegrationLinkRevokeResponse>;
