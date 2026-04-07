import { z } from "zod";
import { AuthMethod, ProviderId } from "../providers/index";

export const ProviderCatalogModel = z.object({
  id: z.string(),
  displayName: z.string(),
  isDefault: z.boolean(),
  selectable: z.boolean(),
});
export type ProviderCatalogModel = z.infer<typeof ProviderCatalogModel>;

export const ProviderCatalogEntry = z.object({
  providerId: ProviderId,
  providerName: z.string(),
  connected: z.boolean(),
  requiresReauth: z.boolean(),
  defaultModel: z.string(),
  authMethods: z.array(AuthMethod),
  models: z.array(ProviderCatalogModel),
  metadata: z.record(z.string(), z.unknown()).optional(),
});
export type ProviderCatalogEntry = z.infer<typeof ProviderCatalogEntry>;

export const ModelsResponse = z.object({
  providers: z.array(ProviderCatalogEntry),
});
export type ModelsResponse = z.infer<typeof ModelsResponse>;
