## Context

The API server creates a Sprite in `SessionProvisionService`, applies a network policy, clones the repo, and later `SpriteAgentProcessManager` uploads/runs the bundled vm-agent with provider credentials. The Codex provider currently passes `minCodexVersion: "0.104.0"` to `ai-sdk-provider-codex-cli` inside `packages/vm-agent/src/providers/codex.ts`, but that check happens after the vm-agent process has already started. If the Sprite image has an older `codex` binary that cannot use the selected Codex model, the first turn fails late.

The Sprite already supports remote command execution through `WorkersSpriteClient.execHttp(...)`, so startup toolchain checks can be implemented as provisioning-time Sprite commands without changing the webhook protocol or vm-agent stream format.

## Goals / Non-Goals

**Goals:**
- Verify provider runtime CLIs before a vm-agent process starts.
- Repair missing or stale CLIs using provider-owned update scripts.
- Keep provider-specific knowledge behind one toolchain-check interface, with exhaustive dispatch over `ProviderId`.
- Persist a contract checkpoint so checks do not run on every turn, but do rerun when minimum versions or script content change.
- Keep the vm-agent provider-level minimum version check as a final defensive guard.

**Non-Goals:**
- Replace the Sprite base image or require image rebuilds for normal CLI updates.
- Add a new client-visible workflow or manual "repair environment" action.
- Update arbitrary repo dependencies inside `/home/sprite/workspace`.
- Remove provider runtime validation from `ai-sdk-provider-codex-cli`.

## Decisions

### Add a Sprite startup toolchain provider protocol in the API server

Create a server-side module under `services/api-server/src/lib/sprites/startup-toolchain/` with:
- `ProviderStartupToolchain`: provider protocol analogous to `ProviderCredentialAdapter` and `ToolPartNormalizer`.
- `getProviderStartupToolchain(providerId: ProviderId, deps)`: exhaustive `switch` returning the provider implementation.
- `buildStartupToolchainContract(...)`: stable contract hash derived from check ids, minimum versions, and script bodies.
- `ensureSpriteStartupToolchain(sprite, providerId, checkpoint)`: runs missing/stale checks and returns the new checkpoint.

This should deliberately mirror two existing provider patterns:

- `services/api-server/src/lib/providers/provider-credential-adapter.ts`: API-server-owned provider adapters can depend on `Env`, `Logger`, service clients, and durable state, and return typed `Result` failures instead of throwing for expected provider/setup failures.
- `packages/shared/src/tool-normalization/index.ts`: provider-specific implementations live in per-provider files, callers use one public dispatch function, and a `switch (providerId)` with a `never` default makes missing providers a type error.

The startup toolchain protocol should follow that shape rather than becoming loose command lists:

```typescript
export interface ProviderStartupToolchain {
  getContract(): ProviderStartupToolchainContract;
  ensureReady(input: {
    sprite: WorkersSpriteClient;
    checkpoint: ProviderStartupToolchainCheckpoint | null;
  }): Promise<Result<ProviderStartupToolchainCheckpoint, ProviderStartupToolchainError>>;
}
```

Provider modules own their internal implementation details, including check ordering, version parsing, repair commands, and post-repair verification. The call sites in `SessionProvisionService` and `SpriteAgentProcessManager` should only call the protocol and persist the returned checkpoint.

Alternative considered: keep the logic in `packages/vm-agent`. Rejected because the vm-agent can fail before it can repair the dependency it needs, and because CLI repair is Sprite environment setup rather than per-turn agent logic.

### Run checks after Sprite creation and guard dispatch

`SessionProvisionService.provision()` should run the startup toolchain service immediately after network policy setup and before repo clone for the session's current provider. `SpriteAgentProcessManager.doDispatch()` should also call the same service before spawning a new vm-agent when the stored checkpoint does not satisfy the current provider contract. This catches provider changes after initial provisioning while keeping the common path cheap.

If an existing reusable vm-agent process is already running for the same provider, dispatch can try reuse first; if it must spawn, the checkpoint guard runs before spawn.

Alternative considered: only run checks during initial provisioning. Rejected because sessions can outlive the initial provider choice and because a contract bump must repair existing Sprites before the next fresh provider process.

### Persist a versioned checkpoint in server state

Add a `startupToolchain` field to `ServerState`, for example:

