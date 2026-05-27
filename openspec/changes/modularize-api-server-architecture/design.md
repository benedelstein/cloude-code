## Context

`services/api-server` currently uses `routes/`, `lib/`, `repositories/`, `middleware/`, and `durable-objects/` as top-level layer folders. That started as controller-service-repository, but `lib/providers/` has become a mixed bucket for concrete external adapters, application services, factories, and narrow provider contracts. The git proxy path shows the resulting boundary problem: reusable proxy behavior in `lib/github/git-proxy.ts` imports DO-specific token refresh and DO SQLite secret storage, while the DO wrapper also owns session state and branch broadcasts.

The target architecture is module-first inside the deployed API server: each module owns its routes, schemas, services, repositories, and the provider interfaces its own services consume. Cross-module runtime wiring belongs in `src/composition/`, not in module internals or broad value barrels. Route files expose factories that receive their cross-module dependencies from composition while remaining free to construct same-module services internally. `shared/` holds only cross-module primitives/utilities. The Durable Object becomes a `session-agent` module because it is a Cloudflare runtime boundary with its own storage and lifecycle, not a normal sessions service.

## Goals / Non-Goals

**Goals:**
- Introduce `src/modules/<module>/` as the API-server application architecture.
- Move routes and route schemas into their owning modules.
- Remove the top-level `src/lib/providers/` folder as an organizing pattern.
- Keep controller-service-repository separation inside modules.
- Move cross-module runtime wiring into `src/composition/`.
- Avoid module value barrels that hide runtime imports and cycles.
- Make route modules factory-based where they need cross-module dependencies.
- Make provider interfaces consumer-owned and explicitly implemented by adapters/concrete classes.
- Decouple reusable git proxy behavior from session-agent/DO internals.
- Standardize GitHub installation token caching for the git proxy path.
- Update `scripts/check-import-boundaries.ts` to enforce module boundaries.

**Non-Goals:**
- No external API, WebSocket, webhook, or database schema changes.
- No frontend or vm-agent package restructuring.
- No full rewrite of business logic; this is a move/refactor plus targeted boundary cleanup.
- No introduction of a DI container.

## Decisions

### 1. Use modules as the primary folder axis

Create `services/api-server/src/modules/` and move API-server application areas into modules. Route handlers and schemas live under the owning module, such as `modules/auth/routes/auth.routes.ts` and `modules/auth/routes/auth.schema.ts`. Route files are imported directly by `services/api-server/src/index.ts`; module `index.ts` files are reserved for service/capability exports and must not re-export routes.

- `auth`: auth routes/schemas, auth middleware factory, user session/auth services, user/session/provider-auth repositories.
- `sessions`: session routes/schemas, session service, session summary/list metadata repository, session access helpers.
- `attachments`: attachment routes/schemas, attachment service, attachment GC service, attachment provider interfaces.
- `repos`: repo routes/schemas, repo picker/list/search service, and related helpers.
- `github`: GitHub app/service logic, webhook handling, repo access, pull request integration, GitHub repositories.
- `git`: reusable git proxy service and provider contracts.
- `ai-auth`: Claude/OpenAI auth services and provider credential logic.
- `sprites`: Sprite client/service code and network policy helpers.
- `session-agent`: `SessionAgentDO`, DO-scoped services, and DO SQLite repositories.

Use `services/api-server/src/shared/` for utilities and shared primitives: logging, crypto, generic utils, shared local types, and config helpers.

Alternative considered: keep layer folders and group repositories by domain. This preserves less movement, but it keeps the mixed `lib`/`providers` ambiguity and does not solve the DO/git-proxy dependency direction cleanly.

### 2. Put cross-module wiring in composition, not value barrels

Files inside a module use relative imports for same-module code. Module internals must not runtime-import another module's `index.ts` barrel, repositories, routes, provider files as values, or broad value exports. If a module needs a capability owned elsewhere and direct import would create a cycle, it defines a narrow local provider interface, consumes that interface, and lets `src/composition/` adapt concrete services into that provider.

Composition is the one API-server area allowed to know about multiple modules at runtime. It can import module route factories, module services, and provider contracts, then wire them into the deployed app. If composition cannot order construction without a cycle, that is a design signal to split a broad service by capability.

