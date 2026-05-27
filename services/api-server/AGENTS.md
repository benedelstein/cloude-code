# API Server

## Read First

- Repo architecture: `../../ARCHITECTURE.md`.
- Repo engineering rules, linting, logging, error handling, and import boundaries: `../../docs/ENGINEERING.md`.
- API-server structure and module boundaries: `../../docs/api-server/structure.md`.

Read focused docs before changing their areas:

- Session turn execution, cancellation, webhook ingestion, and recovery: `../../docs/turn-workflow.md`.
- GitHub OAuth, session auth, and websocket auth: `../../docs/auth.md`.
- GitHub App installation, repo access, clone auth, and git proxy auth: `../../docs/github-app-auth.md`.
- Local webhook tunnel behavior: `../../docs/webhook-tunnel.md`.

## File Map

- `src/index.ts` builds the Worker app and exports runtime bindings.
- `src/runtime/` contains Worker runtime entrypoints such as Durable Object classes.
- `src/composition/` wires route builders and root-level dependencies.
- `src/modules/` contains domain modules.
- `src/shared/` contains API-server-only shared code.
- `scripts/` contains api-server-local maintenance and lint scripts.

## Local Commands

```bash
pnpm --filter @repo/api-server lint
pnpm --filter @repo/api-server lint:module-boundaries
pnpm --filter @repo/api-server typecheck
pnpm --filter @repo/api-server build
pnpm --filter @repo/api-server test
```

## Local Rules

- Keep `AGENTS.md` thin. Put durable guidance in `../../docs/api-server/structure.md` or a focused doc under `../../docs/`.
- Route modules should not import the `SessionAgentDO` class. Use the shared session-agent protocol and Durable Object binding.
- Keep route handlers thin; put business logic in the owning module's `services/` directory.
- Always define route return types. Do not use `as any`.
