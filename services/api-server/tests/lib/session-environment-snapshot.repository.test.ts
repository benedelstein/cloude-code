import { describe, expect, it } from "vitest";
import type { SessionEnvironmentSnapshot } from "@repo/shared";
import { SessionEnvironmentSnapshotRepository } from "../../src/modules/session-agent/repositories/session-environment-snapshot.repository";
import type { SqlFn } from "../../src/modules/session-agent/repositories/repository.types";

function createEnvironmentSnapshot(): SessionEnvironmentSnapshot {
  return {
    sourceEnvironmentId: null,
    sourceEnvironmentName: null,
    repoId: 42,
    network: { mode: "default" },
    plainEnvVars: {},
    startupScript: null,
    resolvedAt: "2026-05-29T00:00:00.000Z",
    schemaVersion: 1,
  };
}

function createSql(snapshot: string | null = null): SqlFn {
  let storedSnapshot = snapshot;
  return ((strings: TemplateStringsArray, ...values: (string | number | boolean | null)[]) => {
    const query = strings.join("?");
    if (query.includes("SELECT snapshot FROM session_environment_snapshot")) {
      return storedSnapshot ? [{ snapshot: storedSnapshot }] : [];
    }
    if (query.includes("INSERT OR REPLACE INTO session_environment_snapshot")) {
      storedSnapshot = String(values[0]);
      return [];
    }
    return [];
  }) as SqlFn;
}

describe("SessionEnvironmentSnapshotRepository", () => {
  it("stores and returns the session environment snapshot", () => {
    const repository = new SessionEnvironmentSnapshotRepository(createSql());
    const snapshot = createEnvironmentSnapshot();

    repository.set(snapshot);

    expect(repository.get()).toEqual(snapshot);
  });

  it("throws when the session environment snapshot is missing", () => {
    const repository = new SessionEnvironmentSnapshotRepository(createSql());

    expect(() => repository.get()).toThrow("Session environment snapshot is missing");
  });
});