Module `index.ts` files should not be value barrels. Prefer no `index.ts`, `export {}`, or type-only exports for stable module-owned types. Runtime imports should use explicit files so the import graph remains visible, and route/runtime composition should live under `src/composition/`.

Route files are module-owned but should expose factories when they need cross-module dependencies. A route factory may construct same-module services internally; cross-module services/providers are passed in by composition.

Alternative considered: keep public service/capability barrels and require all cross-module imports to use `@/modules/<module>`. That is ergonomic, but barrels are real runtime modules. In this codebase they made cycles harder to see, such as `auth -> github -> sessions -> auth`.

#### Import examples

Within a module, use relative imports and keep repositories private:

```typescript
// services/api-server/src/modules/sessions/services/sessions.service.ts
import { SessionsRepository } from "../repositories/sessions.repository";
import type { RepoAccessProvider } from "../providers/repo-access.provider";
```

When a module needs an outside capability, own the consumer contract locally:

```typescript
// services/api-server/src/modules/sessions/providers/repo-access.provider.ts
export interface RepoAccessProvider {
  checkAccess(input: { userId: string; repoId: string }): Promise<boolean>;
}
```

Then wire the implementation in composition:

```typescript
// services/api-server/src/composition/providers/create-repo-access-provider.ts
import type { RepoAccessProvider } from "@/modules/sessions/providers/repo-access.provider";
import type { GitHubAccessService } from "@/modules/github/services/github-access.service";

export function createRepoAccessProvider(
  githubAccess: GitHubAccessService,
): RepoAccessProvider {
  return {
    checkAccess: (input) => githubAccess.checkAccess(input),
  };
}
```

Routes receive cross-module dependencies through a factory:

```typescript
// services/api-server/src/modules/webhooks/routes/webhooks.routes.ts
export function createWebhooksRoutes(deps: WebhooksRouteDeps) {
  const routes = new Hono<{ Bindings: Env }>();

  routes.post("/github", async (c) => {
    const handler = deps.createGitHubWebhookHandler({
      env: c.env,
      logger: createLogger("webhooks.routes.ts"),
    });

    return handler.handle(c.req.raw);
  });

  return routes;
}
```

The composition root imports explicit files and performs the wiring:

```typescript
// services/api-server/src/composition/build-routes.ts
import { createWebhooksRoutes } from "@/modules/webhooks/routes/webhooks.routes";
import { createGitHubWebhookHandler } from "./providers/create-github-webhook-handler";

export function buildWebhooksRoutes() {
  return createWebhooksRoutes({ createGitHubWebhookHandler });
}
```

Do not runtime-import another module's barrel, route, repository, or provider contract as a value:

```typescript
// Bad outside modules/github/*
import { GitHubProvider } from "@/modules/github";
import { GitHubInstallationRepository } from "@/modules/github/repositories/github-installation-repository";
import { GitHubWebhookInstallationProvider } from "@/modules/webhooks/providers/github-webhook.providers";
```

### 3. Provider interfaces live with the consuming module

Provider interfaces are module-local contracts such as `git.providers.ts`, `auth.providers.ts`, or files under `providers/`. Concrete implementations must explicitly declare `implements <ProviderInterface>` where they are class-based. For function/object providers, factory functions must return the provider interface type explicitly.

This makes the consumer own what it needs while avoiding a global `providers/` folder. TypeScript remains structurally typed, so the enforcement is by explicit annotations and linter-visible import direction rather than nominal type identity.

Provider interfaces may be imported by composition as type-only imports from explicit provider files. They should not be re-exported through value barrels, and module internals should not import another module's providers.

Use providers when:

- a module needs only a narrow capability, not another module's whole public service;
- a runtime boundary must adapt local state, such as `session-agent` adapting Durable Object state to `git`;
- direct imports would create a dependency cycle;
- tests need a small fake without constructing real integration services.

Do not use providers when:

- code is same-module, where relative service imports are clearer;
- the provider would simply mirror an entire service API;
- the goal is only to hide a repository import. Repositories stay private; expose behavior through a module service instead.

Class implementation:

