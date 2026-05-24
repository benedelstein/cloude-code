## Why

Sprite VMs can start with preinstalled provider CLIs that are too old for the selected model, such as a Codex CLI that cannot run GPT-5.5. The first agent turn then fails after provisioning, credential sync, and vm-agent startup even though the VM could repair itself by updating the relevant toolchain first.

## What Changes

- Add a Sprite startup toolchain check that runs after Sprite creation and before repo clone.
- Model startup checks as a small runner with provider-agnostic checks first and provider-specific checks second. Provider-specific checks still use one provider module per `ProviderId` and one exhaustive dispatch function.
- Add an OpenAI Codex hook that checks the installed `codex` CLI against the minimum version required by this service and runs the approved Codex update/install script when the installed version is missing or too old.
- Leave room for provider-agnostic checks and future provider hooks without changing provisioning call sites for each new toolchain.
- Persist a provisioning checkpoint so successful startup checks are not repeated on every turn, while still rerunning when the required toolchain contract changes.
- Surface startup-check failures through existing session provisioning error/status flow instead of letting the vm-agent fail later with a provider-specific CLI error.

## Capabilities

### New Capabilities
- `sprite-startup-toolchain`: Sprite provisioning verifies and repairs required runtime toolchains before repo setup and agent execution.

### Modified Capabilities

## Impact

- `services/api-server/src/durable-objects/lib/SessionProvisionService.ts`: run startup checks as an idempotent provisioning step.
- `services/api-server/src/durable-objects/repositories/server-state-repository.ts`: store the startup toolchain checkpoint/contract version.
- `services/api-server/src/lib/sprites/startup-toolchain/`: add the startup check runner and provider check modules.
- `services/api-server/src/lib/sprites/network-policy.ts`: ensure the update script's download hosts are allowed.
- `packages/shared/src/types/providers/`: reuse `ProviderId`/agent settings to select provider-specific checks.
- `packages/vm-agent/src/providers/codex.ts`: keep the runtime `minCodexVersion` as a defensive guard, but do not rely on it as the first repair point.
