## 1. Data Model And Shared Types

- [x] 1.1 Add D1 migration for `repo_environments` with repo id, user id, name, network mode, extra allowlist JSON, plain env vars JSON, startup script, and timestamps.
- [x] 1.2 Add nullable `source_environment_id` and `source_environment_name` columns to `sessions`.
- [x] 1.3 Add shared Zod/API types for repo environment CRUD payloads, network access config, and create-session environment selection.
- [x] 1.4 Add shared/server-only types for `SessionRuntimeConfigSnapshot` and extend `InitSessionAgentRequest` to carry it.

## 2. Repo Environments API Module

- [x] 2.1 Create `services/api-server/src/modules/repo-environments/` with routes, schemas, service, repository, and module-local types.
- [x] 2.2 Implement list/read/create/update/delete environment behavior with repo access validation.
- [x] 2.3 Validate network mode values, extra allowlist domains, plain env var keys/values, startup script limits, and no secret/path fields.
- [x] 2.4 Wire repo environment routes through `services/api-server/src/composition/build-routes.ts`.
- [x] 2.5 Add API-server tests for CRUD authorization, repo scoping, validation failures, and deletion behavior.

## 3. Session Creation Integration

- [x] 3.1 Extend session creation request handling to accept optional `environmentId`.
- [x] 3.2 Add a repo-environment resolver provider interface to `SessionsServiceDeps` and wire the concrete resolver from composition.
- [x] 3.3 Resolve the selected environment after repo access validation and reject environments outside the requested repo.
- [x] 3.4 Store `source_environment_id` and `source_environment_name` on session creation when an environment is selected.
- [x] 3.5 Pass the resolved immutable runtime config snapshot into `initializeSessionAgent`.
- [x] 3.6 Add session service and shared type tests for valid environment selection, invalid repo mismatch, and omitted environment default behavior.

## 4. Durable Object Runtime Snapshot

- [x] 4.1 Add a session-agent Durable Object repository for persisting the server-only runtime config snapshot.
- [x] 4.2 Store the snapshot during `SessionAgentDO.handleInit` and load it on DO restart.
- [x] 4.3 Keep `SessionAgentDO` changes limited to repository construction, snapshot persistence, and dependency wiring.
- [x] 4.4 Add migration/default behavior for existing sessions without a runtime config snapshot.
- [x] 4.5 Add focused DO repository or provisioning tests proving environment edits do not mutate existing session runtime config.

## 5. Network Policy Construction

- [x] 5.1 Refactor Sprite network policy helpers to build bootstrap default policy and final policies for `open`, `locked`, `default`, and `custom`.
- [x] 5.2 Add provider-specific locked host helper with an exhaustive switch for Claude Code and OpenAI Codex providers.
- [x] 5.3 Include required cloude-code worker/control-plane access in bootstrap and non-open final policies.
- [x] 5.4 Ensure `default` matches the current curated default behavior and `custom` can include or exclude that default allowlist.
- [x] 5.5 Add unit tests for each network mode, provider host selection, custom allowlist inclusion, and exhaustive provider behavior.

## 6. Provisioning And Startup Script Flow

- [x] 6.1 Update `SessionProvisionService` to apply bootstrap policy before toolchain, clone, git setup, and startup script execution.
- [x] 6.2 Add `SessionStartupScriptService` to run startup scripts from `/home/sprite/workspace` with plain env vars, timeout, output cap, and nonzero exit failure.
- [x] 6.3 Add durable provisioning checkpoint state for completed startup scripts so successful scripts do not rerun on DO restart.
- [x] 6.4 Apply the selected final network policy after startup script completion and before agent process start.
- [x] 6.5 Pass plain env vars from the runtime config snapshot into the startup script and agent process environment.
- [x] 6.6 Add provisioning tests for bootstrap policy order, startup script success/failure, final policy application before agent start, and default behavior without an environment.

## 7. Git Proxy Behavior For Locked Mode

- [x] 7.1 Decide whether this change routes fetch through the git proxy for locked mode or documents direct fetch as blocked after final lockdown.
- [x] 7.2 If routing fetch through proxy, update git setup so locked sessions configure both fetch and push remotes through the git proxy after initial clone.
- [x] 7.3 Add tests for locked-mode git remote configuration and existing default behavior.

## 8. Web UI

- [x] 8.1 Add client API helpers and SWR/cache behavior for repo environment CRUD and session creation environment selection.
- [x] 8.2 Add settings UI at `/settings/environments` for listing existing repo environments.
- [x] 8.3 Add settings UI at `/settings/environments/create` for creating a repo environment.
- [x] 8.4 Add session creation UI for selecting an environment or using default runtime configuration.
- [x] 8.5 Show network mode choices, default allowlist visibility, extra domain entry, plain env vars, and startup script editor.
- [x] 8.6 Add UI copy that plain env vars are not secrets and that locked mode restricts agent network access after setup.
- [x] 8.7 Add focused component tests and browser validation for environment selection and management flows.

## 9. Validation

- [x] 9.1 Run API-server targeted tests for repo environments, session creation, network policy, and provisioning.
- [x] 9.2 Run web targeted tests for environment management and session creation UI.
- [x] 9.3 Run `pnpm build`.
- [x] 9.4 Run `pnpm lint`.
- [x] 9.5 Run `pnpm typecheck`.
- [x] 9.6 Run browser validation for visual/session creation changes.
