## Context

The API server creates a Sprite in `SessionProvisionService`, applies a network policy, clones the repo, and later `SpriteAgentProcessManager` uploads/runs the bundled vm-agent with provider credentials. The Codex provider passes a `minCodexVersion` to `ai-sdk-provider-codex-cli` inside `packages/vm-agent/src/providers/codex.ts`, but that check happens after the vm-agent process has already started. If the Sprite image has an older `codex` binary that cannot use the selected Codex model, the first turn fails late.

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

### Add a small Sprite startup toolchain runner in the API server

Create a server-side module under `services/api-server/src/lib/providers/startup-toolchain/` with:
- `StartupToolchainCheck`: a simple check protocol with `id`, `contract`, and `ensureReady(...)`.
- `getCommonStartupToolchainChecks()`: provider-agnostic checks that run before provider checks.
- `getProviderStartupToolchainChecks(providerId, deps)`: exhaustive `switch` returning provider-specific checks.
- `buildStartupToolchainContractHash(...)`: stable contract hash derived from provider id and check contracts.
- `ensureSpriteStartupToolchain(...)`: skips a matching checkpoint or runs the assembled checks and returns a new checkpoint.

This should deliberately mirror two existing provider patterns:

- `services/api-server/src/lib/providers/provider-credential-adapter.ts`: API-server-owned provider adapters can depend on `Env`, `Logger`, service clients, and durable state, and return typed `Result` failures instead of throwing for expected provider/setup failures.
- `packages/shared/src/tool-normalization/index.ts`: provider-specific implementations live in per-provider files, callers use one public dispatch function, and a `switch (providerId)` with a `never` default makes missing providers a type error.

Provider modules own their internal implementation details, including their readiness script and verification behavior. `SessionProvisionService` only calls the runner and persists the returned checkpoint.

Alternative considered: keep the logic in `packages/vm-agent`. Rejected because the vm-agent can fail before it can repair the dependency it needs, and because CLI repair is Sprite environment setup rather than per-turn agent logic.

### Run checks after Sprite creation

`SessionProvisionService.provision()` should run the startup toolchain service immediately after network policy setup and before repo clone for the session's current provider. This keeps startup readiness in one lifecycle path rather than duplicating environment checks inside `SpriteAgentProcessManager`.

Alternative considered: also guard every fresh vm-agent spawn. Rejected for now because it makes the process manager own environment provisioning concerns. If a future provider-switch workflow requires dynamic toolchain changes after clone, that should flow through a readiness/provisioning call before dispatch, not through duplicate process-manager logic.

### Persist a versioned checkpoint in server state

Add a `startupToolchain` field to `ServerState`, for example:

```typescript
startupToolchain: {
  contractHash: string;
  checkedAt: number;
  results: Array<{ id: string; status: "ready" }>;
} | null;
```

The contract hash includes the selected provider and all common/provider-specific check contracts. The repository already merges persisted state over defaults, so old sessions can adopt the new field without a migration beyond the default value.

Alternative considered: use a boolean `toolchainChecked`. Rejected because it cannot force rerun when the required minimum version or script changes.

### Codex check owns one readiness script

Each check has stable metadata that contributes to the startup contract:
- stable `id`
- `minVersion` or equivalent requirement metadata
- repair script identity/content
- verification strategy version

The OpenAI Codex check should run one provider-owned bash script that:
- resolve the active `codex` binary with `command -v codex`
- parse `codex --version` output such as `codex-cli 0.124.0`
- compare against the Codex check's internal minimum version
- run the official Linux/macOS install script when missing or too old: `curl -fsSL https://chatgpt.com/codex/install.sh | sh`
- update `PATH` for the current shell if the installer writes into `$HOME/.local/bin` or a similar user-local bin directory
- verify `codex --version` after repair and fail if the version remains below the minimum

Keep the default Codex minimum version inside the Codex startup check module. If `CODEX_MIN_VERSION` is configured, provisioning should pass that runtime override into the startup check and include it in the check contract. TypeScript should execute the script and record success/failure; it should not duplicate the script's version parsing or repair branching. The vm-agent may keep its own defensive runtime guard, but both gates must use the same effective minimum.

Claude should still have an explicit provider implementation even if it initially returns an empty check list. That is the same "provider owns its case" discipline used by tool normalization: adding a provider is handled in the provider module and the central exhaustive switch, not by scattering conditionals into provisioning.

Alternative considered: run `npm install -g @openai/codex@latest`. Rejected as the primary path because the current Codex README lists `https://chatgpt.com/codex/install.sh` as the first Mac/Linux install path, while npm is an alternative package-manager install. The npm command can remain a future fallback only if the official installer is unavailable in the Sprite environment.

### Keep network policy explicit

The existing default policy already allows `chatgpt.com`, `openai.com`, and npm registry hosts. The implementation should add a focused test for the domains required by the active repair scripts so a future script change cannot silently fail behind network policy.

### Surface failures as provisioning failures

Startup check failures should throw from provisioning and map to the existing `lastError`/session status path with the failed check id and sanitized command output. Logs should use static messages with structured fields for provider, check id, required version, and status.

## Risks / Trade-offs

- Official installer behavior changes → Keep the script body centralized, include a contract hash, and verify the binary/version after every repair.
- The installed binary lands outside non-interactive `PATH` → The script should explicitly export known user-local bin directories before checking and after install.
- Network policy blocks a future download host → Tests should assert all script hosts are present in `DEFAULT_NETWORK_POLICY`; failures remain explicit provisioning errors.
- Running repair during provisioning increases startup latency after contract bumps → The checkpoint avoids steady-state cost, and contract-bump repair is preferable to a late provider failure.
- Version parsing misses a new CLI output format → The parser should be unit-tested against current `codex --version` output and fail closed with a clear provisioning error.

## Migration Plan

1. Add the startup toolchain service with no-op generic checks and provider dispatch.
2. Add the Codex check using its internal minimum version and official install script.
3. Add `ServerState.startupToolchain` defaulting to `null`; old persisted state remains readable through default merging.
4. Run checks in `SessionProvisionService` after Sprite creation/network policy and before clone.
5. Deploy. Existing sessions rerun checks on their next provisioning path because they have no matching checkpoint.
6. Rollback by disabling calls to the service; already-updated CLIs on Sprites remain harmless.

## Resolved Questions

- The OpenAI Codex CLI minimum is `0.130.0`.
- Claude Code returns no checks until there is a concrete minimum version or repair script.
