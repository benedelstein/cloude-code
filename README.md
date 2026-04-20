# cloude-code

cloude-code is a cloud-hosted coding agent system. It provisions an isolated Sprite VM per session, runs an agent inside that VM, and coordinates the session through a Cloudflare Durable Object plus a long-lived workflow.

## Packages

- `services/api-server` — Hono + Cloudflare Workers API, Durable Objects, workflows.
- `packages/vm-agent` — VM-side agent harness and provider adapters.
- `packages/shared` — shared schemas, API contracts, provider types, utilities.
- `apps/web` — Next.js client.
- `scripts` — local debugging and live test helpers.

## Common commands

```bash
pnpm install
pnpm doctor
pnpm build
pnpm lint
pnpm typecheck
pnpm test
```

### Local development

```bash
pnpm dev:api    # Cloudflare Worker API only
pnpm dev:web    # Next.js web app only
pnpm dev:local  # API + web + scripts workspace dev tasks
```

## Task entrypoints

### Session lifecycle and orchestration
- `services/api-server/src/durable-objects/session-agent-do.ts`
- `services/api-server/src/durable-objects/lib/AgentWorkflowCoordinator.ts`
- `services/api-server/src/workflows/SessionTurnWorkflow.ts`
- `services/api-server/src/workflows/AgentProcessRunner.ts`

### API routes
- `services/api-server/src/index.ts`
- `services/api-server/src/routes/`
- `services/api-server/src/lib/`

### VM agent runtime
- `packages/vm-agent/src/index.ts`
- `packages/vm-agent/src/agent-harness.ts`
- `packages/vm-agent/src/system-prompt.ts`
- `packages/vm-agent/src/providers/`

### Web app
- `apps/web/app/(app)/session/[sessionId]/session-page-client.tsx`
- `apps/web/components/chat/`
- `apps/web/components/sidebar/`
- `apps/web/lib/client-api.ts`

## Notes for contributors and agents

- Use `pnpm` commands from the repo root.
- Keep API route handlers thin; put business logic in services and persistence in repositories.
- Shared types belong in `packages/shared`.
- After changes, validate with `pnpm build && pnpm lint && pnpm typecheck`.
