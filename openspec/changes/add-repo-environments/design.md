## Context

Session provisioning is coordinated by `SessionAgentDO`, with most provisioning behavior delegated to `SessionProvisionService`. Today the provisioner creates a Sprite, applies the curated default network policy, ensures the provider toolchain, clones the repo, configures git, and then allows chat dispatch to start the agent process.

The current git flow clones directly from GitHub using a one-off read-only installation token. That token is not persisted in git config. After clone, `SessionProvisionService.cloneRepo(...)` removes extra headers, keeps fetch pointed at direct GitHub, and points push at the cloude-code git proxy. This means private repo fetch/pull after clone is already limited unless a later change routes fetch through the proxy.

Repo environments add user-selected provisioning config without turning the feature into global environment management. V1 intentionally uses repo scope, assumes repository root as the startup working directory, and excludes secrets.

## Goals / Non-Goals

**Goals:**

- Add repo-scoped environments with name, startup script, plain env vars, and final network mode.
- Keep bootstrap provisioning predictable by using the curated default network policy during toolchain setup, clone, git setup, and startup script execution.
- Apply the selected final network policy only after startup completes and before the agent starts.
- Store editable source environments in D1 and store an immutable resolved snapshot in Durable Object storage.
- Store only source environment reference metadata on the central `sessions` row.
- Keep `SessionAgentDO` as a composition root; put environment resolution, runtime config persistence, network policy construction, startup script execution, and provisioning changes in focused modules/services.

**Non-Goals:**

- No secrets support in V1.
- No global environments in V1.
- No path-scoped workspaces in V1.
- No environment inheritance or per-user overrides.
- No live mutation of an active session when an environment changes.
- No source runtime config JSON snapshot in the central `sessions` table.

## Decisions

### Repo environments are D1-owned source config

Add a `repo_environments` D1 table owned by a new `repo-environments` API module:

```text
repo_environments
  id TEXT PRIMARY KEY
  user_id TEXT NOT NULL
  repo_id INTEGER NOT NULL
  repo_full_name TEXT NOT NULL
  name TEXT NOT NULL
  network_mode TEXT NOT NULL
  network_extra_allowlist_json TEXT NOT NULL
  network_include_default_allowlist INTEGER NOT NULL DEFAULT 0
  plain_env_vars_json TEXT NOT NULL
  startup_script TEXT
  created_at TEXT NOT NULL
  updated_at TEXT NOT NULL
```

Repo access validation remains required before listing by repo, reading, creating, updating, deleting, or selecting an environment for a repo. The settings index can list environments owned by the current user without a per-repo GitHub access check because it does not expose another user's data or mutate repo-scoped state.

Alternative considered: store environments only in Durable Object storage. Rejected because environments are reusable repo configuration and need normal API list/edit surfaces independent of a specific session DO.

### Sessions store source reference only; DO stores immutable runtime snapshot

Add lightweight session columns:

```text
sessions.source_environment_id TEXT
sessions.source_environment_name TEXT
```

At session creation, `SessionsService` resolves the selected environment into:

```ts
SessionRuntimeConfigSnapshot {
  sourceEnvironmentId: string | null;
  sourceEnvironmentName: string | null;
  repoId: number;
  network: NetworkAccessConfig;
  plainEnvVars: Record<string, string>;
  startupScript: string | null;
  resolvedAt: string;
  schemaVersion: 1;
}
```

The snapshot is passed through `InitSessionAgentRequest` and stored in a new session-agent Durable Object repository. The DO uses only this snapshot for provisioning. Later edits to the source environment do not affect existing sessions.

Alternative considered: store the full snapshot JSON on `sessions`. Rejected for V1 to keep central session rows light; D1 stores only the user-facing source reference.

### Network config has four V1 modes

Use:

```ts
type NetworkAccessConfig =
  | { mode: "open" }
  | { mode: "locked" }
  | { mode: "default" }
  | {
      mode: "custom";
      extraAllowlist: string[];
      includeDefaultAllowlist: boolean;
    };
```

`default` is the default behavior.

Final policy semantics:

- `open`: allow outbound access after startup.
- `default`: curated default allowlist plus required cloude-code control-plane hosts.
- `custom`: extra domains plus required cloude-code control-plane and provider hosts; optionally include the curated default allowlist.
- `locked`: required cloude-code control-plane hosts plus provider-specific model/auth hosts; direct GitHub and package-manager hosts are not included after startup.

The curated default allowlist is exposed through a read-only authenticated endpoint so the settings UI can show users the exact domains included before they choose default access or include it in custom access.

### Bootstrap policy is always the curated default policy

Provisioning uses two policies:

```text
bootstrap policy:
  curated default + cloude-code worker/control-plane

final policy:
  selected repo environment mode
```

The bootstrap policy is applied before toolchain setup, clone, git setup, and startup script execution. The final policy is applied after startup completes and before the first agent process starts.

Alternative considered: leave Sprites open during bootstrap. Rejected because Sprites appear to default to open outbound networking, and current cloude-code behavior already applies a curated default policy before clone. Keeping explicit bootstrap policy avoids accidentally widening setup.

### Provider-specific locked hosts live in network policy support code

Add a provider host helper near Sprite/network integration, not in `SessionAgentDO` and not as a startup-toolchain check:

```ts
getProviderNetworkPolicyRules(providerId: ProviderId): NetworkPolicyRule[]
```

Use an exhaustive `switch` over provider id. The startup-toolchain module remains responsible for installing/verifying provider binaries; provisioning/network support owns network policy construction.

### Startup script execution is a provisioning step

Add `SessionStartupScriptService` under `modules/session-agent/services`. It runs the snapshot startup script from `/home/sprite/workspace` after clone/git setup and before final network policy application.

Guardrails:

- execute as normal Sprite user
- bounded runtime
- bounded captured output
- nonzero exit fails provisioning
- no automatic retry loop
- plain env vars passed to script
- no secret-specific redaction in V1 because secrets are out of scope

Add a durable checkpoint such as `startupScriptCompleted` to avoid rerunning a completed startup script after DO restart.

### Keep DO changes limited to wiring

`SessionAgentDO` should:

- instantiate the runtime config repository
- pass snapshot repository access into `SessionProvisionService`
- store the snapshot during `handleInit`

It should not contain environment lookup, policy construction, startup script execution, or git-mode branching.

## Risks / Trade-offs

- Locked environments may fail after startup if agent work needs package managers or arbitrary external APIs -> Users must choose `default`, `custom`, or `open` for those workflows; make this clear in UI copy.
- Running startup scripts under bootstrap default means the script has broader access than locked agent turns -> This is intentional for setup, but logs and UI should distinguish setup access from final agent access.
- Direct GitHub fetch is currently configured after clone -> Locked mode should route both fetch and push through the git proxy, or explicitly document that locked mode blocks direct fetch after startup.
- Environment deletion could leave sessions referencing missing source environments -> Existing sessions keep their DO snapshot; session rows keep source name for display.
- Plain env vars can be misused for secrets -> UI and API naming must call them plain/non-secret, and secrets remain explicitly unsupported in V1.

## Migration Plan

1. Add D1 migrations for `repo_environments` and nullable source environment columns on `sessions`.
2. Add shared API types for repo environment CRUD, network config, and session runtime config snapshot.
3. Add the `repo-environments` module and route wiring.
4. Update session creation to accept an optional environment id, validate repo ownership, resolve a snapshot, store session source reference, and pass the snapshot to the DO.
5. Add a DO runtime config repository and store the snapshot during initialization.
6. Refactor provisioning to apply bootstrap policy, run startup script, apply final policy, and then dispatch the agent.
7. Add settings UI for listing and creating environments, plus session creation UI for selecting an existing repo environment.
8. Validate with repo-level build, lint, typecheck, targeted tests, and browser checks for UI changes.

Rollback is additive: leave nullable session columns unused, keep existing sessions without snapshots on default behavior, and make environment selection optional.

## Open Questions

- Should locked mode immediately route fetch through the git proxy in this change, or should it block direct fetch until the later git-auth fix?
- Should startup script logs be persisted in Durable Object storage, streamed to clients as provisioning events, or both?
- What exact timeout and output-size limits should V1 use for startup scripts?