```typescript
startupToolchain: {
  contractHash: string;
  providers: Partial<Record<ProviderId, {
    contractHash: string;
    checkedAt: number;
    results: Array<{ id: string; status: "already-current" | "updated" }>;
  }>>;
} | null;
```

The exact shape can be tightened during implementation, but it must support per-provider contract hashes. The repository already merges persisted state over defaults, so old sessions can adopt the new field without a migration beyond the default value.

Alternative considered: use a boolean `toolchainChecked`. Rejected because it cannot distinguish Codex vs Claude checks or force rerun when the required minimum version changes.

### Provider implementations own command detection and repair

Each provider implementation may use helper check objects internally, but the public surface should stay provider-level. A check has stable metadata that contributes to the provider contract:
- stable `id`
- `minVersion` or equivalent requirement metadata
- repair script identity/content
- verification strategy version

The OpenAI Codex check should:
- resolve the active `codex` binary with `command -v codex`
- parse `codex --version` output such as `codex-cli 0.124.0`
- compare against one shared `MIN_CODEX_CLI_VERSION` constant
- run the official Linux/macOS install script when missing or too old: `curl -fsSL https://chatgpt.com/codex/install.sh | sh`
- update `PATH` for the current shell if the installer writes into `$HOME/.local/bin` or a similar user-local bin directory
- verify `codex --version` after repair and fail if the version remains below the minimum

The same `MIN_CODEX_CLI_VERSION` should feed both the startup toolchain check and the vm-agent Codex provider's `minCodexVersion` setting so the repair gate and runtime guard cannot drift.

Claude should still have an explicit provider implementation even if it initially returns an empty contract/checkpoint. That is the same "provider owns its case" discipline used by tool normalization: adding a provider is handled in the provider module and the central exhaustive switch, not by scattering conditionals into provisioning.

Alternative considered: run `npm install -g @openai/codex@latest`. Rejected as the primary path because the current Codex README lists `https://chatgpt.com/codex/install.sh` as the first Mac/Linux install path, while npm is an alternative package-manager install. The npm command can remain a future fallback only if the official installer is unavailable in the Sprite environment.

### Keep network policy explicit

The existing default policy already allows `chatgpt.com`, `openai.com`, and npm registry hosts. The implementation should add a focused test for the domains required by the active repair scripts so a future script change cannot silently fail behind network policy.

### Surface failures as provisioning failures

Startup check failures should throw from provisioning and map to the existing `lastError`/session status path. Dispatch-time guard failures should return a `SPAWN_FAILED`-class manager error with the failed check id and sanitized command output. Logs should use static messages with structured fields for provider, check id, installed version, required version, and status.

## Risks / Trade-offs

- Official installer behavior changes → Keep the script body centralized, include a contract hash, and verify the binary/version after every repair.
- The installed binary lands outside non-interactive `PATH` → The check should explicitly export known user-local bin directories during inspect/repair/verify and record the resolved binary path.
- Network policy blocks a future download host → Tests should assert all script hosts are present in `DEFAULT_NETWORK_POLICY`; failures remain explicit provisioning errors.
- Running repair in dispatch increases turn latency after contract bumps → The checkpoint avoids steady-state cost, and contract-bump repair is preferable to a late provider failure.
- Version parsing misses a new CLI output format → The parser should be unit-tested against current `codex --version` output and fail closed with a clear provisioning error.

## Migration Plan

1. Add the startup toolchain service with no-op generic checks and provider dispatch.
2. Add the Codex check using the shared minimum version constant and official install script.
3. Add `ServerState.startupToolchain` defaulting to `null`; old persisted state remains readable through default merging.
4. Run checks in `SessionProvisionService` after Sprite creation/network policy and before clone.
5. Add the dispatch-time checkpoint guard before fresh vm-agent spawn.
6. Deploy. Existing sessions rerun checks on their next provisioning/dispatch path because they have no matching checkpoint.
7. Rollback by disabling calls to the service; already-updated CLIs on Sprites remain harmless.

## Open Questions

- What exact `MIN_CODEX_CLI_VERSION` should be set for GPT-5.5 support? The implementation should confirm from Codex release notes or a live Sprite smoke test, then update the current `0.104.0` runtime guard to the same value.
- Should Claude Code get an explicit minimum version now, or should its provider module return no checks until we have a concrete minimum?