```typescript
// services/api-server/src/modules/session-agent/services/session-git-proxy.service.ts
import {
  GitProxyService,
  type GitProxyPolicyProvider,
  type GitProxySecretProvider,
  type GitProxyTokenProvider,
} from "@/modules/git";

export class SessionGitProxyService
  implements GitProxySecretProvider, GitProxyPolicyProvider, GitProxyTokenProvider {
  private readonly gitProxy: GitProxyService;

  constructor(private readonly deps: SessionGitProxyServiceDeps) {
    this.gitProxy = new GitProxyService({
      secretProvider: this,
      policyProvider: this,
      tokenProvider: this,
    });
  }

  async getGitProxySecret(): Promise<string | null> {
    return this.deps.secretRepository.get("git_proxy_secret");
  }
}
```

Object/closure implementation, when a route needs to wire a narrow provider:

```typescript
import type { AuthSessionProvider } from "@/modules/auth";

function createRouteAuthSessionProvider(): AuthSessionProvider {
  const userSessions = createUserSessionService();

  return {
    requireUserSession: (request) => userSessions.requireUserSession(request),
  };
}
```

### 4. Model the Durable Object as `modules/session-agent`

`session-agent` owns:

- the Durable Object class and Worker-exported runtime entrypoint;
- DO SQLite repositories;
- DO-scoped services for provisioning, dispatch, provider connection state, git proxy integration, summaries, and process management;
- adapters that implement provider interfaces required by other modules using DO state.

The services under `session-agent/services/` are not separate modules. They exist to keep `SessionAgentDO` from becoming a giant file while still sharing one stateful Durable Object scope. They can receive callbacks/getters/setters for DO-local state, repositories, and broadcast functions, and they mutate that scoped state on behalf of the DO. Other modules must not import session-agent internals. `session-agent` may import public APIs from other modules.

Alternative considered: place the DO under `sessions`. That hides the Cloudflare runtime boundary and would make session metadata/business services depend on DO lifecycle concerns.

### 5. Split git proxy behavior from session-agent integration

Move reusable proxy policy/forwarding into `modules/git/git-proxy.service.ts`. It owns:

- proxy bearer authentication against a provided secret;
- parsing `/git-proxy/<sessionId>/github.com/<repo>.git/...`;
- repo and branch policy checks;
- forwarding clone/fetch/push requests to GitHub using an installation token;
- returning side effects as data, such as refreshed token and pushed branch.

`modules/git/git.providers.ts` defines the required contracts, such as token access, secret access, and session/repo policy. `modules/session-agent/services/session-git-proxy.service.ts` implements those contracts directly, wires a `GitProxyService` internally, and applies DO-specific side effects.

The GitHub token dependency is a normal GitHub module service, not a git provider implemented by the GitHub module. The GitHub module owns GitHub API mechanics and token cache behavior; `session-agent` adapts that public service to the `GitProxyTokenProvider` interface because the git module owns the consumer contract.

The git proxy wiring should look like this:

```typescript
// modules/git/git.providers.ts
export interface GitProxyProviders {
  secretProvider: GitProxySecretProvider;
  policyProvider: GitProxyPolicyProvider;
  tokenProvider: GitProxyTokenProvider;
}

export interface GitProxySecretProvider {
  getGitProxySecret(): Promise<string | null>;
}

export interface GitProxyPolicyProvider {
  getGitProxyPolicy(): Promise<Result<{
    sessionId: string;
    repoFullName: string;
    pushedBranch: string | null;
  }, GitProxyPolicyError>>;
}

export interface GitProxyTokenProvider {
  getInstallationToken(input: {
    repoFullName: string;
  }): Promise<Result<{ token: string }, GitProxyTokenError>>;
}
```

```typescript
// modules/git/git-proxy.service.ts
export class GitProxyService {
  constructor(private readonly providers: GitProxyProviders) {}

  async handle(request: Request): Promise<GitProxyResult> {
    const secret = await this.providers.secretProvider.getGitProxySecret();
    const policyResult = await this.providers.policyProvider.getGitProxyPolicy();
    if (!policyResult.ok) {
      return gitProxyFailureResponse(policyResult.error);
    }

    const policy = policyResult.value;
    const tokenResult = await this.providers.tokenProvider.getInstallationToken({
      repoFullName: policy.repoFullName,
    });

    // Authenticate proxy secret, parse Git path, enforce repo/branch policy,
    // forward to GitHub, and return side effects as data.
    return {
      response,
      pushedBranch,
    };
  }
}
```

