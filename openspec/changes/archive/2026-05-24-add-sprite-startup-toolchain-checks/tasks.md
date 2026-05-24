## 1. Toolchain Contract

- [x] 1.1 Confirm the minimum Codex CLI version required for `gpt-5.5` using Codex release notes or a live Sprite smoke test.
- [x] 1.2 Add a Codex startup-check minimum version and keep the vm-agent runtime guard at the same value.
- [x] 1.3 Keep Codex version parsing/comparison inside the provider-owned bash startup script.

## 2. Startup Toolchain Service

- [x] 2.1 Add `services/api-server/src/lib/sprites/startup-toolchain/` with the common check interface, contract hash builder, and runner.
- [x] 2.2 Define a simple `StartupToolchainCheck` protocol returning typed `Result` values for expected setup failures.
- [x] 2.3 Add provider-agnostic check support plus exhaustive `ProviderId` switching for per-provider checks.
- [x] 2.4 Implement the OpenAI Codex provider as one bash startup script that checks `codex`, repairs with the approved install/update script when missing or stale, updates `PATH`, and verifies the post-repair version.
- [x] 2.5 Add explicit no-op Claude provider implementation until a concrete Claude minimum version is required.
- [x] 2.6 Add safe structured logging and sanitized failure details for check results.

## 3. State And Integration

- [x] 3.1 Extend `ServerState` defaults with startup toolchain checkpoint data.
- [x] 3.2 Run startup toolchain checks in `SessionProvisionService` after Sprite creation/network policy and before repo clone.
- [x] 3.3 Keep startup toolchain checks in the provisioning lifecycle instead of duplicating them in `SpriteAgentProcessManager`.
- [x] 3.4 Keep existing reusable vm-agent stdin dispatch behavior unchanged.

## 4. Network Policy And Tests

- [x] 4.1 Add tests that required update-script hosts are present in `DEFAULT_NETWORK_POLICY`.
- [x] 4.2 Add unit tests for contract hash changes, checkpoint skip/rerun behavior, provider dispatch exhaustiveness, and the Codex script handoff.
- [x] 4.3 Add tests proving provisioning stays provider-agnostic and routes through the startup toolchain runner.
- [x] 4.4 Add service-level tests covering new Sprite provisioning order, failed check behavior, existing checkpoint skip behavior, and provider-agnostic call sites.
- [x] 4.5 Add Codex check tests for successful script execution, script content, and script failure handling.

## 5. Validation

- [x] 5.1 Run `pnpm --filter @repo/api-server test` or the relevant API-server test target.
- [x] 5.2 Run `pnpm --filter @repo/vm-agent test`.
- [x] 5.3 Run `pnpm typecheck`.
- [x] 5.4 Run `pnpm lint`.
- [x] 5.5 Run `pnpm build`.
- [x] 5.6 Run `openspec status --change add-sprite-startup-toolchain-checks`.
