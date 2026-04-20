# Onboarding (For Agents)

Fast map of the codebase for an agent that has never worked in it. Read this, `AGENTS.md`, and the `docs/` files below before diving in.

## 1. Mental model in 60 seconds

Client (Next.js) ↔ `api-server` (Cloudflare Worker) ↔ `SessionAgentDO` (durable per-session) ↔ `SessionTurnWorkflow` (durable long-lived) ↔ Sprite VM running `vm-agent` (Bun) ↔ model provider (Claude / OpenAI).

- The **DO** is the source of truth: it owns SQLite (messages, chunks, server state) and WebSockets.
- The **Workflow** is a long-lived, crash-resilient process that talks to the VM and streams chunks back to the DO via RPC.
- The **vm-agent** wraps the AI SDK `streamText` loop. It reads `AgentInput` NDJSON from stdin and writes `AgentOutput` NDJSON to stdout.
- Shared types (`@repo/shared`) are the single source of truth for all wire formats. Never duplicate them per package.

For the full turn-by-turn flow see `docs/turn-workflow.md`. For session state transitions see `docs/session-lifecycle.md`. For agent protocol details see `docs/vm-agent.md`. For a file-by-file map of the api-server see `docs/api-server-map.md`.

## 2. Repo layout

```
apps/web/                  Next.js client
packages/shared/           Zod schemas + shared types (single source of truth)
packages/vm-agent/         Bun process that runs on the sprite VM
services/api-server/       Cloudflare Worker (Hono + DO + Workflow)
docs/                      This folder. Plans live in docs/plans/
scripts/                   Live test scripts + the cloudflared webhook tunnel
```

## 3. Cold-start checklist

Run these once after cloning:

```bash
pnpm install                                  # uses corepack pnpm; do NOT install globally
cp services/api-server/.env.example services/api-server/.dev.vars
cp apps/web/.env.example apps/web/.env.local
# fill in the values — see "Secrets" below
pnpm --filter @repo/api-server db:migrate     # apply D1 migrations locally
pnpm build                                    # turbo build everything once
```

Then iterate:

```bash
pnpm dev:local     # web + api + cloudflared tunnel in one TUI
# or
pnpm dev:api       # just the api-server
pnpm dev:web       # just the web
```

`dev:local` is the normal flow — Sprites VMs need to reach your laptop, so the cloudflared tunnel is required (see `docs/webhook-tunnel.md`). Set `WORKER_URL` in `.dev.vars` to the tunnel URL.

## 4. Validating a change

Always run before finishing:

```bash
pnpm typecheck
pnpm lint
pnpm build
pnpm test
```

`pnpm run:ci` bundles lint + typecheck + test.

For visual changes on the web app, use the `/screenshot` skill against a localhost URL.

## 5. Where to put new code (decision tree)

| You want to... | Put it here |
|---|---|
| Add a shared type or Zod schema | `packages/shared/src/types/` |
| Add a utility used by multiple packages | `packages/shared/src/utils/` |
| Add an HTTP route | `services/api-server/src/routes/<domain>/` with a `schema.ts` |
| Add business logic behind a route | `services/api-server/src/lib/<domain>/<name>.service.ts` |
| Add D1 data access | `services/api-server/src/repositories/` |
| Add DO-internal data access (SQLite) | `services/api-server/src/durable-objects/repositories/` |
| Extend the DO's behavior (but keep it thin) | A new service in `services/api-server/src/durable-objects/lib/` |
| Add a workflow step | `services/api-server/src/workflows/` |
| Add an agent provider (Claude, OpenAI, ...) | `packages/vm-agent/src/providers/` + register in `packages/vm-agent/src/index.ts` |
| Add an env var / secret | `services/api-server/src/types.ts` (Env) + `wrangler.jsonc` comment + `.env.example` |
| Add a DB migration | `services/api-server/migrations/` (next sequential number) |
| Add a React page | `apps/web/app/(app)/...` |
| Add a React hook | `apps/web/hooks/` |
| Write a doc | `docs/<topic>.md`. If it's a feature plan, `docs/plans/<name>.md` from `TEMPLATE.md` |

