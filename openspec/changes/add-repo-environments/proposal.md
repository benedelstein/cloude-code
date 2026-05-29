## Why

Sessions currently start with one fixed runtime setup: the API server creates a Sprite, applies the built-in network policy, clones the repository, and starts the agent. Users need repo-specific setup for startup commands, plain environment variables, and final network restrictions without introducing a broad environment-management system.

## What Changes

- Add repo-scoped environments that can be selected when creating a session.
- Allow each environment to define a startup script that runs from `/home/sprite/workspace` after clone and before the first agent turn.
- Allow each environment to define non-secret plain environment variables for startup script and agent process execution.
- Allow each environment to choose one final network mode:
  - `locked`: only cloude-code control-plane access and the selected agent provider's required hosts after startup completes.
  - `default`: curated default allowlist plus required cloude-code control-plane access.
  - `custom`: explicit custom domains, with a toggle to include the curated default allowlist.
  - `open`: unrestricted outbound access after startup completes.
- Use the existing curated default network policy during bootstrap, clone, toolchain setup, and startup script execution for all modes.
- Resolve the selected environment into an immutable runtime config snapshot at session creation and store that snapshot in Durable Object storage.
- Store only the selected environment reference and display name on the central `sessions` table.
- Exclude secret management from V1; secret access will be handled later through a proxy design that avoids writing raw secret values to disk.
- Exclude workspace path support from V1; startup scripts run at the repository root.

## Capabilities

### New Capabilities
- `repo-environments`: Repo-scoped session startup configuration, including startup script, plain env vars, and final Sprite network policy.

### Modified Capabilities

## Impact

- API server D1 schema gains a `repo_environments` table and lightweight environment reference columns on `sessions`.
- Session creation API accepts an optional repo environment id and validates it belongs to the selected repo.
- Session initialization RPC carries the resolved runtime config snapshot into the Durable Object.
- Durable Object storage gains a server-only runtime config snapshot repository.
- Session provisioning applies a bootstrap policy before setup and the selected final policy before agent start.
- Git setup may need to route both fetch and push through the git proxy for locked environments after initial clone.
- Web client session creation UI gains environment selection and repo environment management surfaces.
