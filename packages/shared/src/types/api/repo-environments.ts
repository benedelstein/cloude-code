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

const ConnectorHostname = z.string()
  .trim()
  .min(1)
  .max(253)
  .regex(/^[a-zA-Z0-9.-]+$/, "Use a hostname such as api.openai.com");

const HttpHeaderName = z.string()
  .trim()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9-]+$/, "Use a valid HTTP header name such as Authorization");

/**
 * A connector transparently injects a stored secret into outbound requests to
 * one or more upstream hosts. The on-sprite proxy intercepts `matchHosts`,
 * rewrites the request to the worker connector endpoint, and the worker injects
 * the real key — which never reaches the sprite. This is the public shape
 * returned to the API/UI; it never contains the secret.
 */
export const Connector = z.object({
  id: z.uuid(),
  name: z.string().trim().min(1).max(80),
  /** Real upstream base URL the worker forwards to, e.g. https://api.openai.com */
  upstreamBaseUrl: z.url(),
  /** Hostnames the on-sprite proxy intercepts and routes through this connector. */
  matchHosts: z.array(ConnectorHostname).min(1).max(20),
  /** Header the worker injects the secret into. */
  headerName: HttpHeaderName.default("Authorization"),
  /** Prefix prepended to the secret to form the header value, e.g. "Bearer ". */
  headerValuePrefix: z.string().max(32).default("Bearer "),
});
export type Connector = z.infer<typeof Connector>;

/**
 * Internal connector shape persisted at rest and carried in the session
 * snapshot. `encryptedKey` is AES-GCM encrypted with `TOKEN_ENCRYPTION_KEY` and
 * is only ever decrypted inside the worker at request time — it is never sent
 * to the sprite.
 */
export const ConnectorWithSecret = Connector.extend({
  encryptedKey: z.string(),
});
export type ConnectorWithSecret = z.infer<typeof ConnectorWithSecret>;

/** Connector create/update input. Carries the plaintext key, which the service encrypts before storage. */
export const ConnectorInput = z.object({
  name: z.string().trim().min(1).max(80),
  upstreamBaseUrl: z.url(),
  matchHosts: z.array(ConnectorHostname).min(1).max(20),
  headerName: HttpHeaderName.default("Authorization"),
  headerValuePrefix: z.string().max(32).default("Bearer "),
  key: z.string().min(1).max(8192),
});
export type ConnectorInput = z.infer<typeof ConnectorInput>;

export const RepoEnvironment = z.object({
  id: z.uuid(),
  repoId: z.number(),
  name: z.string(),
  network: NetworkAccessConfig,
  plainEnvVars: PlainEnvVars,
  connectors: z.array(Connector).default([]),
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
  connectors: z.array(ConnectorInput).max(20).optional(),
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

export const SessionEnvironmentSnapshot = z.object({
  sourceEnvironmentId: z.uuid().nullable(),
  sourceEnvironmentName: z.string().nullable(),
  repoId: z.number(),
  network: NetworkAccessConfig,
  plainEnvVars: PlainEnvVars,
  /** Server-only: carries encrypted connector keys, never sent to the sprite. */
  connectors: z.array(ConnectorWithSecret).default([]),
  startupScript: z.string().nullable(),
  resolvedAt: z.iso.datetime(),
  schemaVersion: z.literal(1),
});
export type SessionEnvironmentSnapshot = z.infer<typeof SessionEnvironmentSnapshot>;

export function createDefaultSessionEnvironmentSnapshot(args: {
  repoId: number;
  resolvedAt: string;
}): SessionEnvironmentSnapshot {
  return {
    sourceEnvironmentId: null,
    sourceEnvironmentName: null,
    repoId: args.repoId,
    network: {
      mode: "default",
    },
    plainEnvVars: {},
    connectors: [],
    startupScript: null,
    resolvedAt: args.resolvedAt,
    schemaVersion: 1,
  };
}
