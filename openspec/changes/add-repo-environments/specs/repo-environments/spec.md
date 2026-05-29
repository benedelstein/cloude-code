## ADDED Requirements

### Requirement: Repo environments are scoped to repositories
The system SHALL allow authenticated users to create, list, read, update, and delete repo environments for repositories they can access.

#### Scenario: User lists environments for an accessible repo
- **WHEN** an authenticated user requests repo environments for a repository they can access
- **THEN** the system returns only environments scoped to that repository

#### Scenario: User lists owned environments in settings
- **WHEN** an authenticated user opens the environments settings page
- **THEN** the system returns the user's existing repo environments with repo display names

#### Scenario: User cannot access environments for another repo
- **WHEN** an authenticated user requests or mutates an environment for a repository they cannot access
- **THEN** the system rejects the request

### Requirement: Repo environments define V1 session setup fields
The system SHALL store each repo environment with a name, repo id, network access config, plain non-secret environment variables, and optional startup script.

#### Scenario: Environment includes startup script and plain env vars
- **WHEN** a user saves a repo environment with a startup script and plain env vars
- **THEN** the system persists those values as source configuration for future session creation

#### Scenario: Environment excludes secrets and paths
- **WHEN** a user creates or updates a repo environment
- **THEN** the system does not accept secret bindings or workspace path configuration as V1 environment fields

### Requirement: Session creation can select a repo environment
The system SHALL allow session creation to optionally select a repo environment belonging to the requested repository.

#### Scenario: Session selects a valid repo environment
- **WHEN** a user creates a session with a repo id and an environment id belonging to that repo
- **THEN** the system creates the session and initializes the Durable Object with a resolved environment snapshot

#### Scenario: Session selects an environment from another repo
- **WHEN** a user creates a session with an environment id that does not belong to the requested repo
- **THEN** the system rejects session creation

#### Scenario: Session omits environment
- **WHEN** a user creates a session without an environment id
- **THEN** the system creates the session with a default environment snapshot

### Requirement: Session environment snapshot is immutable after session creation
The system SHALL resolve the selected repo environment into a server-only environment snapshot during session creation and SHALL use that snapshot for the session's provisioning and agent behavior.

#### Scenario: Source environment changes after session creation
- **WHEN** a repo environment is edited after a session has been created from it
- **THEN** the existing session continues using the environment snapshot resolved at session creation

#### Scenario: Session stores source reference metadata
- **WHEN** a session is created from a repo environment
- **THEN** the central sessions table stores the source environment id and source environment name but not the full environment snapshot JSON

#### Scenario: Durable Object stores environment snapshot
- **WHEN** the Durable Object initializes the session
- **THEN** it stores the resolved environment snapshot in server-only Durable Object storage

### Requirement: Startup scripts run before the first agent turn
The system SHALL run the selected environment startup script from `/home/sprite/workspace` after repository clone and git setup, and before the first agent process starts.

#### Scenario: Startup script succeeds
- **WHEN** a session has a startup script and the script exits successfully
- **THEN** provisioning continues and the first pending agent turn can start

#### Scenario: Startup script fails
- **WHEN** a session has a startup script and the script exits nonzero or times out
- **THEN** provisioning fails, the session records the error, and the first agent turn does not start

#### Scenario: Startup script receives plain env vars
- **WHEN** a session has plain environment variables in its environment snapshot
- **THEN** the system provides those variables to the startup script and agent process

### Requirement: Bootstrap provisioning uses the curated default network policy
The system SHALL use the curated default Sprite network policy plus required cloude-code control-plane access during toolchain setup, repository clone, git setup, and startup script execution.

#### Scenario: Locked environment still uses bootstrap default during setup
- **WHEN** a session is created with locked final network access
- **THEN** toolchain setup, clone, git setup, and startup script execution run under the bootstrap default policy before final lockdown

#### Scenario: Final policy is applied before agent start
- **WHEN** setup and startup script execution complete
- **THEN** the system applies the selected final network policy before starting the agent process

### Requirement: Final network policy supports no-access, default, custom, and unrestricted modes
The system SHALL support `locked`, `default`, `custom`, and `open` as final network access modes for repo environments.

#### Scenario: Default final policy
- **WHEN** an environment uses `default`
- **THEN** the final policy allows the curated default network policy plus required cloude-code control-plane access

#### Scenario: Custom final policy includes default
- **WHEN** an environment uses `custom` with extra allowed domains and default inclusion enabled
- **THEN** the final policy allows the curated default policy, required cloude-code control-plane access, and the custom domains

#### Scenario: Custom final policy excludes default
- **WHEN** an environment uses `custom` with extra allowed domains and default inclusion disabled
- **THEN** the final policy allows required cloude-code control-plane access, selected provider hosts, and the custom domains while excluding the curated default package/source-control hosts

#### Scenario: Locked final policy
- **WHEN** an environment uses `locked`
- **THEN** the final policy allows required cloude-code control-plane access and selected provider hosts while excluding direct GitHub and package-manager hosts

#### Scenario: Open final policy
- **WHEN** an environment uses `open`
- **THEN** the final policy allows unrestricted outbound access after setup completes

#### Scenario: User views default allowlist
- **WHEN** a user opens the default allowlist details from an environment form
- **THEN** the system returns and displays the domains included in the curated default allowlist

### Requirement: Locked network policy is provider-aware
The system SHALL derive locked-mode provider hosts from the selected agent provider using an exhaustive provider switch.

#### Scenario: Claude Code provider selected
- **WHEN** locked mode is applied for a session using the Claude Code provider
- **THEN** the final policy includes the required Claude provider hosts

#### Scenario: OpenAI Codex provider selected
- **WHEN** locked mode is applied for a session using the OpenAI Codex provider
- **THEN** the final policy includes the required OpenAI provider hosts
