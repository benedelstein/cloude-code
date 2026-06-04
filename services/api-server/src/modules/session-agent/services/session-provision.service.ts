import {
  dedent,
  type ClientState,
  type Logger,
  type SessionEnvironmentSnapshot,
  type SessionSetupTask,
  type SessionSetupTaskOutput,
  type SessionStatus,
  type StartupScriptSetupTaskSkipReason,
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
import { isTerminalSetupTask } from "./session-setup-run.service";
import { SessionStartupScriptService } from "./session-startup-script.service";

const WORKSPACE_DIR = "/home/sprite/workspace";

type ProvisionClientStateUpdate = Partial<
  Pick<ClientState, "baseBranch" | "lastError" | "status">
>;
type ProvisionSetupTask = Extract<
  SessionSetupTask,
  { id: "cloud_container" | "repository" | "setup_script" | "network_policy" }
>;
type ProvisionSetupTaskId = ProvisionSetupTask["id"];

export interface SessionSetupTaskReporter {
  startTask(taskId: ProvisionSetupTaskId): void;
  completeTask(
    taskId: ProvisionSetupTaskId,
    output?: SessionSetupTaskOutput,
  ): void;
  failTask(
    taskId: ProvisionSetupTaskId,
    error: string,
    output?: SessionSetupTaskOutput,
  ): void;
  skipTask(
    taskId: ProvisionSetupTaskId,
    skipReason?: StartupScriptSetupTaskSkipReason,
  ): void;
}

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
  getEnvironmentSnapshot: () => SessionEnvironmentSnapshot;
  updateServerState: (partial: Partial<ServerState>) => void;
  updatePartialState: (partial: ProvisionClientStateUpdate) => void;
  synthesizeStatus: () => SessionStatus;
  ensureGitProxySecret: () => string;
  githubTokenProvider: {
    getReadOnlyTokenForRepo(repoFullName: string): Promise<GitHubAppResult<string>>;
  };
  setupReporter?: SessionSetupTaskReporter;
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
  private readonly getEnvironmentSnapshot: () => SessionEnvironmentSnapshot;
  private readonly updateServerState: SessionProvisionServiceDeps["updateServerState"];
  private readonly updatePartialState: SessionProvisionServiceDeps["updatePartialState"];
  private readonly synthesizeStatus: () => SessionStatus;
  private readonly ensureGitProxySecret: () => string;
  private readonly githubTokenProvider: SessionProvisionServiceDeps["githubTokenProvider"];
  private readonly setupReporter: SessionProvisionServiceDeps["setupReporter"];
  private readonly startupScriptService: SessionStartupScriptService;

  /** Mutex for durable provisioning steps (sprite creation, repo clone). */
  private ensureProvisionedPromise: Promise<void> | null = null;

  constructor(deps: SessionProvisionServiceDeps) {
    this.logger = deps.logger.scope("session-provision-service");
    this.env = deps.env;
    this.spritesCoordinator = deps.spritesCoordinator;
    this.getServerState = deps.getServerState;
    this.getClientState = deps.getClientState;
    this.getEnvironmentSnapshot = deps.getEnvironmentSnapshot;
    this.updateServerState = deps.updateServerState;
    this.updatePartialState = deps.updatePartialState;
    this.synthesizeStatus = deps.synthesizeStatus;
    this.ensureGitProxySecret = deps.ensureGitProxySecret;
    this.githubTokenProvider = deps.githubTokenProvider;
    this.setupReporter = deps.setupReporter;
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
    const setupRun = this.getClientState().sessionSetupRun;
    if (!setupRun) { return; }
    if (setupRun.status !== "running") {
      this.logger.error("Setup run is not running — skipping provision", { fields: { setupRunStatus: setupRun.status } });
      return;
    }

    let spriteName = this.getServerState().spriteName;
    for (const task of setupRun.tasks) {
      if (isTerminalSetupTask(task)) { continue; }
      switch (task.id) {
        case "cloud_container":
          spriteName = await this.ensureCloudContainerTask(task, spriteName);
          break;
        case "repository":
          await this.ensureRepositoryTask(task, this.requireSpriteName(spriteName));
          break;
        case "setup_script":
          await this.ensureSetupScriptTask(task, this.requireSpriteName(spriteName));
          break;
        case "network_policy":
          await this.ensureNetworkPolicyTask(task, this.requireSpriteName(spriteName));
          break;
        case "initial_agent_start":
          this.updatePartialState({ status: this.synthesizeStatus() });
          return;
        default: {
          const exhaustiveCheck: never = task;
          throw new Error(`Unhandled setup task: ${JSON.stringify(exhaustiveCheck)}`);
        }
      }
    }

    this.updatePartialState({ status: this.synthesizeStatus() });
  }

  private recordProvisioningError(error: unknown): void {
    const errorMessage = getErrorMessage(error);
    this.logger.error("Failed to provision session", { error });
    this.updatePartialState({
      lastError: errorMessage,
      status: this.synthesizeStatus(),
    });
  }

  private async ensureCloudContainerTask(
    task: Extract<ProvisionSetupTask, { id: "cloud_container" }>,
    existingSpriteName: string | null,
  ): Promise<string> {
    let spriteName = existingSpriteName;
    this.setupReporter?.startTask(task.id);
    try {
      this.updatePartialState({ status: this.synthesizeStatus() });
      if (!spriteName) {
        const sessionId = this.getServerState().sessionId;
        if (!sessionId) { throw new Error("Session id is missing"); }
        spriteName = await this.createSpriteWithBootstrapNetworkPolicy(sessionId);
        this.updateServerState({ spriteName });
        this.updatePartialState({ status: this.synthesizeStatus() });
      }
      if (!this.getServerState().startupToolchain) {
        await this.ensureStartupToolchain(spriteName);
      }
      this.setupReporter?.completeTask(task.id);
      return spriteName;
    } catch (error) {
      this.handleProvisionTaskFailure(task, error);
      return this.requireSpriteName(spriteName);
    }
  }

  private async ensureRepositoryTask(
    task: Extract<ProvisionSetupTask, { id: "repository" }>,
    spriteName: string,
  ): Promise<void> {
    this.setupReporter?.startTask(task.id);
    try {
      this.updatePartialState({ status: this.synthesizeStatus() });
      if (!this.getServerState().repoCloned) {
        await this.cloneRepo(spriteName);
        this.updateServerState({ repoCloned: true });
      }
      this.setupReporter?.completeTask(task.id);
      this.updatePartialState({
        status: this.synthesizeStatus(),
        lastError: null,
      });
    } catch (error) {
      this.handleProvisionTaskFailure(task, error);
    }
  }

  private async ensureSetupScriptTask(
    task: Extract<ProvisionSetupTask, { id: "setup_script" }>,
    spriteName: string,
  ): Promise<void> {
    this.setupReporter?.startTask(task.id);
    if (this.getServerState().startupScriptCompleted) {
      this.setupReporter?.completeTask(task.id);
      return;
    }

    const environmentSnapshot = this.getEnvironmentSnapshot();
    const startupScript = environmentSnapshot.startupScript;
    const trimmedStartupScript = startupScript?.trim() ?? "";
    this.logger.info("Checking session startup script", {
      fields: {
        sessionId: this.getServerState().sessionId,
        spriteName,
        sourceEnvironmentId: environmentSnapshot.sourceEnvironmentId,
        sourceEnvironmentName: environmentSnapshot.sourceEnvironmentName,
        networkMode: environmentSnapshot.network.mode,
        hasStartupScript: trimmedStartupScript.length > 0,
        startupScriptLength: startupScript?.length ?? 0,
        trimmedStartupScriptLength: trimmedStartupScript.length,
        envVarCount: Object.keys(environmentSnapshot.plainEnvVars).length,
      },
    });
    const sprite = new WorkersSpriteClient(
      spriteName,
      this.env.SPRITES_API_KEY,
      this.env.SPRITES_API_URL,
    );

    let result: Awaited<ReturnType<SessionStartupScriptService["run"]>>;
    try {
      result = await this.startupScriptService.run({
        sprite,
        script: environmentSnapshot.startupScript,
        workspaceDir: WORKSPACE_DIR,
        env: environmentSnapshot.plainEnvVars,
      });
    } catch (error) {
      this.logger.warn("Continuing after session startup script failure", {
        error,
        fields: { sessionId: this.getServerState().sessionId },
      });
      this.updateServerState({ startupScriptCompleted: true });
      this.handleProvisionTaskFailure(task, error);
      return;
    }

    switch (result.status) {
      case "skipped":
        this.setupReporter?.skipTask(
          task.id,
          buildSkippedSetupScriptSkipReason(environmentSnapshot),
        );
        break;
      case "completed":
        this.setupReporter?.completeTask(task.id, result.output);
        break;
      case "failed":
        this.logger.warn("Continuing after session startup script failure", {
          fields: {
            sessionId: this.getServerState().sessionId,
            errorMessage: result.errorMessage,
          },
        });
        this.updateServerState({ startupScriptCompleted: true });
        this.handleProvisionTaskFailure(
          task,
          new Error(result.errorMessage),
          result.output,
        );
        return;
    }
    this.updateServerState({ startupScriptCompleted: true });
  }

  private async ensureNetworkPolicyTask(
    task: Extract<ProvisionSetupTask, { id: "network_policy" }>,
    spriteName: string,
  ): Promise<void> {
    this.setupReporter?.startTask(task.id);
    try {
      this.updatePartialState({ status: this.synthesizeStatus() });
      await this.ensureFinalNetworkPolicy(spriteName);
      this.setupReporter?.completeTask(task.id);
      this.updatePartialState({ status: this.synthesizeStatus() });
    } catch (error) {
      this.handleProvisionTaskFailure(task, error);
    }
  }

  private async ensureFinalNetworkPolicy(spriteName: string): Promise<void> {
    if (this.getServerState().finalNetworkPolicyApplied) { return; }
    await this.applyFinalNetworkPolicy(spriteName);
    this.updateServerState({ finalNetworkPolicyApplied: true });
  }

  private handleProvisionTaskFailure(
    task: ProvisionSetupTask,
    error: unknown,
    output?: SessionSetupTaskOutput,
  ): void {
    const errorMessage = getErrorMessage(error);
    if (output) {
      this.setupReporter?.failTask(task.id, errorMessage, output);
    } else {
      this.setupReporter?.failTask(task.id, errorMessage);
    }
    if (task.isBlocking) {
      this.recordProvisioningError(error);
      throw error instanceof Error ? error : new Error(errorMessage);
    }
  }

  private requireSpriteName(spriteName: string | null): string {
    if (!spriteName) { throw new Error("Sprite name is missing"); }
    return spriteName;
  }

  private async createSpriteWithBootstrapNetworkPolicy(sessionId: string): Promise<string> {
    this.logger.debug("Provisioning sprite for session", {
      fields: { sessionId },
    });

    const spriteResponse = await this.spritesCoordinator.createSprite({
      name: sessionId,
    });

    // For provisioning, allow network access to known-good domains.
    const sprite = new WorkersSpriteClient(
      spriteResponse.name,
      this.env.SPRITES_API_KEY,
      this.env.SPRITES_API_URL,
    );
    const workerHostname = new URL(this.env.WORKER_URL).hostname;
    const networkPolicy = buildBootstrapNetworkPolicy({ workerHostname });
    await sprite.setNetworkPolicy(networkPolicy);

    return spriteResponse.name;
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
    const environmentSnapshot = this.getEnvironmentSnapshot();
    const fetchUrl = environmentSnapshot.network.mode === "locked"
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

  private async applyFinalNetworkPolicy(spriteName: string): Promise<void> {
    const environmentSnapshot = this.getEnvironmentSnapshot();
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
      network: environmentSnapshot.network,
    }));
  }
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function buildSkippedSetupScriptSkipReason(
  snapshot: SessionEnvironmentSnapshot,
): StartupScriptSetupTaskSkipReason {
  if (snapshot.sourceEnvironmentId) {
    return {
      kind: "no_script",
      environmentId: snapshot.sourceEnvironmentId,
      environmentName: snapshot.sourceEnvironmentName,
    };
  }

  return {
    kind: "no_environment",
    repoId: snapshot.repoId,
  };
}
