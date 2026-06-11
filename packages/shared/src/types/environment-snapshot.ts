import { z } from "zod";
import { NetworkAccessConfig, PlainEnvVars } from "@repo/api-contract";

/**
 * Environment configuration snapshot persisted in the session Durable Object
 * at creation time. Server-internal — not part of the client API contract.
 */
export const SessionEnvironmentSnapshot = z.object({
  sourceEnvironmentId: z.uuid().nullable(),
  sourceEnvironmentName: z.string().nullable(),
  repoId: z.number().int(),
  network: NetworkAccessConfig,
  plainEnvVars: PlainEnvVars,
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
    startupScript: null,
    resolvedAt: args.resolvedAt,
    schemaVersion: 1,
  };
}
