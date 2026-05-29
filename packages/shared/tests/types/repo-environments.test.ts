import { describe, expect, it } from "vitest";
import {
  CreateRepoEnvironmentRequest,
  SessionRuntimeConfigSnapshot,
} from "../../src/types/api/repo-environments";

describe("repo environment schemas", () => {
  it("accepts default plus extras with plain env vars and startup script", () => {
    expect(() => CreateRepoEnvironmentRequest.parse({
      name: "Web",
      network: {
        mode: "default_plus_extras",
        extraAllowlist: ["api.stripe.com", "*.vercel.com"],
      },
      plainEnvVars: {
        NEXT_PUBLIC_API_URL: "https://example.com",
      },
      startupScript: "pnpm install",
    })).not.toThrow();
  });

  it("rejects unknown fields such as path and secrets", () => {
    expect(() => CreateRepoEnvironmentRequest.parse({
      name: "Web",
      path: "apps/web",
      secretRefs: [],
    })).toThrow();
  });

  it("validates immutable runtime snapshots", () => {
    expect(() => SessionRuntimeConfigSnapshot.parse({
      sourceEnvironmentId: "123e4567-e89b-12d3-a456-426614174000",
      sourceEnvironmentName: "API",
      repoId: 42,
      network: { mode: "locked" },
      plainEnvVars: {},
      startupScript: null,
      resolvedAt: "2026-05-29T00:00:00.000Z",
      schemaVersion: 1,
    })).not.toThrow();
  });
});
