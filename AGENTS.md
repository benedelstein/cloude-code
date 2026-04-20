# AGENTS.md

Agent guidance for this repository.

## Fast path

- Use `pnpm` for package-manager commands. If `pnpm` is missing on `PATH`, use `corepack pnpm`.
- After code changes, run `pnpm build`, `pnpm lint`, and `pnpm typecheck` from the repo root.
- Before editing, create a branch: `git checkout -b cloude/<short-slug>-<session-suffix>`.
- Prefer the smallest scoped change that solves the task. Do not refactor unrelated code.

## Repo map

- `services/api-server/` — Cloudflare Worker API and Durable Objects.
- `packages/vm-agent/` — agent runtime that executes inside the Sprite VM.
- `packages/shared/` — shared Zod schemas, API types, provider types, and utilities.
- `apps/web/` — Next.js web client.
- `scripts/` — local developer and live-debug scripts.
- `docs/` — focused architecture notes and implementation plans.

## First files to read by task

### Session lifecycle / orchestration
- `services/api-server/src/durable-objects/session-agent-do.ts`
- `services/api-server/src/durable-objects/lib/AgentWorkflowCoordinator.ts`
- `services/api-server/src/workflows/SessionTurnWorkflow.ts`
- `services/api-server/src/workflows/AgentProcessRunner.ts`

### API routes and service boundaries
- `services/api-server/src/index.ts`
- `services/api-server/src/routes/**`
- `services/api-server/src/lib/**`
- `services/api-server/agents.md`

### VM agent behavior
- `packages/vm-agent/src/index.ts`
- `packages/vm-agent/src/agent-harness.ts`
- `packages/vm-agent/src/system-prompt.ts`
- `packages/vm-agent/src/providers/*.ts`

### Shared contracts
- `packages/shared/src/types/**`
- `packages/shared/src/utils/**`

### Web app
- `apps/web/app/(app)/session/[sessionId]/session-page-client.tsx`
- `apps/web/components/chat/**`
- `apps/web/components/sidebar/**`
- `apps/web/lib/client-api.ts`
- `apps/web/agents.md`

## Architecture rules

- If a type is shared across packages, move it to `packages/shared/`.
- In `api-server`, keep route handlers thin. Put business logic in `src/lib/<domain>/...service.ts` and data access in `src/repositories/`.
- Prefer explicit `Result<T, E>` unions for expected failures. Do not use `Error` subclasses for normal control flow.
- Prefer `async`/`await`.
- Make whole-value `switch` statements exhaustive.
- Prefer descriptive variable names.

## Validation matrix

- Whole repo: `pnpm build && pnpm lint && pnpm typecheck`
- Root script sanity: `pnpm doctor`
- API server only: `pnpm --filter @repo/api-server build`
- Web only: `pnpm --filter @repo/web test`
- Shared only: `pnpm --filter @repo/shared test`
- VM agent only: `pnpm --filter @repo/vm-agent test`

## Live-dev commands

- API only: `pnpm dev:api`
- Web only: `pnpm dev:web`
- API + web + scripts tunnel: `pnpm dev:local`

## High-friction areas

- `services/api-server/src/durable-objects/session-agent-do.ts` is large; prefer extracting scoped logic to `src/durable-objects/lib/` instead of growing the file.
- `services/api-server/src/lib/github/github-app.ts` and `apps/web/app/(app)/session-creation-form.tsx` are also large; avoid mixing unrelated concerns into them.
- `components/ui/` in the web app is generated shadcn code. Do not casually refactor generated primitives.

## Docs worth checking

- `docs/turn-workflow.md`
- `docs/github-app-auth.md`
- `docs/auth.md`
- `docs/webhook-tunnel.md`
- `docs/plans/TEMPLATE.md`

## Instruction files

- Root instructions live here: `AGENTS.md`.
- `CLAUDE.md` should stay a thin pointer to this file to avoid drift.
- Package-specific guidance lives in `services/api-server/agents.md` and `apps/web/agents.md`.
