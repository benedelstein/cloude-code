## 1. Toolchain Contract

- [x] 1.1 Confirm the minimum Codex CLI version required for `gpt-5.5` using Codex release notes or a live Sprite smoke test.
- [x] 1.2 Add a shared `MIN_CODEX_CLI_VERSION` constant used by both the API-server startup check and `packages/vm-agent/src/providers/codex.ts`.
- [x] 1.3 Add version parsing/comparison utilities for provider CLI output, including `codex-cli 0.x.y` output.

## 2. Startup Toolchain Service

- [x] 2.1 Add `services/api-server/src/lib/sprites/startup-toolchain/` with the common check interface, contract hash builder, and runner.
- [x] 2.2 Define a `ProviderStartupToolchain` protocol modeled after `ProviderCredentialAdapter` and `ToolPartNormalizer`, returning typed `Result` values for expected setup failures.
- [x] 2.3 Add provider dispatch with exhaustive `ProviderId` switching and per-provider modules for `openai-codex` and `claude-code`.
- [x] 2.4 Implement the OpenAI Codex provider: inspect `codex`, repair with the approved install/update script when missing or stale, update `PATH`, and verify the post-repair version.
- [x] 2.5 Add explicit no-op Claude provider implementation until a concrete Claude minimum version is required.
- [x] 2.6 Add safe structured logging and sanitized failure details for check results.

## 3. State And Integration

- [x] 3.1 Extend `ServerState` defaults with provider-specific startup toolchain checkpoint data.
- [x] 3.2 Run startup toolchain checks in `SessionProvisionService` after Sprite creation/network policy and before repo clone.
- [x] 3.3 Add the fresh-spawn guard in `SpriteAgentProcessManager` so existing Sprites or provider switches run checks before vm-agent startup when their checkpoint is missing or stale.
- [x] 3.4 Keep existing reusable vm-agent stdin dispatch behavior unchanged.

## 4. Network Policy And Tests

- [x] 4.1 Add tests that required update-script hosts are present in `DEFAULT_NETWORK_POLICY`.
- [x] 4.2 Add unit tests for version parsing, minimum-version comparison, contract hash changes, checkpoint skip/rerun behavior, and provider dispatch exhaustiveness.
- [x] 4.3 Add tests proving provisioning and dispatch call sites stay provider-agnostic and route through `getProviderStartupToolchain(...)`.
- [x] 4.4 Add service-level tests covering new Sprite provisioning order, failed check behavior, existing checkpoint skip behavior, and dispatch-time guard behavior.
- [x] 4.5 Add Codex check tests for already-current, missing CLI repair, stale CLI update, and repair-still-too-old failure cases.

## 5. Validation

- [x] 5.1 Run `pnpm --filter @repo/api-server test` or the relevant API-server test target.
- [x] 5.2 Run `pnpm --filter @repo/vm-agent test`.
- [x] 5.3 Run `pnpm typecheck`.
- [x] 5.4 Run `pnpm lint`.
- [x] 5.5 Run `pnpm build`.
- [x] 5.6 Run `openspec status --change add-sprite-startup-toolchain-checks`.
