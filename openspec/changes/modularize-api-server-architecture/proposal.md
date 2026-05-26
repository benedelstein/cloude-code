## Why

The API server mixes layer folders, domain folders, and a top-level `lib/providers/` bucket whose files are partly adapters, partly application services, and partly factories. This makes dependency direction unclear, especially around GitHub access, auth middleware, and the Durable Object git proxy path.

## What Changes

- Reorganize `services/api-server/src` around feature modules, with module-local routes, services, repositories, provider interfaces, and no runtime value barrels.
- Remove top-level route folders as an organizing pattern. Module route files export scoped Hono routers directly, and the worker entrypoint imports those route files directly instead of through module `index.ts` barrels.
- Replace the top-level `lib/providers/` architecture with module-owned provider interfaces that are implemented explicitly by caller-owned adapters or concrete services.
- Update the custom import-boundary linter so modules cannot runtime-import module barrels, routes, repositories, or provider contracts as values.
- Treat the session Durable Object as a `session-agent` module with its own runtime, services, and DO SQLite repositories.
- Move reusable git proxy behavior into a `git` module and keep DO-specific state/token/broadcast integration inside the `session-agent` module.
- Standardize GitHub installation token ownership for the git proxy path so token validity and caching are handled in one place.
- Refactor auth middleware into a provider-driven middleware factory instead of directly constructing user-session services inside middleware.

## Capabilities

### New Capabilities
- `api-server-module-architecture`: Defines module-based API-server organization, module public API rules, provider-interface ownership, shared utilities, and import-boundary lint behavior.
- `git-proxy-session-boundary`: Defines the reusable git proxy service boundary, session-agent DO adapter responsibilities, and GitHub installation token storage/caching behavior.

### Modified Capabilities

None.

## Impact

- Affects `services/api-server/src` folder organization, import aliases, and custom boundary lint rules.
- Moves or renames API-server source files across routes, services, repositories, middleware, shared utilities, and Durable Object runtime code.
- Requires compatibility-preserving re-exports or coordinated import updates for existing API-server tests and route registration.
- Does not change external HTTP/WebSocket API contracts or persisted database schemas unless implementation discovers unavoidable migration details.
