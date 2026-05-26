## ADDED Requirements

### Requirement: API server code is organized into feature modules
The API server SHALL organize application code under `services/api-server/src/modules/<module>/`, where each module owns its routes, schemas, services, repositories, and provider contracts for one application capability or runtime boundary.

#### Scenario: Module contains its own layer files
- **WHEN** a module owns routes, schemas, services, or repositories for a capability
- **THEN** those files live under that module rather than under top-level `routes/`, `lib/`, or `repositories/` layer folders

#### Scenario: Module owns scoped routes
- **WHEN** a module has HTTP routes
- **THEN** its route file lives under `modules/<module>/routes/` and is not exported from the module `index.ts`

#### Scenario: Worker entrypoint mounts composed routes
- **WHEN** `services/api-server/src/index.ts` registers HTTP routes that need cross-module wiring
- **THEN** it mounts routers returned by `services/api-server/src/composition/`

#### Scenario: Durable Object is a module
- **WHEN** code belongs to the session Durable Object runtime, DO SQLite storage, or DO-scoped service lifecycle
- **THEN** it lives under `modules/session-agent/`

### Requirement: Cross-module runtime barrels are forbidden
The system SHALL forbid runtime imports from module `index.ts` barrels. Cross-module wiring that combines routes or broad runtime capabilities SHALL live under `services/api-server/src/composition/`.

#### Scenario: Service needs another module capability
- **WHEN** a service in one module needs behavior from another module
- **THEN** it imports an explicit public service/helper file or depends on a provider interface owned by the consuming module when the dependency would otherwise create a cycle

#### Scenario: Composition wires services
- **WHEN** a provider interface needs a concrete implementation
- **THEN** composition imports the concrete service and adapts it into the consuming module's provider interface

#### Scenario: Module value barrel is added
- **WHEN** a module `index.ts` exports runtime services, routes, repositories, or composition glue
- **THEN** the import-boundary linter reports a violation

#### Scenario: Module imports another module barrel
- **WHEN** a module runtime-imports `@/modules/<other-module>`
- **THEN** the import-boundary linter reports a violation and the caller must use an explicit file or composition wiring

#### Scenario: Provider type is implemented by composition
- **WHEN** composition implements a module-owned provider interface
- **THEN** it imports the provider contract as a type-only import from the consuming module's provider file

#### Scenario: Repository remains private
- **WHEN** a module needs data owned by another module
- **THEN** composition adapts that module's service capability and no module imports another module's repository directly

### Requirement: Routes are factory-wired when they need external capabilities
Module routes SHALL expose route factories when they require cross-module dependencies. The factory receives those dependencies from composition.

#### Scenario: Webhook route needs GitHub webhook handling
- **WHEN** the webhooks route receives a GitHub webhook request
- **THEN** the route obtains a handler from an injected factory rather than importing GitHub/auth/sessions services directly

#### Scenario: Route only needs same-module behavior
- **WHEN** a route can construct only same-module services and shared utilities
- **THEN** it MAY remain a module-local router export until it is migrated to composition

### Requirement: Module provider contracts are consumer-owned
Provider contracts SHALL live in the consuming module and describe the specific external/runtime capabilities needed by that module.

#### Scenario: Concrete class implements provider contract
- **WHEN** a class is used as a concrete provider for another module's contract
- **THEN** it explicitly declares `implements <ProviderInterface>`

#### Scenario: Factory wires object provider
- **WHEN** wiring uses an object or closure provider instead of a class
- **THEN** the factory return value is explicitly typed as the target provider interface

#### Scenario: Provider is not needed for normal service collaboration
- **WHEN** code needs same-module behavior
- **THEN** it imports that same-module service relatively instead of creating a provider interface that mirrors that service

#### Scenario: Provider interface is externally implemented
- **WHEN** a provider interface must be implemented outside the consuming module
- **THEN** composition imports that interface as a type-only dependency from the consuming module's provider file

#### Scenario: Provider interface is internal only
- **WHEN** a provider interface is used only inside its owning module
- **THEN** the interface remains unexported from that module's `index.ts`

### Requirement: Shared code is module-independent
The API server SHALL place cross-module primitives and utilities in `services/api-server/src/shared/`, and shared code MUST NOT import from `modules/`.

#### Scenario: Shared utility used by modules
- **WHEN** multiple modules need logging, crypto, config, generic utilities, or local shared types
- **THEN** those helpers are imported from `shared/`

#### Scenario: Shared code attempts to import module logic
- **WHEN** a file under `shared/` imports from `modules/`
- **THEN** the import-boundary linter reports a violation

### Requirement: Auth middleware is provider-driven
Auth middleware SHALL be constructed through a factory that accepts an auth/session provider instead of directly constructing auth services inside middleware.

#### Scenario: Module route installs auth middleware
- **WHEN** a module route needs authenticated user context
- **THEN** it uses the auth middleware factory with concrete dependencies passed through composition or same-module route construction

#### Scenario: Middleware avoids direct service construction
- **WHEN** the auth middleware validates a bearer token
- **THEN** it calls the injected provider and does not instantiate the user-session service directly

### Requirement: Import boundary lint enforces module architecture
The custom import-boundary linter SHALL classify API-server modules and enforce composition-owned runtime wiring, repository privacy, shared independence, type-only provider/type imports, and route export rules.

#### Scenario: Composition imports concrete module services
- **WHEN** a file under `services/api-server/src/composition/` imports module services, routes, provider types, or shared helpers
- **THEN** lint allows the import

#### Scenario: Module runtime barrel import is added
- **WHEN** a module file runtime-imports another module's `index.ts` barrel
- **THEN** lint fails and the dependency must use an explicit file import or be passed through composition

#### Scenario: Provider type import is added
- **WHEN** composition imports a module-owned provider interface from `@/modules/<module>/providers/<file>` or `@/modules/<module>/<file>.providers`
- **THEN** lint allows the import only when it is type-only

#### Scenario: Worker entrypoint imports composition route builder
- **WHEN** `services/api-server/src/index.ts` needs a route group with cross-module wiring
- **THEN** it imports a builder from `@/composition/<file>`

#### Scenario: Module entrypoint exports a route
- **WHEN** `modules/auth/index.ts` re-exports `./routes/auth.routes`
- **THEN** lint fails because module public entrypoints must not export scoped routes

#### Scenario: Module route deep import is added
- **WHEN** a module file outside `modules/auth/` imports `@/modules/auth/routes/auth.routes`
- **THEN** lint fails unless the importing file is under `composition/`

#### Scenario: Session-agent internals are imported by another module
- **WHEN** a non-session-agent module imports from `modules/session-agent/` internals
- **THEN** lint fails

#### Scenario: Shared code imports a module
- **WHEN** code under `services/api-server/src/shared/` imports from `services/api-server/src/modules/`
- **THEN** lint fails
