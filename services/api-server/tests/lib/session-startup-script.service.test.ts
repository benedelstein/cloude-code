import { afterEach, describe, expect, it, vi } from "vitest";
import type { Logger } from "@repo/shared";
import type { WorkersSpriteClient } from "../../src/shared/integrations/sprites/WorkersSpriteClient";
import { SessionStartupScriptService } from "../../src/modules/session-agent/services/session-startup-script.service";

function createLogger() {
  const info = vi.fn();
  const warn = vi.fn();
  const logger: Logger = {
    log() {},
    debug() {},
    info,
    warn,
    error() {},
    scope() {
      return logger;
    },
  };

  return { info, logger, warn };
}

describe("SessionStartupScriptService", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("logs when no startup script is configured", async () => {
    const { info, logger } = createLogger();
    const sprite = {
      execHttp: vi.fn(),
    } as unknown as WorkersSpriteClient;

    const service = new SessionStartupScriptService(logger);

    await service.run({
      sprite,
      script: "   ",
      workspaceDir: "/workspace",
      env: { FOO: "bar" },
    });

    expect(sprite.execHttp).not.toHaveBeenCalled();
    expect(info).toHaveBeenCalledWith("No session startup script configured", {
      fields: {
        workspaceDir: "/workspace",
        envVarCount: 1,
      },
    });
  });

  it("logs duration when the startup script fails", async () => {
    const { logger, warn } = createLogger();
    const sprite = {
      execHttp: vi.fn(async () => ({
        stdout: "install output",
        stderr: "",
        exitCode: -1,
      })),
    } as unknown as WorkersSpriteClient;
    vi.spyOn(Date, "now")
      .mockReturnValueOnce(1_000)
      .mockReturnValueOnce(7_500);

    const service = new SessionStartupScriptService(logger);

    await expect(service.run({
      sprite,
      script: "pnpm install",
      workspaceDir: "/workspace",
      env: {},
    })).rejects.toThrow("Startup script failed (exit -1): install output");

    expect(warn).toHaveBeenCalledWith("Session startup script failed", {
      fields: {
        exitCode: -1,
        durationMs: 6_500,
        stdout: "install output",
        stderr: "",
      },
    });
  });
});
