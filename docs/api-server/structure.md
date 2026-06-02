# API Server Structure

The api-server is a Cloudflare Workers application using Hono for routing.

## File Map

- `services/api-server/src/index.ts` builds the Worker app and exports runtime bindings.
- `services/api-server/src/runtime/` contains Worker runtime entrypoints such as Durable Object classes.
- `services/api-server/src/composition/` wires route builders and root-level dependencies.
- `services/api-server/src/modules/` contains domain modules. Modules are for a single isolated feature like auth, sessions, or attachments.
- `services/api-server/src/shared/` contains API-server-only utilities, types, middleware, repositories, services, and integrations shared across modules.
- `services/api-server/scripts/` contains api-server-local maintenance and lint scripts.

## Module Structure

Modules follow a controller-service-repository shape:

1. `routes/` authenticates, parses input, handles transport errors, and returns HTTP responses.
2. `middleware/` contains route-local request middleware.
3. `services/` contains business logic.
4. `repositories/` contains data access.
5. `utils/` contains module-local helpers.
6. `types/` contains module-local types.

Example:

```text
src/modules/sessions/routes/sessions.routes.ts
  -> src/modules/sessions/services/sessions.service.ts
  -> src/modules/sessions/repositories/sessions.repository.ts
```

Keep route handlers thin. Put business logic in the owning module's `services/` directory unless it is Durable Object state-machine logic that belongs in `src/runtime/session-agent.do.ts` or the session-agent module services.

## Module Boundaries

`services/api-server/scripts/check-module-boundaries.ts` enforces these rules:

- Modules can import their own module, `src/shared`, and workspace packages.
- Modules **cannot import other modules directly.**
- `src/shared` cannot import modules.
- `src/runtime` and `src/composition` can import modules and shared code for root wiring.
- Same-module imports point downward: routes -> middleware -> services/providers -> repositories -> utils -> types.
- Files under `src/modules/<module>/` must be in a known layer. Do not add miscellaneous top-level module files.

When a module needs behavior from another module, prefer one of these shapes:

- Define an interface contract that the module needs for doing its work. E.g., GitProxyTokenProvider for the git proxy service. Inject the dependency from `src/composition` or `src/runtime`.
- If the code is truly shared and reusable across domains, move the shared contract or utility to `src/shared`.
- Keep the cross-module orchestration in root code instead of hiding it inside a module.

For the complete repo-wide boundary model, see `docs/ENGINEERING.md`.

## SessionAgentDO

`SessionAgentDO` lives at `services/api-server/src/runtime/session-agent.do.ts`. It is the session authority and owns:

- Durable Object SQLite-backed session state.
- Client WebSocket connections.
- VM lifecycle, provisioning, health checks, cleanup, and process dispatch.
- Webhook RPC handlers for vm-agent chunks and events.
- Root wiring for session-agent services that need dependencies from other modules.

Route modules should not import the `SessionAgentDO` class. Session-agent routes should depend on the shared `SessionAgentRpc` protocol and the Durable Object binding.

Session-agent Durable Object repositories live in `services/api-server/src/modules/session-agent/repositories/`. Session-agent business logic lives in `services/api-server/src/modules/session-agent/services/`.

For detailed turn flow, webhook ingestion, WAL recovery, and cancel behavior, see `docs/turn-workflow.md`.

## Routing

Routes live under `services/api-server/src/modules/*/routes/`. Each route group should keep OpenAPI/Zod schemas in a nearby `*.schema.ts` file and import those schemas into the route builder.

Auth-related routes are mounted together under `/auth` from the auth module. Provider-specific auth route files can live in their owning module when needed, but route mounting should stay centralized through composition rather than scattered in `src/index.ts`.

For auth flow details, see `docs/auth.md`. For GitHub App repo-access and git-proxy details, see `docs/github-app-auth.md`.

## Repositories

D1 repositories live inside the module that owns the data:

- `services/api-server/src/modules/sessions/repositories/` - session list and metadata.
- `services/api-server/src/modules/auth/repositories/` - user account and session persistence.
- `services/api-server/src/modules/ai-auth/repositories/` - provider OAuth credential state.
- `services/api-server/src/modules/github/repositories/` - GitHub App installation, access, and token cache state.
- `services/api-server/src/modules/repo-environments/repositories/` - per-user, per-repo environment presets for network policy, plain env vars, and startup scripts.

Durable Object SQLite repositories for session-agent state live in `services/api-server/src/modules/session-agent/repositories/`.
