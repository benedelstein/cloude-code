# API Server Map

File-by-file navigation for `services/api-server/src/`. Pair with `services/api-server/agents.md` for the controller → service → repository convention.

## Top level

| File | Purpose |
|---|---|
| `index.ts` | Hono app. Mounts all route groups, re-exports `SessionAgentDO` and `SessionTurnWorkflow` for wrangler bindings. |
| `types.ts` | The `Env` interface. Authoritative list of bindings + secrets. |

## Routes (`src/routes/`)

Route handlers validate input and delegate to services. Each group has a `schema.ts` (Zod / OpenAPI) and a `*.routes.ts`.

| Path | Mounts | What it handles |
|---|---|---|
| `/agents` | `agent.routes.ts` | WebSocket upgrade to the DO. |
| `/sessions` | `sessions/sessions.routes.ts` | Session CRUD, list, archive, messages. |
| `/repos` | `repos/repos.routes.ts` | List user's GitHub repos, installations. |
| `/attachments` | `attachments/attachments.routes.ts` | Upload/download R2-backed attachments. |
| `/auth` | `auth/auth.routes.ts` (GitHub), `auth/claude/`, `auth/openai/` | OAuth flows per provider. |
| `/models` | `models.routes.ts` | Enumerate available models per provider. |
| `/git-proxy` | `git-proxy.routes.ts` | Authenticated git proxy used by the VM for clone/push. |
| `/webhooks` | `webhooks.routes.ts` | GitHub App webhooks (installation, push, PR events). |
| `/_debug` | `debug.routes.ts` | Dev-only inspection endpoints. |

## Middleware (`src/middleware/`)

- `auth.middleware.ts` — Validates the session cookie (wrapped, AES-GCM) and refreshes GitHub user tokens when near expiry. See `docs/auth.md`.

## Durable Object (`src/durable-objects/`)

`SessionAgentDO` is the stateful coordinator for one session. It extends the Cloudflare Agents SDK `Agent` base class.

| File | Purpose |
|---|---|
| `session-agent-do.ts` | The DO class. WebSocket handlers, workflow RPCs, client state sync. Thin — logic lives in `lib/`. |
| `session-agent-derived-state.ts` | Recomputes `ClientState.status` etc. from `ServerState` checkpoints. |
| `session-agent-editor.ts` | VS Code editor proxy state. |
| `session-agent-github-token.ts` | Per-session installation token helpers. |
| `session-agent-history.ts` | Message history hydration for reconnects. |

### DO services (`durable-objects/lib/`)

Scoped helpers the DO composes. Keep new logic here rather than fattening `session-agent-do.ts`.

| File | Purpose |
|---|---|
| `AgentWorkflowCoordinator.ts` | Owns the live `MessageAccumulator`; dispatches turns to `SessionTurnWorkflow`; reconciles state after DO restart. Most turn-related RPC methods delegate here. |
| `SessionChatDispatchService.ts` | Creates the user message row, routes it into the coordinator, handles queued messages. |
| `SessionProvisionService.ts` | Spins up / attaches the Sprite VM, clones the repo, tracks provisioning status. |
| `SessionGitProxyService.ts` | Mints short-lived git-proxy tokens the VM uses for authenticated git ops. |
| `SessionProviderConnectionService.ts` | Computes `ProviderConnectionState` for the session's fixed provider. |
| `agent-attachment-service.ts` | Resolves R2 attachment refs into data URLs for the VM agent input. |

### DO repositories (`durable-objects/repositories/`)

DO-local SQLite (per-session). Pure CRUD.

- `message-repository.ts`, `pending-chunk-repository.ts`, `server-state-repository.ts`, `secret-repository.ts`, `latest-plan-repository.ts`, `schema-manager.ts`.

## Workflows (`src/workflows/`)

| File | Purpose |
|---|---|
| `SessionTurnWorkflow.ts` | Long-lived Cloudflare Workflow. Waits for `message_available` events; runs one turn per event inside `step.do("turn:...", retries: 0)`. |
| `AgentProcessRunner.ts` | Per-turn helper. Attaches to the Sprite, spawns `vm-agent`, pipes the user message, parses NDJSON, forwards chunks to the DO via RPC. |
| `types.ts` | Workflow param + failure code types. |

See `docs/turn-workflow.md` for the full sequence diagram.

## Lib (`src/lib/`)

Business logic. Services are instantiated per request (not global singletons) so they can take an `Env` / `D1Database`.

| Path | Owns |
|---|---|
| `sessions/sessions.service.ts` | Session CRUD, ACL checks, session list queries. |
| `attachments/` | R2 upload/download + GC queue drain. |
| `github/github-app.ts` | GitHub App installation tokens, user-to-server OAuth, installation + repo access cache. Large — touch carefully. |
| `providers/claude-oauth-service.ts` | Anthropic OAuth + token refresh for the "Claude Code" provider. |
| `providers/openai-codex-auth-service.ts` | OpenAI Codex OAuth (PKCE) + refresh. |
| `providers/provider-auth-service.ts` | Cross-provider wrapper that routes to the right implementation. |
| `providers/provider-credential-adapter.ts` | Reads encrypted per-user credentials and hands them to the DO/VM. |
| `providers/connection-status.ts` | Computes auth/reauth-required states. |
| `sprites/` | Thin wrapper over the Sprites API (`WorkersSpriteClient`, `SpriteWebsocketSession`, network policy). |
| `repos/` | GitHub repo queries. |
| `user-session/` | Server-side session cookie model. |
| `utils/`, `logger.ts`, `pkce.ts` | Shared helpers. |
| `git-proxy.ts`, `git-setup.ts` | VM-side git flow support. |
| `generate-pull-request-text.ts`, `generate-session-title.ts` | LLM-backed text generators. |
| `session-access-block.ts` | Enforces SessionAccessBlockReason revocations at runtime. |
| `session-provider-connection.ts`, `session-derived-state.ts` | Shared derivation helpers used by the DO. |
| `session-pull-request-service.ts` | Create/track PRs for a session. |
| `session-websocket-token.ts` | Signs short-lived HMAC tokens for WebSocket auth. |
| `create-user-message.ts` | Constructs a canonical user message row (text + attachments). |

## D1 Repositories (`src/repositories/`)

Global (cross-session) data access.

- `sessions.repository.ts`
- `user-repository.ts`, `user-session-repository.ts`
- `oauth-state-repository.ts`
- `user-provider-credential-repository.ts` — encrypted per-user Anthropic/OpenAI tokens
- `github-installation-repository.ts`, `github-user-repo-access-cache-repository.ts`, `installation-token-cache-repository.ts`
- `provider-auth-attempt-repository.ts`
- `claude-session-repository.ts`

## Migrations (`services/api-server/migrations/`)

Numbered SQL files applied by `pnpm db:migrate` (local) / `db:migrate:prod` (remote). Add the next sequential number; never edit applied migrations.

## Tests (`services/api-server/tests/`)

Vitest. Run via `pnpm --filter @repo/api-server test`. Heavier live scripts live in `services/api-server/scripts/`.
