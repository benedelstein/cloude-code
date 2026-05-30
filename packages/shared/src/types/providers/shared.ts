import { z } from "zod";

export const AuthMethod = z.enum(["oauth"]);
export type AuthMethod = z.infer<typeof AuthMethod>;

export type ProviderModelId = string;

export type ProviderModelDefinition<ModelId extends ProviderModelId = ProviderModelId> = {
  id: ModelId;
  displayName: string;
  isDefault: boolean;
};

export type ProviderDefinition<
  Id extends string = string,
  ModelId extends ProviderModelId = ProviderModelId,
> = {
  id: Id;
  displayName: string;
  defaultModel: ModelId;
  authMethods: AuthMethod[];
  models: ProviderModelDefinition<ModelId>[];
  todoToolName: string;
};