```typescript
// modules/session-agent/services/session-git-proxy.service.ts
import {
  GitProxyService,
  type GitProxyPolicyProvider,
  type GitProxySecretProvider,
  type GitProxyTokenProvider,
} from "@/modules/git";

export class SessionGitProxyService
  implements GitProxySecretProvider, GitProxyPolicyProvider, GitProxyTokenProvider {
  private readonly gitProxy: GitProxyService;

  constructor(private readonly deps: SessionGitProxyServiceDeps) {
    // Safe because GitProxyService stores providers and does not call them
    // from its constructor.
    this.gitProxy = new GitProxyService({
      secretProvider: this,
      policyProvider: this,
      tokenProvider: this,
    });
  }

  ensureGitProxySecret(): string {
    // DO-specific generation and persistence of only git_proxy_secret.
  }

  async getGitProxyPolicy() {
    const access = await this.deps.assertSessionRepoAccess();
    if (!access.ok) {
      return failure(access.error);
    }

    return success({
      sessionId: this.deps.getServerState().sessionId,
      repoFullName: this.deps.getClientState().repoFullName,
      pushedBranch: this.deps.getClientState().pushedBranch,
    });
  }

  async getInstallationToken(input: { repoFullName: string }) {
    // Wrap the GitHub module's public token service/cache. The GitHub module
    // does not need to import git provider types.
    return this.deps.github.getInstallationTokenForRepo(input.repoFullName);
  }

  async handleRequest(request: Request): Promise<Response> {
    const result = await this.gitProxy.handle(request);

    if (result.pushedBranch) {
      this.deps.updatePushedBranch(result.pushedBranch);
      this.deps.broadcastBranchPushed(result.pushedBranch);
    }

    return result.response;
  }
}
```

`SessionAgentDO` should construct only the session-agent service, not a separate `GitProxyService` and not a separate `SessionGitTokenProvider` unless that provider becomes independently reusable:

```typescript
// modules/session-agent/session-agent.do.ts
import { createGitHubService } from "@/modules/github";

this.sessionGitProxyService = new SessionGitProxyService({
  secretRepository,
  github: createGitHubService({ env, logger }),
  getServerState: () => this.serverState,
  getClientState: () => this.clientState,
  assertSessionRepoAccess: () => this.assertSessionRepoAccess(),
  updatePushedBranch: (branch) => this.updatePushedBranch(branch),
  broadcastBranchPushed: (branch) => this.broadcastBranchPushed(branch),
});

this.sessionProvisionService = new SessionProvisionService({
  ensureGitProxySecret: () => this.sessionGitProxyService.ensureGitProxySecret(),
});
```

`createGitHubService` is defined by the GitHub module and exported through its `index.ts`:

```typescript
// modules/github/services/github.service.ts
export function createGitHubService(deps: GitHubServiceDeps): GitHubService {
  return new GitHubService(deps);
}

// modules/github/index.ts
export { createGitHubService } from "./services/github.service";
export type { GitHubService } from "./services/github.service";
```

This avoids the circular construction problem. The Durable Object creates `SessionGitProxyService`; `SessionGitProxyService` implements the git module's provider interfaces and owns its private `GitProxyService`; the git module never imports `session-agent`.

### 6. Standardize GitHub installation token ownership

The git proxy path should use the existing D1 installation token cache as the authoritative persisted token cache. The session-agent may keep an in-memory token mirror for the lifetime of a DO instance, but it must not persist installation tokens in DO SQLite secrets. DO SQLite secrets remain for session-scoped secrets such as `git_proxy_secret`.

Token validation should flow through the GitHub module service/cache path before refreshing from GitHub. If the D1 cache has a non-expiring token, use it. If not, refresh through the GitHub App service, write the cache, and update the session-agent in-memory mirror.

### 7. Auth middleware becomes a provider-driven factory

Move auth middleware into `modules/auth` and expose a factory that accepts an `AuthSessionProvider`. Module route files or small module-local route wiring helpers wire the factory to the concrete auth/user-session service. Middleware must not construct `UserSessionService` directly.

### 8. Update the custom import-boundary linter for modules and composition

`scripts/check-import-boundaries.ts` should grow API-server module-aware classification instead of relying only on fixed top-level layer prefixes. The checker should derive module identity from paths under `services/api-server/src/modules/<module>/` and recognize `services/api-server/src/composition/` as the only runtime cross-module wiring area.

