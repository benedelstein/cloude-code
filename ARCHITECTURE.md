# Architecture

cloude-code is a cloud-hosted agent service. It runs agents inside isolated VMs (Fly.io Sprites) and coordinates sessions through Cloudflare Durable Objects on the API server.

Users connect to the API server and create a session to make changes in a repository. Each session gets its own Durable Object, which provisions a Sprite VM, clones the repository, runs an agent process on the VM, and communicates with the API server.

The Durable Object is the source of truth and coordinator for the session. It stores all messages in its SQLite database.

The VM owns the execution runtime for its workflows, and the Durable Object dispatches messages from users to the VM. The VM runs independently and submits output back to the Durable Object through webhook HTTP requests. This is done because Durable Objects are not designed to be long-lived servers, and the VM owns its execution context without relying on a stable WebSocket connection to the Durable Object. Webhooks are simple and reliable because incoming HTTP requests wake the Durable Object.

## Packages

- **@repo/shared** (`packages/shared/`) - Shared types and Zod schemas for data transfer, session state, and vm-agent I/O. All client/server messages are validated through discriminated unions. If a type should be used by multiple packages, put it in shared instead of duplicating the interface.
- **@repo/vm-agent** (`packages/vm-agent/`) - Runs inside the Sprite VM. Provides a shared AI SDK agent harness with Claude Code and OpenAI Codex providers. The current deployment path uses the webhook entrypoint; the NDJSON entrypoint remains for the legacy stdin/stdout path. Uses Bun runtime.
- **@repo/api-server** (`services/api-server/`) - Cloudflare Workers API using Hono. The `SessionAgentDO` Durable Object manages the full session lifecycle.
- **@repo/web** (`apps/web/`) - Next.js web client.

## Key Files

- `services/api-server/src/durable-objects/session-agent-do.ts` - Core session management, VM lifecycle, WebSocket handling, and webhook RPC handlers.
- `packages/vm-agent/src/index-webhook.ts` - Current vm-agent webhook entrypoint.
- `packages/vm-agent/src/index-ndjson.ts` - Legacy vm-agent NDJSON entrypoint.
- `packages/vm-agent/src/lib/agent-harness.ts` - Shared AI SDK harness used by both entrypoints.
- `packages/shared/src/types/websocket-api.ts` - WebSocket message schemas.

## Tech Stack

- **pnpm workspaces** with Turbo for monorepo orchestration.
- **Cloudflare** Workers, Agents SDK, Durable Objects, and SQLite-backed Durable Object storage.
- **AI SDK** for abstracting over LLM data types and interaction.
- **Hono** for server middleware.
- **Zod** for runtime type validation.
- **Bun** runtime for vm-agent.
- **Sprites** for isolated VM execution.
- **GitHub API** for repo management and authentication.

## External API Notes

- Always look up the Sprites API docs instead of relying on internal knowledge if behavior is uncertain.
- Prefer numeric GitHub repository IDs over owner/name strings because numeric IDs are stable.
- Use the GitHub Apps API docs when changing GitHub App authentication, installation, or repository access behavior.

## Environment And Secrets

Required secrets for `api-server` are set through `wrangler secret put`:

- `ANTHROPIC_API_KEY`
- `SPRITES_API_KEY`
- `GITHUB_APP_PRIVATE_KEY`
- `GITHUB_WEBHOOK_SECRET`
- `GITHUB_APP_CLIENT_SECRET`
- `TOKEN_ENCRYPTION_KEY`
- `WEBSOCKET_TOKEN_SIGNING_KEY`

Additional environment bindings and non-secret vars live in `services/api-server/src/types.ts` and `services/api-server/wrangler.jsonc`.
