import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Logger } from "@repo/shared";
import type { WorkersSpriteClient } from "../../src/lib/providers/sprite-provider";
import { DEFAULT_NETWORK_POLICY } from "../../src/lib/sprites/network-policy";
import {
  OPENAI_CODEX_INSTALL_SCRIPT_URL,
  ensureSpriteStartupToolchain,
  getProviderStartupToolchainChecks,
} from "../../src/lib/providers/startup-toolchain";
import { getOpenAICodexStartupToolchainChecks } from "../../src/lib/providers/startup-toolchain/providers/openai-codex";

const MIN_CODEX_CLI_VERSION = "0.130.0";

function createLogger(): Logger {
  return {
    log() {},
    debug() {},
    info() {},
    warn() {},
    error() {},
    scope() {
      return this;
    },
  };
}

function createSprite(results: Array<{ stdout: string; stderr?: string; exitCode: number }>) {
  return {
    execHttp: vi.fn(async () => {
      const result = results.shift();
      if (!result) {
        throw new Error("Unexpected execHttp call");
      }
      return { stderr: "", ...result };
    }),
  } as unknown as WorkersSpriteClient;
}

describe("startup toolchain dispatch", () => {
  it("returns provider checks through exhaustive dispatch", () => {
    expect(getProviderStartupToolchainChecks("openai-codex", {
      logger: createLogger(),
    }).map((check) => check.id)).toEqual(["openai-codex.cli"]);
    expect(getProviderStartupToolchainChecks("claude-code", {
      logger: createLogger(),
    })).toEqual([]);
  });

  it("skips execution when the startup checkpoint contract is current", async () => {
    const logger = createLogger();
    const firstSprite = createSprite([{ stdout: "codex is ready: 0.130.0\n", exitCode: 0 }]);
    const firstResult = await ensureSpriteStartupToolchain({
      providerId: "openai-codex",
      sprite: firstSprite,
      checkpoint: null,
      logger,
    });
    expect(firstResult.ok).toBe(true);
    if (!firstResult.ok) {
      return;
    }

    const secondSprite = createSprite([]);
    const secondResult = await ensureSpriteStartupToolchain({
      providerId: "openai-codex",
      sprite: secondSprite,
      checkpoint: firstResult.value,
      logger,
    });

    expect(secondResult.ok).toBe(true);
    expect(secondSprite.execHttp).not.toHaveBeenCalled();
  });

  it("reruns checks when the Codex minimum version override changes", async () => {
    const logger = createLogger();
    const firstSprite = createSprite([{ stdout: "codex is ready: 0.130.0\n", exitCode: 0 }]);
    const firstResult = await ensureSpriteStartupToolchain({
      providerId: "openai-codex",
      sprite: firstSprite,
      checkpoint: null,
      logger,
    });
    expect(firstResult.ok).toBe(true);
    if (!firstResult.ok) {
      return;
    }

    const secondSprite = createSprite([{ stdout: "codex is ready: 0.140.0\n", exitCode: 0 }]);
    const secondResult = await ensureSpriteStartupToolchain({
      providerId: "openai-codex",
      sprite: secondSprite,
      checkpoint: firstResult.value,
      logger,
      codexMinVersion: "0.140.0",
    });

    expect(secondResult.ok).toBe(true);
    expect(secondSprite.execHttp).toHaveBeenCalledOnce();
  });

  it("keeps provisioning and spawn call sites provider-agnostic", () => {
    const callSitePaths = [
      "../../src/durable-objects/lib/SessionProvisionService.ts",
      "../../src/durable-objects/lib/SpriteAgentProcessManager.ts",
    ];

    for (const callSitePath of callSitePaths) {
      const source = readFileSync(
        fileURLToPath(new URL(callSitePath, import.meta.url)),
        "utf8",
      );
      expect(source).not.toMatch(/openai-codex|claude-code|codex --version|install\.sh/);
    }
  });
});

describe("OpenAI Codex startup check", () => {
  it("runs one Codex startup bash script", async () => {
    const sprite = createSprite([{
      stdout: "codex is current: 0.130.0\n",
      exitCode: 0,
    }]);
    const [check] = getOpenAICodexStartupToolchainChecks({
      logger: createLogger(),
    });

    const result = await check!.ensureReady({ sprite });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value).toMatchObject({
      id: "openai-codex.cli",
      status: "ready",
      requiredVersion: MIN_CODEX_CLI_VERSION,
    });
    expect(sprite.execHttp).toHaveBeenCalledOnce();
    expect(sprite.execHttp).toHaveBeenCalledWith(
      expect.stringContaining("bash -lc"),
    );
    expect(sprite.execHttp).toHaveBeenCalledWith(
      expect.stringContaining(`min_version="${MIN_CODEX_CLI_VERSION}"`),
    );
  });

  it("keeps checking, install, and verification in the same script", async () => {
    const sprite = createSprite([{
      stdout: "codex is ready: 0.130.0\n",
      exitCode: 0,
    }]);
    const [check] = getOpenAICodexStartupToolchainChecks({
      logger: createLogger(),
    });

    const result = await check!.ensureReady({ sprite });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(sprite.execHttp).toHaveBeenCalledOnce();
    const command = vi.mocked(sprite.execHttp).mock.calls[0]?.[0] as string;
    expect(command).toContain("read_codex_version()");
    expect(command).toContain("version_at_least()");
    expect(command).toContain(`curl -fsSL "$install_url" | sh`);
    expect(command).toContain("codex is ready");
  });

  it("uses CODEX_MIN_VERSION when provided", async () => {
    const sprite = createSprite([{
      stdout: "codex is ready: 0.140.0\n",
      exitCode: 0,
    }]);
    const [check] = getOpenAICodexStartupToolchainChecks({
      logger: createLogger(),
      codexMinVersion: "0.140.0",
    });

    const result = await check!.ensureReady({ sprite });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.requiredVersion).toBe("0.140.0");
    expect(check!.contract.minimumVersion).toBe("0.140.0");
    expect(sprite.execHttp).toHaveBeenCalledWith(
      expect.stringContaining('min_version="0.140.0"'),
    );
  });

  it("fails when the startup script fails", async () => {
    const sprite = createSprite([{
      stdout: "codex is stale: 0.100.0 < 0.130.0\n",
      stderr: "codex version 0.100.0 is below required 0.130.0 after install\n",
      exitCode: 1,
    }]);
    const [check] = getOpenAICodexStartupToolchainChecks({
      logger: createLogger(),
    });

    const result = await check!.ensureReady({ sprite });

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error).toMatchObject({
      code: "CHECK_FAILED",
      provider: "openai-codex",
      checkId: "openai-codex.cli",
      requiredVersion: MIN_CODEX_CLI_VERSION,
      exitCode: 1,
    });
  });
});

describe("startup toolchain network policy", () => {
  it("allows the Codex install script host", () => {
    const host = new URL(OPENAI_CODEX_INSTALL_SCRIPT_URL).hostname;
    expect(DEFAULT_NETWORK_POLICY).toContainEqual({
      domain: host,
      action: "allow",
    });
  });
});
