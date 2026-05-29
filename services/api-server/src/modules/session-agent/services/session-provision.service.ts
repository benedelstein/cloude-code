import {
  dedent,
  type ClientState,
  type Logger,
  type SessionRuntimeConfigSnapshot,
  type SessionStatus,
} from "@repo/shared";
import type { Env } from "@/shared/types";
import type { SpritesCoordinator } from "@/shared/integrations/sprites/sprites";
import { WorkersSpriteClient } from "@/shared/integrations/sprites/WorkersSpriteClient";
import {
  buildBootstrapNetworkPolicy,
  buildFinalNetworkPolicy,
} from "@/shared/integrations/sprites/network-policy";
import { ensureSpriteStartupToolchain } from "@/shared/integrations/sprites/startup-toolchain";
import type { GitHubAppResult } from "@/shared/types/github";
import type { ServerState } from "../repositories/server-state.repository";
import { SessionStartupScriptService } from "./session-startup-script.service";

const WORKSPACE_DIR = "/home/sprite/workspace";

/**
 * Dependencies injected from the SessionAgentDO into the provisioner.
 * Keeps coupling explicit and avoids a circular type reference to the DO class.
 */
export interface SessionProvisionServiceDeps {
  logger: Logger;
  env: Env;
  spritesCoordinator: SpritesCoordinator;

  getServerState: () => ServerState;
  getClientState: () => ClientState;
  getRuntimeConfig: () => SessionRuntimeConfigSnapshot;
  updateServerState: (partial: Partial<ServerState>) => void;
  updatePartialState: (partial: Partial<ClientState>) => void;
  synthesizeStatus: () => SessionStatus;
  ensureGitProxySecret: () => string;
  githubTokenProvider: {
    getReadOnlyTokenForRepo(repoFullName: string): Promise<GitHubAppResult<string>>;
  };
}

/**
 * Owns session VM provisioning for a SessionAgentDO: creating the sprite,
 * applying the network policy, cloning the repository, and configuring
 * git remotes. Each step is idempotent — skipped if the corresponding
 * checkpoint is already recorded in ServerState.
 *
 * The SessionAgentDO owns this instance. All interaction is through the
 * injected deps so the provisioner has no reference to the DO class.
 */
export class SessionProvisionService {
  private readonly logger: Logger;
  private readonly env: Env;
  private readonly spritesCoordinator: SpritesCoordinator;
  private readonly getServerState: () => ServerState;
  private readonly getClientState: () => ClientState;
  private readonly getRuntimeConfig: () => SessionRuntimeConfigSnapshot;
  private readonly updateServerState: SessionProvisionServiceDeps["updateServerState"];
  private readonly updatePartialState: SessionProvisionServiceDeps["updatePartialState"];
  private readonly synthesizeStatus: () => SessionStatus;
  private readonly ensureGitProxySecret: () => string;
  private readonly githubTokenProvider: SessionProvisionServiceDeps["githubTokenProvider"];
  private readonly startupScriptService: SessionStartupScriptService;

  /** Mutex for durable provisioning steps (sprite creation, repo clone). */
  private ensureProvisionedPromise: Promise<void> | null = null;

  constructor(deps: SessionProvisionServiceDeps) {
    this.logger = deps.logger.scope("session-provision-service");
    this.env = deps.env;
    this.spritesCoordinator = deps.spritesCoordinator;
    this.getServerState = deps.getServerState;
    this.getClientState = deps.getClientState;
    this.getRuntimeConfig = deps.getRuntimeConfig;
    this.updateServerState = deps.updateServerState;
    this.updatePartialState = deps.updatePartialState;
    this.synthesizeStatus = deps.synthesizeStatus;
    this.ensureGitProxySecret = deps.ensureGitProxySecret;
    this.githubTokenProvider = deps.githubTokenProvider;
    this.startupScriptService = new SessionStartupScriptService(this.logger);
  }

  /**
   * Ensures the sprite is created and the repo is cloned. Safe to call
   * concurrently — all callers share one in-flight promise.
   */
  ensureProvisioned(): Promise<void> {
    if (this.ensureProvisionedPromise) { return this.ensureProvisionedPromise; }
    this.ensureProvisionedPromise = this.provision().finally(() => {
      this.ensureProvisionedPromise = null;
    });
    return this.ensureProvisionedPromise;
  }

