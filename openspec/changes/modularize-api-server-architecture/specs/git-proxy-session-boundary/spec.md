## ADDED Requirements

### Requirement: Git proxy service is independent of session-agent internals
The reusable git proxy service SHALL live in the git module and MUST NOT import Durable Object runtime code, DO repositories, or session-agent-specific helpers.

#### Scenario: Git proxy needs session state
- **WHEN** git proxy behavior needs a secret, repo policy, pushed branch, or GitHub installation token
- **THEN** it reads those values through provider interfaces declared by the git module

#### Scenario: Git proxy module is linted
- **WHEN** the git module imports from `modules/session-agent/`
- **THEN** the import-boundary linter reports a violation

#### Scenario: Git proxy imports provider contracts
- **WHEN** `modules/git/git-proxy.service.ts` needs token, secret, or policy behavior
- **THEN** it imports provider interfaces from `./git.providers` or the same-module index and does not import GitHub, session-agent, or DO storage code

#### Scenario: Git proxy returns side effects as data
- **WHEN** a proxied push succeeds and the pushed branch is detected
- **THEN** the git proxy service returns the pushed branch in its result and does not mutate session-agent state directly

### Requirement: Session-agent adapts DO state to git proxy providers
The session-agent module SHALL own the DO-specific adapter that implements git proxy provider interfaces using DO state, DO SQLite secrets, and session callbacks.

#### Scenario: Session-agent services split Durable Object logic
- **WHEN** logic is stateful and mutates Durable Object scoped state
- **THEN** it lives as a service under `modules/session-agent/services/` and receives scoped DO dependencies instead of becoming a separate pure module

#### Scenario: Session-agent handles git proxy request
- **WHEN** the Durable Object receives a git proxy request
- **THEN** the session-agent git proxy service delegates reusable proxy behavior to the git module and applies DO-specific side effects after the git module returns

#### Scenario: Session-agent implements git providers directly
- **WHEN** session-agent wires the git proxy service
- **THEN** `SessionGitProxyService` implements the git module's public provider interfaces and imports those types from `@/modules/git`

#### Scenario: Git proxy construction avoids circular initialization
- **WHEN** `SessionAgentDO` is constructed
- **THEN** it constructs `SessionGitProxyService`, and `SessionGitProxyService` constructs its private `GitProxyService` after its DO dependencies are initialized

#### Scenario: Separate token provider is unnecessary
- **WHEN** the GitHub token provider behavior is only used by session-agent git proxy integration
- **THEN** it remains a method or private adapter inside `SessionGitProxyService` rather than a separate `SessionGitTokenProvider` class

#### Scenario: Pushed branch is detected
- **WHEN** the git proxy service returns a pushed branch from a successful push
- **THEN** the session-agent adapter updates DO/client state, persists session summary data, and broadcasts `branch.pushed`

### Requirement: Installation token persistence is standardized
GitHub installation tokens used by the git proxy SHALL be persisted through the GitHub module's D1 installation token cache, not through DO SQLite secrets.

#### Scenario: Cached token is valid
- **WHEN** the git proxy needs an installation token and the D1 token cache contains a token that remains valid beyond the refresh buffer
- **THEN** the git proxy path uses the cached token without requesting a new token from GitHub

#### Scenario: Cached token is missing or stale
- **WHEN** the git proxy needs an installation token and the D1 token cache has no valid token
- **THEN** the GitHub module refreshes the installation token from GitHub, writes it to the D1 token cache, and returns it to the session-agent adapter

#### Scenario: GitHub module remains independent of git provider contracts
- **WHEN** session-agent needs a GitHub installation token for git proxying
- **THEN** session-agent wraps the GitHub module's public token service as a `GitProxyTokenProvider`; the GitHub module does not need to import `modules/git`

#### Scenario: GitHub service factory is concrete module API
- **WHEN** session-agent wires GitHub token access
- **THEN** it imports a concrete GitHub service factory from `@/modules/github`, backed by a GitHub module service file such as `modules/github/services/github.service.ts`

#### Scenario: Session-agent stores session secrets
- **WHEN** the session-agent persists git proxy data in DO SQLite secrets
- **THEN** it persists only session-scoped secrets such as `git_proxy_secret` and does not persist GitHub installation tokens

### Requirement: Git proxy token errors remain explicit
The git proxy path SHALL convert expected GitHub token lookup, cache, and refresh failures into scoped result errors instead of hiding them behind generic runtime exceptions.

#### Scenario: GitHub token refresh fails
- **WHEN** GitHub installation token refresh fails for an expected integration reason
- **THEN** the git proxy request returns a typed failure response and logs structured fields without throwing for normal control flow
