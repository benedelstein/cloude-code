import type { ClientState, Logger, SessionStatus } from "@repo/shared";
import type { Env } from "@/shared/types";
import type { SpritesCoordinator } from "@/shared/integrations/sprites/sprites";
import { WorkersSpriteClient } from "@/shared/integrations/sprites/WorkersSpriteClient";
import { buildNetworkPolicy } from "@/shared/integrations/sprites/network-policy";
import { ensureSpriteStartupToolchain } from "@/shared/integrations/sprites/startup-toolchain";
import { configureGitRemote } from "@/shared/integrations/git/git-setup.service";
import type { GitHubAppResult } from "@/shared/types/github";
import type { ServerState } from "../repositories/server-state-repository";

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
  private readonly updateServerState: SessionProvisionServiceDeps["updateServerState"];
  private readonly updatePartialState: SessionProvisionServiceDeps["updatePartialState"];
  private readonly synthesizeStatus: () => SessionStatus;
  private readonly ensureGitProxySecret: () => string;
  private readonly githubTokenProvider: SessionProvisionServiceDeps["githubTokenProvider"];

  /** Mutex for durable provisioning steps (sprite creation, repo clone). */
  private ensureProvisionedPromise: Promise<void> | null = null;

  constructor(deps: SessionProvisionServiceDeps) {
    this.logger = deps.logger.scope("session-provision-service");
    this.env = deps.env;
    this.spritesCoordinator = deps.spritesCoordinator;
    this.getServerState = deps.getServerState;
    this.getClientState = deps.getClientState;
    this.updateServerState = deps.updateServerState;
    this.updatePartialState = deps.updatePartialState;
    this.synthesizeStatus = deps.synthesizeStatus;
    this.ensureGitProxySecret = deps.ensureGitProxySecret;
    this.githubTokenProvider = deps.githubTokenProvider;
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
      if (!serverState.spriteName) {
        this.updatePartialState({ status: this.synthesizeStatus() });
        this.logger.debug("Provisioning sprite for session", {
          fields: { sessionId: serverState.sessionId },
        });

        const spriteResponse = await this.spritesCoordinator.createSprite({
          name: serverState.sessionId!,
        });

        // Lock down outbound network access to known-good domains
        const sprite = new WorkersSpriteClient(
          spriteResponse.name,
          this.env.SPRITES_API_KEY,
          this.env.SPRITES_API_URL,
        );
        const workerHostname = new URL(this.env.WORKER_URL).hostname;
        const networkPolicy = buildNetworkPolicy([
          { domain: workerHostname, action: "allow" },
        ]);
        await sprite.setNetworkPolicy(networkPolicy);

        this.updateServerState({ spriteName: spriteResponse.name });
        this.updatePartialState({ status: this.synthesizeStatus() });
      }

      const spriteName = this.getServerState().spriteName;
      if (spriteName) {
        await this.ensureStartupToolchain(spriteName);
      }

      if (!this.getServerState().repoCloned) {
        this.updatePartialState({ status: this.synthesizeStatus() });
        await this.cloneRepo(spriteName!);
        this.updateServerState({ repoCloned: true });
        this.updatePartialState({
          status: this.synthesizeStatus(),
          lastError: null,
        });
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
    if (actualBaseBranch !== clientState.baseBranch && clientState.baseBranch) {
      this.logger.warn("Base branch does not match actual base branch", {
        fields: {
          configuredBaseBranch: clientState.baseBranch,
          actualBaseBranch,
        },
      });
    }
    this.updatePartialState({ baseBranch: actualBaseBranch });

    const gitProxySecret = this.ensureGitProxySecret();

    // Configure remote URLs, git identity, and proxy auth header
    await configureGitRemote(sprite, {
      workspaceDir: WORKSPACE_DIR,
      githubRemoteUrl,
      cloneUrl,
      proxyBaseUrl,
      gitProxySecret,
    });
  }
}
