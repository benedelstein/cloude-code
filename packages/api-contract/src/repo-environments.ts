import { z } from "zod";

export const RepoEnvironmentNetworkMode = z.enum([
  "locked",
  "default",
  "custom",
  "open",
]);
export type RepoEnvironmentNetworkMode = z.infer<typeof RepoEnvironmentNetworkMode>;

const DomainAllowlistEntry = z.string()
  .trim()
  .min(1)
  .max(253)
  .regex(/^\*?\.?[a-zA-Z0-9.-]+$/, "Use a hostname such as api.example.com or *.example.com");

export const NetworkAccessConfig = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("open"),
  }),
  z.object({
    mode: z.literal("locked"),
  }),
  z.object({
    mode: z.literal("default"),
  }),
  z.object({
    mode: z.literal("custom"),
    extraAllowlist: z.array(DomainAllowlistEntry).max(100).default([]),
    includeDefaultAllowlist: z.boolean().default(false),
  }),
]);
export type NetworkAccessConfig = z.infer<typeof NetworkAccessConfig>;

export const PlainEnvVars = z.record(
  z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/, "Use shell-compatible variable names"),
  z.string().max(5000),
).default({});
export type PlainEnvVars = z.infer<typeof PlainEnvVars>;

export const RepoEnvironment = z.object({
  id: z.uuid(),
  repoId: z.number().int(),
  name: z.string(),
  network: NetworkAccessConfig,
  plainEnvVars: PlainEnvVars,
  startupScript: z.string().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type RepoEnvironment = z.infer<typeof RepoEnvironment>;

export const RepoEnvironmentSummary = RepoEnvironment.extend({
  repoFullName: z.string(),
});
export type RepoEnvironmentSummary = z.infer<typeof RepoEnvironmentSummary>;

export const ListRepoEnvironmentsResponse = z.object({
  environments: z.array(RepoEnvironment),
});
export type ListRepoEnvironmentsResponse = z.infer<typeof ListRepoEnvironmentsResponse>;

export const ListUserRepoEnvironmentsResponse = z.object({
  environments: z.array(RepoEnvironmentSummary),
});
export type ListUserRepoEnvironmentsResponse = z.infer<
  typeof ListUserRepoEnvironmentsResponse
>;

export const DefaultNetworkAllowlistResponse = z.object({
  domains: z.array(z.string()),
});
export type DefaultNetworkAllowlistResponse = z.infer<
  typeof DefaultNetworkAllowlistResponse
>;

export const UserRepoEnvironmentResponse = z.object({
  environment: RepoEnvironmentSummary,
});
export type UserRepoEnvironmentResponse = z.infer<typeof UserRepoEnvironmentResponse>;

export const CreateRepoEnvironmentRequest = z.object({
  name: z.string().trim().min(1).max(80),
  network: NetworkAccessConfig.default({
    mode: "default",
  }),
  plainEnvVars: PlainEnvVars,
  startupScript: z.string().max(20000).nullable().optional(),
}).strict();
export type CreateRepoEnvironmentRequest = z.infer<typeof CreateRepoEnvironmentRequest>;

export const UpdateRepoEnvironmentRequest = CreateRepoEnvironmentRequest.partial()
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one field must be provided",
  });
export type UpdateRepoEnvironmentRequest = z.infer<typeof UpdateRepoEnvironmentRequest>;

export const RepoEnvironmentResponse = z.object({
  environment: RepoEnvironment,
});
export type RepoEnvironmentResponse = z.infer<typeof RepoEnvironmentResponse>;

export const DeleteRepoEnvironmentResponse = z.object({
  deleted: z.literal(true),
});
export type DeleteRepoEnvironmentResponse = z.infer<typeof DeleteRepoEnvironmentResponse>;
