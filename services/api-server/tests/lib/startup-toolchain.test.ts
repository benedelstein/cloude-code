import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Logger } from "@repo/shared";
import { MIN_CODEX_CLI_VERSION } from "@repo/shared";
import type { WorkersSpriteClient } from "../../src/lib/sprites";
import { DEFAULT_NETWORK_POLICY } from "../../src/lib/sprites/network-policy";
import {
  OPENAI_CODEX_INSTALL_SCRIPT_URL,
  buildStartupToolchainContractHash,
  ensureSpriteStartupToolchain,
  getProviderStartupToolchain,
  isVersionAtLeast,
  parseSemanticVersion,
} from "../../src/lib/sprites/startup-toolchain";
import { OpenAICodexStartupToolchain } from "../../src/lib/sprites/startup-toolchain/providers/openai-codex";
import type { Env } from "../../src/types";

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

describe("startup toolchain versions", () => {
  it("parses semantic versions from CLI output", () => {
    expect(parseSemanticVersion("codex-cli 0.130.0")).toEqual({
      major: 0,
      minor: 130,
      patch: 0,
    });
    expect(parseSemanticVersion("not a version")).toBeNull();
  });

  it("compares versions against a minimum", () => {
    expect(isVersionAtLeast("0.130.0", "0.130.0")).toBe(true);
    expect(isVersionAtLeast("0.131.0", "0.130.0")).toBe(true);
    expect(isVersionAtLeast("0.129.9", "0.130.0")).toBe(false);
  });
});

describe("startup toolchain provider dispatch", () => {
  it("returns provider implementations through exhaustive dispatch", () => {
    expect(getProviderStartupToolchain("openai-codex", {
      env: {} as Env,
      logger: createLogger(),
    }).getContract().provider).toBe("openai-codex");
    expect(getProviderStartupToolchain("claude-code", {
      env: {} as Env,
      logger: createLogger(),
    }).getContract().provider).toBe("claude-code");
  });

  it("skips execution when the provider checkpoint contract is current", async () => {
    const toolchain = getProviderStartupToolchain("openai-codex", {
      env: {} as Env,
      logger: createLogger(),
    });
    const contractHash = await buildStartupToolchainContractHash(toolchain);
    const sprite = createSprite([]);

    const result = await ensureSpriteStartupToolchain({
      providerId: "openai-codex",
      sprite,
      checkpoint: {
        provider: "openai-codex",
        contractHash,
        checkedAt: 1,
        results: [],
      },
      env: {} as Env,
      logger: createLogger(),
    });

    expect(result.ok).toBe(true);
    expect(sprite.execHttp).not.toHaveBeenCalled();
  });

  it("changes the contract hash when the provider contract changes", async () => {
    const codexHash = await buildStartupToolchainContractHash(
      getProviderStartupToolchain("openai-codex", {
        env: {} as Env,
        logger: createLogger(),
      }),
    );
    const claudeHash = await buildStartupToolchainContractHash(
      getProviderStartupToolchain("claude-code", {
        env: {} as Env,
        logger: createLogger(),
      }),
    );

    expect(codexHash).not.toBe(claudeHash);
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

describe("OpenAICodexStartupToolchain", () => {
  it("records already-current when Codex satisfies the minimum version", async () => {
    const sprite = createSprite([{
      stdout: "path=/home/sprite/.local/bin/codex\nversion=codex-cli 0.130.0\n",
      exitCode: 0,
    }]);
    const toolchain = new OpenAICodexStartupToolchain(createLogger());

    const result = await toolchain.ensureReady({
      sprite,
      contractHash: "contract",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.results[0]).toMatchObject({
      id: "openai-codex.cli",
      status: "already-current",
      requiredVersion: MIN_CODEX_CLI_VERSION,
      version: "0.130.0",
    });
    expect(sprite.execHttp).toHaveBeenCalledOnce();
  });

  it("repairs a missing Codex CLI and verifies the installed version", async () => {
    const sprite = createSprite([
      { stdout: "", exitCode: 127 },
      { stdout: "installed\n", exitCode: 0 },
      {
        stdout: "path=/home/sprite/.local/bin/codex\nversion=codex-cli 0.130.0\n",
        exitCode: 0,
      },
    ]);
    const toolchain = new OpenAICodexStartupToolchain(createLogger());

    const result = await toolchain.ensureReady({
      sprite,
      contractHash: "contract",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.results[0]).toMatchObject({
      status: "updated",
      previousVersion: null,
      version: "0.130.0",
    });
    expect(sprite.execHttp).toHaveBeenCalledTimes(3);
  });

  it("repairs a stale Codex CLI and records the previous version", async () => {
    const sprite = createSprite([
      {
        stdout: "path=/usr/local/bin/codex\nversion=codex-cli 0.100.0\n",
        exitCode: 0,
      },
      { stdout: "installed\n", exitCode: 0 },
      {
        stdout: "path=/home/sprite/.local/bin/codex\nversion=codex-cli 0.130.0\n",
        exitCode: 0,
      },
    ]);
    const toolchain = new OpenAICodexStartupToolchain(createLogger());

    const result = await toolchain.ensureReady({
      sprite,
      contractHash: "contract",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.results[0]).toMatchObject({
      status: "updated",
      previousVersion: "0.100.0",
      version: "0.130.0",
    });
  });

  it("fails when repair still leaves Codex below the minimum", async () => {
    const sprite = createSprite([
      {
        stdout: "path=/usr/local/bin/codex\nversion=codex-cli 0.100.0\n",
        exitCode: 0,
      },
      { stdout: "installed\n", exitCode: 0 },
      {
        stdout: "path=/usr/local/bin/codex\nversion=codex-cli 0.100.0\n",
        exitCode: 0,
      },
    ]);
    const toolchain = new OpenAICodexStartupToolchain(createLogger());

    const result = await toolchain.ensureReady({
      sprite,
      contractHash: "contract",
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error).toMatchObject({
      code: "CHECK_FAILED",
      provider: "openai-codex",
      checkId: "openai-codex.cli",
      requiredVersion: MIN_CODEX_CLI_VERSION,
      installedVersion: "0.100.0",
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
