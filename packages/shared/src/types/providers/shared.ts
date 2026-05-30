import { z } from "zod";

export const AuthMethod = z.enum(["oauth"]);
export type AuthMethod = z.infer<typeof AuthMethod>;

export type ProviderModelId = string;

export type ProviderModelDefinition<ModelId extends ProviderModelId = ProviderModelId> = {
  id: ModelId;
  displayName: string;
  isDefault: boolean;
};

export type ProviderEffortId = string;

export type ProviderEffortDefinition<EffortId extends ProviderEffortId = ProviderEffortId> = {
  id: EffortId;
  displayName: string;
  isDefault: boolean;
};

export type ProviderDefinition<
  Id extends string = string,
  ModelId extends ProviderModelId = ProviderModelId,
  EffortId extends ProviderEffortId = ProviderEffortId,
> = {
  id: Id;
  displayName: string;
  defaultModel: ModelId;
  defaultEffort: EffortId;
  authMethods: AuthMethod[];
  models: ProviderModelDefinition<ModelId>[];
  efforts: ProviderEffortDefinition<EffortId>[];
  todoToolName: string;
};
