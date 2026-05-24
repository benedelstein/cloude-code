## ADDED Requirements

### Requirement: Sprite provisioning verifies startup toolchains before workspace setup

After a Sprite VM is created and its network policy is applied, the API server SHALL run startup toolchain checks before cloning the repository or starting a vm-agent process. The checks SHALL include provider-agnostic checks and checks for the session's current provider.

#### Scenario: Startup checks run before clone
- **WHEN** a new session provisions a Sprite
- **THEN** the Sprite network policy is applied, startup toolchain checks run, and only then does repository clone begin

#### Scenario: Startup check failure blocks provisioning
- **WHEN** any required startup toolchain check fails
- **THEN** the repository is not cloned, no vm-agent process is started, and the session status reflects the provisioning failure through the existing error path

### Requirement: Provider-specific startup checks fan out through an exhaustive provider interface

Provider-specific toolchain checks SHALL live behind a common API-server provider protocol, similar to provider credential adapters and tool normalizers. A single dispatch function SHALL select provider implementations using `ProviderId` and MUST use the repo's standard exhaustive `switch`/`never` pattern so adding a provider without startup-toolchain handling fails typecheck. Provisioning and dispatch call sites MUST call the protocol and MUST NOT branch on provider-specific CLI names, command shapes, or update scripts.

#### Scenario: Codex provider selects Codex checks
- **WHEN** the current provider is `openai-codex`
- **THEN** the startup toolchain runner resolves the OpenAI Codex provider implementation through the shared dispatch function and executes that implementation

#### Scenario: Claude provider selects Claude checks
- **WHEN** the current provider is `claude-code`
- **THEN** the startup toolchain runner resolves the Claude provider implementation through the shared dispatch function, even if the implementation currently returns an empty contract

#### Scenario: New provider must implement startup dispatch
- **WHEN** a developer adds a new `ProviderId` without adding it to the startup toolchain dispatch switch
- **THEN** TypeScript fails to compile because the exhaustive `never` assignment rejects the new provider id

#### Scenario: Call sites remain provider-agnostic
- **WHEN** inspecting `SessionProvisionService` and `SpriteAgentProcessManager`
- **THEN** neither call site contains provider-specific checks for `openai-codex`, `claude-code`, `codex`, `claude`, or provider-specific update commands

### Requirement: Codex startup check repairs missing or stale Codex CLI

The OpenAI Codex startup check SHALL verify that `codex` resolves on the Sprite and that `codex --version` is greater than or equal to the service-defined minimum Codex CLI version. If `codex` is missing or below the minimum, the check SHALL run the approved Codex install/update script for Linux/macOS and then verify the installed version again. The same minimum version constant SHALL be used by the startup check and by the vm-agent Codex provider runtime guard.

#### Scenario: Codex CLI is already current
- **WHEN** `codex --version` reports a version greater than or equal to the configured minimum
- **THEN** the Codex check records an `already-current` result and does not run the repair script

#### Scenario: Codex CLI is missing
- **WHEN** `codex` cannot be resolved on the Sprite
- **THEN** the Codex check runs the approved install script and verifies that `codex --version` now satisfies the configured minimum

#### Scenario: Codex CLI is too old
- **WHEN** `codex --version` reports a version lower than the configured minimum
- **THEN** the Codex check runs the approved update script and verifies that `codex --version` now satisfies the configured minimum

#### Scenario: Codex repair does not reach minimum
- **WHEN** the repair script exits successfully but the verified Codex CLI version remains lower than the configured minimum
- **THEN** the check fails and reports the resolved binary path, installed version, and required version in structured error details

### Requirement: Startup toolchain checkpoints are provider-specific and contract-versioned

The API server SHALL persist startup toolchain check results in server-only session state. The checkpoint SHALL be keyed by provider and by a stable contract hash derived from the required checks, minimum versions, and repair script content. A matching checkpoint SHALL skip repeated checks; a missing or stale checkpoint SHALL rerun the relevant checks.

#### Scenario: Matching checkpoint skips checks
- **WHEN** a Sprite has a persisted checkpoint for the current provider and current startup toolchain contract hash
- **THEN** provisioning and fresh vm-agent spawn skip running that provider's startup checks again

#### Scenario: Contract change reruns checks
- **WHEN** the minimum Codex CLI version or Codex repair script changes
- **THEN** the startup toolchain contract hash changes and the next provisioning or fresh vm-agent spawn reruns the Codex checks

#### Scenario: Provider switch requires provider checks
- **WHEN** a session previously checked `claude-code` and later starts a fresh `openai-codex` vm-agent process
- **THEN** the Codex startup checks run unless there is already a matching Codex checkpoint

### Requirement: Fresh vm-agent spawn is guarded by startup toolchain state

Before spawning a new vm-agent process, the API server SHALL ensure the current provider's startup toolchain checkpoint satisfies the current contract. This guard SHALL run even if the Sprite was provisioned before the current contract existed. Reusing an already-running vm-agent process MAY proceed without rerunning checks.

#### Scenario: Existing Sprite without checkpoint spawns Codex
- **WHEN** an existing session has a Sprite and repo clone but no current Codex startup toolchain checkpoint
- **THEN** the next fresh Codex vm-agent spawn runs Codex startup checks before uploading or starting the vm-agent script

#### Scenario: Existing process reuse
- **WHEN** a reusable vm-agent process accepts a new turn over stdin
- **THEN** the startup toolchain guard is not required before that reused turn because no new provider CLI process is being spawned

### Requirement: Startup check command output is logged safely

Startup toolchain checks SHALL log static messages with structured fields for provider id, check id, required version, installed version, resolved binary path, contract hash, and result status. Logs and session-facing errors MUST NOT include secrets, provider credentials, auth JSON, or full environment dumps.

#### Scenario: Successful update log
- **WHEN** the Codex check updates an old CLI successfully
- **THEN** the logs include provider id, check id, previous version, new version, required version, and `updated` status

#### Scenario: Failed update error
- **WHEN** the Codex update script fails
- **THEN** the session error identifies the failed check and sanitized command output without including credentials or token-bearing environment variables
