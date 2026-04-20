# Cloude Code

Cloud-hosted coding agents. Inspired by [Ramp's background agent post](https://builders.ramp.com/post/why-we-built-our-background-agent). Each session runs in its own isolated Sprite VM with a cloned repo and a streaming model agent.

## Packages

- `apps/web/` — Next.js client
- `services/api-server/` — Cloudflare Worker (Hono + Durable Object + Workflow)
- `packages/vm-agent/` — Bun process that runs the model inside the sprite VM
- `packages/shared/` — Zod schemas + types shared across the above

## Quick start

```bash
pnpm install
cp services/api-server/.env.example services/api-server/.dev.vars   # fill in
cp apps/web/.env.example apps/web/.env.local                        # fill in
pnpm --filter @repo/api-server db:migrate
pnpm dev:local   # web + api + cloudflared tunnel
```

## For agents working in this repo

Start here:

- [`AGENTS.md`](./AGENTS.md) — project rules, build/lint/typecheck commands, code conventions
- [`docs/onboarding.md`](./docs/onboarding.md) — cold-start, repo layout, where to put new code
- [`docs/api-server-map.md`](./docs/api-server-map.md) — file-by-file guide to the api-server
- [`docs/session-lifecycle.md`](./docs/session-lifecycle.md) — DO state machine from create to ready
- [`docs/vm-agent.md`](./docs/vm-agent.md) — agent process protocol + adding providers
- [`docs/turn-workflow.md`](./docs/turn-workflow.md) — per-turn RPC + crash recovery
- [`docs/auth.md`](./docs/auth.md), [`docs/github-app-auth.md`](./docs/github-app-auth.md) — auth flows
- [`docs/webhook-tunnel.md`](./docs/webhook-tunnel.md) — local cloudflared setup
- [`docs/plans/`](./docs/plans/) — active and completed feature plans

## Validate your changes

```bash
pnpm typecheck
pnpm lint
pnpm build
pnpm test
```
