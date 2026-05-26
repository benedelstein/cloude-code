## 1. Module Structure

- [x] 1.1 Create `services/api-server/src/modules/` and `services/api-server/src/shared/` with initial `index.ts` entrypoints for auth, sessions, attachments, repos, github, git, ai-auth, sprites, and session-agent.
- [x] 1.2 Move generic utilities, crypto helpers, local shared types, logging helpers, and config-style helpers into `shared/`, updating imports without behavior changes.
- [x] 1.3 Move auth, sessions, attachments, repos, github, ai-auth, and sprites routes/schemas/services/repositories into their owning modules with module-local relative imports.
- [x] 1.4 Move `SessionAgentDO`, DO-scoped services, DO helpers, and DO SQLite repositories into `modules/session-agent/`.
- [x] 1.5 Add initial module `index.ts` entrypoints during the first migration pass; later composition work narrows/removes value exports.
- [x] 1.6 Import scoped Hono routers directly from module route files in `services/api-server/src/index.ts`, without exporting routes from module `index.ts` files.
- [x] 1.7 Remove top-level API-server `src/routes/` as an organizing folder once module routes are mounted.

## 2. Provider Contracts And Middleware

- [x] 2.1 Remove `src/lib/providers/` as a top-level architecture folder by relocating each file into the owning module or `shared/`.
- [x] 2.2 Add module-local provider contract files only where a service needs injected runtime capabilities, starting with `modules/git/git.providers.ts` and `modules/auth/auth.providers.ts`.
- [x] 2.3 Make class-based provider implementations explicitly declare `implements <ProviderInterface>`; make object/closure factories return the provider interface type explicitly.
- [x] 2.4 Export externally implemented provider interfaces through the owning module `index.ts`; keep internal-only provider interfaces unexported.
- [x] 2.5 Refactor auth middleware into a `modules/auth` factory that accepts an auth/session provider and does not instantiate user-session services directly.
- [x] 2.6 Update module route composition to wire auth middleware through the factory while preserving current authenticated route behavior.

## 3. Git Proxy Boundary

- [x] 3.1 Move reusable git proxy request parsing, authentication, repo/branch policy checks, and GitHub forwarding into `modules/git/git-proxy.service.ts`.
- [x] 3.2 Keep DO-specific git proxy integration in `modules/session-agent/services/session-git-proxy.service.ts`, implementing the git module's provider interfaces directly.
- [x] 3.3 Remove imports from git proxy code to session-agent/DO repositories/helpers, including the current `ensureValidInstallationToken` dependency.
- [x] 3.4 Construct `GitProxyService` inside `SessionGitProxyService` after DO dependencies are initialized, avoiding a circular `GitProxyService <-> SessionGitProxyService` constructor dependency.
- [x] 3.5 Define the GitHub module's concrete service factory, such as `modules/github/services/github.service.ts#createGitHubService`, and export it from `modules/github/index.ts`.
- [x] 3.6 Use the GitHub module's public token service/cache from the session-agent adapter; do not make the GitHub module import git provider contracts unless a reusable adapter emerges.
- [x] 3.7 Standardize installation token persistence on the GitHub module's D1 installation token cache; keep only session-scoped secrets such as `git_proxy_secret` in DO SQLite secrets.
- [x] 3.8 Convert expected git proxy token/cache/refresh failures into scoped result errors with structured logging instead of normal-control-flow throws.

## 4. Import Boundary Linter

- [x] 4.1 Update `scripts/check-import-boundaries.ts` to classify `modules/<module>`, `shared`, and module public entrypoints.
- [x] 4.2 Add module-aware API-server classification that derives `moduleName`, `index.ts` entrypoint status, and private kind (`repository`, `provider`, `route`, `schema`, `service`, `other`) from the file path.
- [x] 4.3 Enforce same-module relative imports, repository privacy, composition-aware imports, and type-only provider/type imports.
- [x] 4.4 Enforce repository privacy across modules, `shared -> modules` prohibition, and no non-session-agent imports of session-agent internals.
- [x] 4.5 Add boundary checker self-checks for allowed composition/type imports, rejected runtime provider imports, same-module alias imports, and rejected route re-exports from module `index.ts`.
- [x] 4.6 Remove old layer rules for top-level API-server `routes/*`, `lib/providers`, `lib/*`, `repositories/*`, and `durable-objects/*` once callers have moved.

## 5. Tests And Validation

- [x] 5.1 Add or update unit tests for auth middleware factory behavior, including unauthorized, invalid-token, and successful-user cases.
- [x] 5.2 Add focused git proxy tests for valid D1 cached token use, stale/missing cache refresh, no installation token persistence to DO SQLite secrets, repo policy rejection, branch policy rejection, and successful pushed-branch side effects.
- [x] 5.3 Run `pnpm build`, `pnpm lint`, `pnpm typecheck`, and relevant API-server tests.
- [x] 5.4 Remove legacy-path compatibility re-exports or linter exceptions added during the first module migration.

## 6. Composition-Root Wiring Pivot

- [x] 6.1 Update the design/spec to define composition-owned runtime wiring, consumer-owned provider contracts, and no module value barrels as the target rule.
- [x] 6.2 Move GitHub webhook orchestration out of the GitHub module into the webhooks module, with webhooks-owned provider contracts.
- [x] 6.3 Add a webhook route factory and composition provider wiring for GitHub installation/session dependencies.
- [x] 6.4 Update the import-boundary checker to recognize `src/composition/` and type-only provider/type imports.
- [x] 6.5 Migrate remaining route modules that depend on other modules to route factories wired by `composition/build-routes.ts`.
- [x] 6.6 Remove remaining module value-barrel runtime exports/imports and keep cross-module runtime references on explicit files.
- [x] 6.7 Tighten the boundary checker so modules cannot runtime-import another module's `index.ts`; entrypoint route/runtime wiring goes through composition.