## 6. Conventions worth knowing (not obvious from reading code)

- **`Result<T, E>`**: preferred over throwing for expected failures. See `packages/shared/src/types/errors.ts`. Throw only for bugs / invariant violations.
- **Controller → Service → Repository**: enforced in `api-server`. Route handlers validate + forward; services own logic; repositories own CRUD. See `services/api-server/agents.md`.
- **Exhaustive switches**: use `const _exhaustiveCheck: never = value` in the default case (enforced by TS). Pattern is in `AGENTS.md`.
- **GitHub IDs over names**: numeric repo/installation IDs are stable; `owner/repo` strings are not.
- **No duplicated types across packages**: if two packages need a type, it goes in `@repo/shared`.
- **Provider settings**: user-picked provider + model is an `AgentSettings` discriminated union in `packages/shared/src/types/providers/`. The DO serializes it and passes it to `vm-agent` via the `--provider` CLI flag.

## 7. Secrets (api-server)

Set locally via `services/api-server/.dev.vars` (git-ignored), in prod via `wrangler secret put`:

| Secret | Purpose |
|---|---|
| `ANTHROPIC_API_KEY` | Default Claude API key when user has no OAuth token |
| `SPRITES_API_KEY` | Auth to fly.io Sprites API |
| `GITHUB_APP_ID` / `GITHUB_APP_PRIVATE_KEY` | GitHub App installation tokens |
| `GITHUB_WEBHOOK_SECRET` | Verifies GitHub webhook payloads |
| `GITHUB_APP_CLIENT_ID` / `GITHUB_APP_CLIENT_SECRET` | OAuth user-to-server flow |
| `TOKEN_ENCRYPTION_KEY` | AES-GCM key for per-user provider tokens (base64) |
| `WEBSOCKET_TOKEN_SIGNING_KEY` | HMAC key for short-lived websocket auth tokens |
| `WORKER_URL` | Public URL Sprites VMs call back into. In dev: your cloudflared tunnel. |

Authoritative list: `services/api-server/src/types.ts` (`Env` interface) and the comment block at the bottom of `wrangler.jsonc`.

## 8. Debugging recipes

- **Trace a user message**: web sends `chat.message` over WS → DO `onChatMessage` → `MessageRepository.create` → `AgentWorkflowCoordinator.dispatchTurn` → Workflow wakes → `AgentProcessRunner` writes stdin → vm-agent calls `streamText` → stdout NDJSON → Workflow RPCs chunks back to DO → DO writes to `pending_message_chunks` + broadcasts WS `agent.chunk`.
- **Look up a local session**: use `npx localflare` → https://studio.localflare.dev
- **Kill a stuck sprite/process**: `scripts/destroy-session-sprites.sh` or `scripts/kill-sprite-processes.ts`
- **Replay a session test**: `pnpm test:live:session` (`scripts/test-session.ts`)
- **Check agent logs**: the vm-agent emits `{ type: "debug" }` messages; they surface in `AgentProcessRunner` and the worker logs.

## 9. Further reading

- `AGENTS.md` — project-wide rules (error handling, code style, response style)
- `docs/turn-workflow.md` — deep dive on turn execution, RPC surface, crash recovery
- `docs/session-lifecycle.md` — DO status machine from creation to ready
- `docs/vm-agent.md` — agent process protocol, providers, tools
- `docs/api-server-map.md` — file-by-file guide to `services/api-server/src/`
- `docs/auth.md` — GitHub OAuth + session token flow
- `docs/github-app-auth.md` — GitHub App installation token handling
- `docs/webhook-tunnel.md` — local cloudflared setup
- `docs/plans/` — feature plans (use `TEMPLATE.md` for new ones; move to `complete/` when done)
