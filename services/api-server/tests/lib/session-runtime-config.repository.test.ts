import { describe, expect, it } from "vitest";
import type { SessionRuntimeConfigSnapshot } from "@repo/shared";
import { SessionRuntimeConfigRepository } from "../../src/modules/session-agent/repositories/session-runtime-config.repository";
import type { SqlFn } from "../../src/modules/session-agent/repositories/repository.types";

function createRuntimeConfig(): SessionRuntimeConfigSnapshot {
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

function createSql(config: string | null = null): SqlFn {
  let storedConfig = config;
  return ((strings: TemplateStringsArray, ...values: (string | number | boolean | null)[]) => {
    const query = strings.join("?");
    if (query.includes("SELECT config FROM session_runtime_config")) {
      return storedConfig ? [{ config: storedConfig }] : [];
    }
    if (query.includes("INSERT OR REPLACE INTO session_runtime_config")) {
      storedConfig = String(values[0]);
      return [];
    }
    return [];
  }) as SqlFn;
}

describe("SessionRuntimeConfigRepository", () => {
  it("stores and returns the session runtime config", () => {
    const repository = new SessionRuntimeConfigRepository(createSql());
    const config = createRuntimeConfig();

    repository.set(config);

    expect(repository.get()).toEqual(config);
  });

  it("throws when the session runtime config is missing", () => {
    const repository = new SessionRuntimeConfigRepository(createSql());

    expect(() => repository.get()).toThrow("Session runtime config is missing");
  });
});
