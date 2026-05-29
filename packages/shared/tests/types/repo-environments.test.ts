import { describe, expect, it } from "vitest";
import {
  CreateRepoEnvironmentRequest,
  ListUserRepoEnvironmentsResponse,
  SessionRuntimeConfigSnapshot,
  UserRepoEnvironmentResponse,
} from "../../src/types/api/repo-environments";

describe("repo environment schemas", () => {
  it("accepts custom access with plain env vars and startup script", () => {
    expect(() => CreateRepoEnvironmentRequest.parse({
      name: "Web",
      network: {
        mode: "custom",
        extraAllowlist: ["api.stripe.com", "*.vercel.com"],
        includeDefaultAllowlist: true,
      },
      plainEnvVars: {
        NEXT_PUBLIC_API_URL: "https://example.com",
        npm_config_registry: "https://registry.npmjs.org",
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

  it("validates user environment summaries with repo names", () => {
    expect(() => ListUserRepoEnvironmentsResponse.parse({
      environments: [
        {
          id: "123e4567-e89b-12d3-a456-426614174000",
          repoId: 42,
          repoFullName: "ben/web",
          name: "Web",
          network: { mode: "locked" },
          plainEnvVars: {},
          startupScript: null,
          createdAt: "2026-05-29T00:00:00.000Z",
          updatedAt: "2026-05-29T00:00:00.000Z",
        },
      ],
    })).not.toThrow();
  });

  it("validates one user environment response", () => {
    expect(() => UserRepoEnvironmentResponse.parse({
      environment: {
        id: "123e4567-e89b-12d3-a456-426614174000",
        repoId: 42,
        repoFullName: "ben/web",
        name: "Web",
        network: { mode: "locked" },
        plainEnvVars: {},
        startupScript: null,
        createdAt: "2026-05-29T00:00:00.000Z",
        updatedAt: "2026-05-29T00:00:00.000Z",
      },
    })).not.toThrow();
  });
});