  private async provision(): Promise<void> {
    try {
      const serverState = this.getServerState();
      let spriteName = serverState.spriteName;
      if (!spriteName) {
        this.updatePartialState({ status: this.synthesizeStatus() });
        this.logger.debug("Provisioning sprite for session", {
          fields: { sessionId: serverState.sessionId },
        });

        const spriteResponse = await this.spritesCoordinator.createSprite({
          name: serverState.sessionId!,
        });

        // For provisioning, allow network access to known-good domains
        const sprite = new WorkersSpriteClient(
          spriteResponse.name,
          this.env.SPRITES_API_KEY,
          this.env.SPRITES_API_URL,
        );
        const workerHostname = new URL(this.env.WORKER_URL).hostname;
        const networkPolicy = buildBootstrapNetworkPolicy({ workerHostname });
        await sprite.setNetworkPolicy(networkPolicy);

        spriteName = spriteResponse.name;
        this.updateServerState({ spriteName });
        this.updatePartialState({ status: this.synthesizeStatus() });
      }

      if (!spriteName) {
        throw new Error("Sprite name is missing");
      }

      // Update environment toolchain packages
      await this.ensureStartupToolchain(spriteName);

      // Clone Repo
      if (!this.getServerState().repoCloned) {
        this.updatePartialState({ status: this.synthesizeStatus() });
        await this.cloneRepo(spriteName!);
        this.updateServerState({ repoCloned: true });
        this.updatePartialState({
          status: this.synthesizeStatus(),
          lastError: null,
        });
      }

      if (!this.getServerState().startupScriptCompleted) {
        await this.tryRunStartupScript(spriteName);
        this.updateServerState({ startupScriptCompleted: true });
      }

      if (!this.getServerState().finalNetworkPolicyApplied) {
        await this.applyFinalNetworkPolicy(spriteName);
        this.updateServerState({ finalNetworkPolicyApplied: true });
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error("Failed to provision session", { error });
      this.updatePartialState({
        lastError: errorMessage,
        status: this.synthesizeStatus(),
      });
      throw error;
    }
  }

  private async ensureStartupToolchain(spriteName: string): Promise<void> {
    const providerId = this.getClientState().agentSettings.provider;
    const serverState = this.getServerState();
    const sprite = new WorkersSpriteClient(
      spriteName,
      this.env.SPRITES_API_KEY,
      this.env.SPRITES_API_URL,
    );

    this.logger.info("Ensuring startup toolchain", {
      fields: {
        sessionId: serverState.sessionId,
        spriteName,
        provider: providerId,
        checkpointPresent: serverState.startupToolchain !== null,
      },
    });

    const result = await ensureSpriteStartupToolchain({
      providerId,
      sprite,
      checkpoint: serverState.startupToolchain,
      logger: this.logger,
      codexMinVersion: this.env.CODEX_MIN_VERSION,
    });
    if (!result.ok) {
      this.logger.warn("Startup toolchain failed", {
        fields: {
          sessionId: serverState.sessionId,
          spriteName,
          provider: providerId,
          checkId: result.error.checkId,
          code: result.error.code,
        },
      });
      throw new Error(result.error.message);
    }

    this.updateServerState({
      startupToolchain: result.value,
    });
    this.logger.info("Startup toolchain ready", {
      fields: {
        sessionId: serverState.sessionId,
        spriteName,
        provider: providerId,
        contractHash: result.value.contractHash,
        checkCount: result.value.results.length,
      },
    });
  }

  /**
   * Clones the repository onto the sprite and configures git remotes.
   * Assumes the sprite is already created and the network policy is set.
   */
  private async cloneRepo(spriteName: string): Promise<void> {
    const clientState = this.getClientState();
    const serverState = this.getServerState();
    const repoFullName = clientState.repoFullName!;
    const sessionId = serverState.sessionId!;

    const sprite = new WorkersSpriteClient(
      spriteName,
      this.env.SPRITES_API_KEY,
      this.env.SPRITES_API_URL,
    );

    const proxyBaseUrl = `${this.env.WORKER_URL}/git-proxy/${sessionId}`;
    const cloneUrl = `${proxyBaseUrl}/github.com/${repoFullName}.git`;
    const githubRemoteUrl = `https://github.com/${repoFullName}.git`;

    // Check if the repo is already cloned (sprite may be persistent)
    const isCloned = await sprite.execHttp(
      `test -d ${WORKSPACE_DIR}/.git && echo 'exists' || echo 'empty'`,
      {},
    );
    if (isCloned.stdout.includes("exists")) {
      this.logger.info("Repo already cloned on sprite", {
        fields: { repoFullName, spriteName },
      });
    } else {
      this.logger.info("Cloning repo on sprite", {
        fields: { repoFullName, spriteName },
      });
      await sprite.execHttp(`mkdir -p ${WORKSPACE_DIR}`, {});

      // Fetch a read-only token scoped to contents:read for the initial clone
      const cloneTokenResult = await this.githubTokenProvider.getReadOnlyTokenForRepo(repoFullName);
      if (!cloneTokenResult.ok) {
        throw new Error(cloneTokenResult.error.message);
      }
      const cloneToken = cloneTokenResult.value;
      const basicAuth = btoa(`x-access-token:${cloneToken}`);

      const cloneStart = Date.now();
      const baseBranch = clientState.baseBranch;
      const branchFlag = baseBranch ? `--branch ${baseBranch} ` : "";
      const cloneResult = await sprite.execHttp(
        `git -c http.extraHeader="Authorization: Basic ${basicAuth}" clone --single-branch ${branchFlag}${githubRemoteUrl} ${WORKSPACE_DIR}`,
        {},
      );
      this.logger.info("Clone completed", {
        fields: {
          durationSeconds: Number(((Date.now() - cloneStart) / 1000).toFixed(1)),
          exitCode: cloneResult.exitCode,
          stderr: cloneResult.stderr.slice(0, 500),
        },
      });
      if (cloneResult.exitCode !== 0) {
        throw new Error(
          `Clone failed (exit ${cloneResult.exitCode}): ${cloneResult.stderr}`,
        );
      }
    }

    // Detect the base branch (whatever branch the clone checked out)
    const branchResult = await sprite.execHttp(
      `cd ${WORKSPACE_DIR} && git rev-parse --abbrev-ref HEAD`,
      {},
    );
    const actualBaseBranch = branchResult.stdout.trim() || "main";
    if (clientState.baseBranch && actualBaseBranch !== clientState.baseBranch) {
      this.logger.warn("Base branch does not match actual base branch", {
        fields: {
          configuredBaseBranch: clientState.baseBranch,
          actualBaseBranch,
        },
      });
    }
    if (actualBaseBranch !== clientState.baseBranch) {
      this.updatePartialState({ baseBranch: actualBaseBranch });
    }

    const gitProxySecret = this.ensureGitProxySecret();
    const runtimeConfig = this.getRuntimeConfig();
    const fetchUrl = runtimeConfig.network.mode === "locked"
      ? cloneUrl
      : githubRemoteUrl;

    // Configure remote URLs, git identity, and proxy auth header
    await sprite.execHttp(dedent`
      set -e
      cd ${WORKSPACE_DIR}
      git remote set-url origin ${fetchUrl}
      git remote set-url --push origin ${cloneUrl}
      git config user.email "agent@cloudecode.dev"
      git config user.name "Cloude Code"
      git config --unset-all http.extraHeader || true
      git config --unset-all "http.${proxyBaseUrl}/.extraHeader" || true
      git config --add "http.${proxyBaseUrl}/.extraHeader" "Authorization: Bearer ${gitProxySecret}"
    `, {});
  }

  private async tryRunStartupScript(spriteName: string): Promise<void> {
    const runtimeConfig = this.getRuntimeConfig();
    const sprite = new WorkersSpriteClient(
      spriteName,
      this.env.SPRITES_API_KEY,
      this.env.SPRITES_API_URL,
    );

    try {
      await this.startupScriptService.run({
        sprite,
        script: runtimeConfig.startupScript,
        workspaceDir: WORKSPACE_DIR,
        env: runtimeConfig.plainEnvVars,
      });
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      this.logger.warn("Continuing after session startup script failure", {
        error,
        fields: { sessionId: this.getServerState().sessionId },
      });
      this.updatePartialState({
        lastError: errorMessage,
        status: this.synthesizeStatus(),
      });
    }
  }

  private async applyFinalNetworkPolicy(spriteName: string): Promise<void> {
    const runtimeConfig = this.getRuntimeConfig();
    const providerId = this.getClientState().agentSettings.provider;
    const sprite = new WorkersSpriteClient(
      spriteName,
      this.env.SPRITES_API_KEY,
      this.env.SPRITES_API_URL,
    );
    const workerHostname = new URL(this.env.WORKER_URL).hostname;

    await sprite.setNetworkPolicy(buildFinalNetworkPolicy({
      workerHostname,
      providerId,
      network: runtimeConfig.network,
    }));
  }
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