Expected classification:

```typescript
type ApiServerLayer =
  | { kind: "api-shared" }
  | { kind: "api-entry" }
  | { kind: "api-composition" }
  | { kind: "api-module-entry"; moduleName: string }
  | { kind: "api-module-internal"; moduleName: string; privateKind: "repository" | "provider" | "route" | "service" | "schema" | "types" | "other" };

function classifyApiServerPath(repoPath: string): ApiServerLayer | null {
  if (repoPath.startsWith("services/api-server/src/shared/")) {
    return { kind: "api-shared" };
  }

  if (repoPath.startsWith("services/api-server/src/composition/")) {
    return { kind: "api-composition" };
  }

  const moduleMatch = repoPath.match(
    /^services\/api-server\/src\/modules\/([^/]+)\/(.+)$/,
  );
  if (moduleMatch) {
    const [, moduleName, rest] = moduleMatch;
    if (rest === "index.ts") {
      return { kind: "api-module-entry", moduleName };
    }
    return {
      kind: "api-module-internal",
      moduleName,
      privateKind: classifyModulePrivateKind(rest),
    };
  }

  return null;
}
```

Expected module import rule:

```typescript
function isAllowedApiServerModuleImport(edge, source, target): boolean {
  if (source.kind === "api-shared") {
    return target.kind === "api-shared";
  }

  if (source.kind === "api-composition") {
    return target.kind === "api-shared" || target.kind.startsWith("api-module");
  }

  if (isSameModule(source, target)) {
    return true;
  }

  if (edge.kind === "import type" && isProviderOrType(target)) {
    return true;
  }

  if (target.kind === "api-module-internal") {
    return false;
  }

  return legacyOrPackageRuleAllows(edge, source, target);
}
```

The linter should fail all of these:

```typescript
import { createSessionsRepository } from "@/modules/sessions/sessions.repository";
import { GitHubProvider } from "@/modules/github";
import { SessionGitProxyService } from "@/modules/session-agent/services/session-git-proxy.service";
// In modules/auth/index.ts:
export { authRoutes } from "./routes/auth.routes";
```

The linter should allow these:

```typescript
// In composition only:
import { createSessionService } from "@/modules/sessions/services/sessions.service";
import { GitProxyService } from "@/modules/git/services/git-proxy.service";
import type { GitProxyTokenProvider } from "@/modules/git/git.providers";
import { createLogger } from "@/shared/logging";
// In a module, type-only consumer contracts are allowed:
import type { AuthUser } from "@/modules/auth/auth.types";
```

During migration, narrow exceptions may be kept only when they are recorded as tasks. The completed change should remove old layer rules for top-level `routes/*`, `lib/providers`, `lib/*`, `repositories/*`, and `durable-objects/*`, and should fail new cross-module runtime imports outside `composition/`.

## Risks / Trade-offs

- Large move-only diff may obscure behavior changes -> stage the migration by module and keep behavior changes limited to git proxy token cleanup and middleware construction.
- Import-boundary rules may initially need many layer ids -> implement broad module detection first, then tighten repository/private-entry rules once moves compile.
- Existing tests and aliases may deep-import old paths -> provide temporary re-export shims only where needed, then remove them before completing the change.
- Token storage cleanup could alter session-agent behavior -> add focused tests for cached-token use, refresh path, and no DO secret persistence for installation tokens.

## Migration Plan

1. Add module/shared folder structure and update TypeScript path assumptions only as needed.
2. Move shared utilities/logging/types into `shared/` with import updates.
3. Move auth/session/repo/github/git/attachment/ai-auth/sprites routes, schemas, services, and repositories into modules, preserving behavior.
4. Move Durable Object runtime and DO repositories into `modules/session-agent`.
5. Refactor git proxy into `modules/git` plus `session-agent` adapter and remove DO imports from git proxy service.
6. Refactor auth middleware into a provider-driven factory.
7. Update the worker entrypoint to mount scoped routers built by `composition/build-routes.ts`.
8. Update `scripts/check-import-boundaries.ts` to enforce composition-owned runtime wiring, type-only provider/type imports, no module value-barrel imports, and no `shared -> modules`.
9. Run build, lint, typecheck, and relevant tests; remove temporary re-export shims once callers are updated.
