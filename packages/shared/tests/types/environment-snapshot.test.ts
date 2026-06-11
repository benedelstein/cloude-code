import { describe, expect, it } from "vitest";
import { SessionEnvironmentSnapshot } from "../../src/types/environment-snapshot";

describe("session environment snapshot", () => {
  it("validates immutable environment snapshots", () => {
    expect(() => SessionEnvironmentSnapshot.parse({
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
