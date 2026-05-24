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

Provider-specific toolchain checks SHALL live behind a common API-server check protocol. A single dispatch function SHALL select provider checks using `ProviderId` and MUST use the repo's standard exhaustive `switch`/`never` pattern so adding a provider without startup-toolchain handling fails typecheck. Provisioning call sites MUST call the startup runner and MUST NOT branch on provider-specific CLI names, command shapes, or update scripts.

#### Scenario: Codex provider selects Codex checks
- **WHEN** the current provider is `openai-codex`
- **THEN** the startup toolchain runner resolves OpenAI Codex checks through the shared dispatch function and executes those checks after provider-agnostic checks

#### Scenario: Claude provider selects Claude checks
- **WHEN** the current provider is `claude-code`
- **THEN** the startup toolchain runner resolves Claude checks through the shared dispatch function, even if the implementation currently returns an empty check list

#### Scenario: New provider must implement startup dispatch
- **WHEN** a developer adds a new `ProviderId` without adding it to the startup toolchain dispatch switch
- **THEN** TypeScript fails to compile because the exhaustive `never` assignment rejects the new provider id

#### Scenario: Call sites remain provider-agnostic
- **WHEN** inspecting `SessionProvisionService`
- **THEN** it contains no provider-specific checks for `openai-codex`, `claude-code`, `codex`, `claude`, or provider-specific update commands

### Requirement: Codex startup check repairs missing or stale Codex CLI

The OpenAI Codex startup check SHALL verify that `codex` resolves on the Sprite and that `codex --version` is greater than or equal to the service-defined minimum Codex CLI version. If `codex` is missing or below the minimum, the check SHALL run the approved Codex install/update script for Linux/macOS and then verify the installed version again.

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

### Requirement: Startup toolchain checkpoints are contract-versioned

The API server SHALL persist startup toolchain check results in server-only session state. The checkpoint SHALL include a stable contract hash derived from provider id, provider-agnostic checks, provider-specific checks, minimum versions, and repair script content. A matching checkpoint SHALL skip repeated checks; a missing or stale checkpoint SHALL rerun the relevant checks.

#### Scenario: Matching checkpoint skips checks
- **WHEN** a Sprite has a persisted checkpoint for the current provider and current startup toolchain contract hash
- **THEN** provisioning skips running that provider's startup checks again

#### Scenario: Contract change reruns checks
- **WHEN** the minimum Codex CLI version or Codex repair script changes
- **THEN** the startup toolchain contract hash changes and the next provisioning pass reruns the Codex checks

#### Scenario: Provider switch requires provider checks
- **WHEN** a session previously checked `claude-code` and later provisions for `openai-codex`
- **THEN** the Codex startup checks run unless there is already a matching Codex checkpoint

### Requirement: Startup check command output is logged safely

Startup toolchain checks SHALL log static messages with structured fields for provider id, check id, required version, installed version, resolved binary path, contract hash, and result status. Logs and session-facing errors MUST NOT include secrets, provider credentials, auth JSON, or full environment dumps.

#### Scenario: Successful update log
- **WHEN** the Codex check updates an old CLI successfully
- **THEN** the logs include provider id, check id, previous version, new version, required version, and `updated` status

#### Scenario: Failed update error
- **WHEN** the Codex update script fails
- **THEN** the session error identifies the failed check and sanitized command output without including credentials or token-bearing environment variables
