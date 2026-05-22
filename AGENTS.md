# AGENTS.md

This file provides guidance to ai agents when working with code in this repository.

## Project Overview

cloude-code is a cloud-hosted agent service. It runs agents inside isolated VMs (Fly.io Sprites) and coordinates via Cloudflare durable objects (DOs) on an API server. 
Users connect to the API server and create a session to make changes in a repository. Each session gets its own Durable Object, which provisions a Sprite VM, clones the repository, and runs an agent process on the vm and communicates with the API server. 

The Durable Object is the source of truth and coordinator for the session. It stores all messages in its sqlite db.

The VM owns the execution runtime for its workflows, and the DO dispatches messages from users to the vm. The vm runs independently, and submits its output back to the DO via webhook http requests. This is done because DOs are not designed to be long-lived servers, and the VM owns its own execution context, and cannot rely on a stable websocket connection to the DO. Webhooks are simple and reliable, because incoming http requests are guaranteed to wake the DO.

## Build & Development Commands

### Development

- Use `pnpm` for all package-manager commands.
- If `pnpm` is not available on `PATH`, use `corepack pnpm`.

```bash
# Install dependencies
pnpm install
# Run just the API server (Cloudflare Workers)
pnpm dev:api
# Build all packages
pnpm build

# Typecheck all packages
pnpm typecheck

# Lint all packages
pnpm lint

# Clean build artifacts
pnpm clean
```

### Validating your work.

NOTE: After making changes, always make sure to build, lint, and typecheck the repo.
NOTE: You have access to local browser tools to validate your visual changes. Use them.
NOTE: If you are tasked with committing to git, prefer concise messages. 

### Package-specific commands

```bash
# API Server (services/api-server)
cd services/api-server
pnpm dev           # wrangler dev
pnpm deploy        # wrangler deploy

# VM Agent (packages/vm-agent)
cd packages/vm-agent
pnpm build         # builds NDJSON and webhook bundles to dist/
pnpm test:live:agent    # Test an agent provider locally
pnpm test:live:webhook  # Test the webhook runner locally

# Shared types and utils (packages/shared)
# NOTE: build is not needed for shared, as it is a pure typescript package that is imported directly by other services
cd packages/shared
pnpm build         # tsc --noEmit
```

## Architecture

### Packages

- **@repo/shared** (`packages/shared/`) - Shared types and Zod schemas for data transfer, session state, and vm-agent I/O. All client/server messages are validated through discriminated unions.
Note: If a type should be used by multiple packages, put it in shared instead of duplicating the interface in those packages.

- **@repo/vm-agent** (`packages/vm-agent/`) - Runs inside the Sprite VM. Provides a shared AI SDK agent harness with Claude Code and OpenAI Codex providers. The current deployment path uses the webhook entrypoint; the NDJSON entrypoint remains for the legacy stdin/stdout path. Uses Bun runtime.

- **@repo/api-server** (`services/api-server/`) - Cloudflare Workers API using Hono. The `SessionAgentDO` Durable Object manages the full session lifecycle.

- **@repo/web** (`apps/web/`) - Next.js web client

### Key Files

- `services/api-server/src/durable-objects/session-agent-do.ts` - Core session management, VM lifecycle, WebSocket handling, and webhook RPC handlers
- `packages/vm-agent/src/index-webhook.ts` - Current vm-agent webhook entrypoint
- `packages/vm-agent/src/index-ndjson.ts` - Legacy vm-agent NDJSON entrypoint
- `packages/vm-agent/src/lib/agent-harness.ts` - Shared AI SDK harness used by both entrypoints
- `packages/shared/src/types/websocket-api.ts` - WebSocket message schemas

### Environment & Secrets

Required secrets for `api-server` (set via `wrangler secret put`):
- `ANTHROPIC_API_KEY`
- `SPRITES_API_KEY`
- `GITHUB_APP_PRIVATE_KEY`
- `GITHUB_WEBHOOK_SECRET`
- `GITHUB_APP_CLIENT_SECRET`
- `TOKEN_ENCRYPTION_KEY`
- `WEBSOCKET_TOKEN_SIGNING_KEY`

Additional environment bindings and non-secret vars live in `services/api-server/src/types.ts` and `services/api-server/wrangler.jsonc`.

## Tech Stack

- **pnpm workspaces** with Turbo for monorepo orchestration
- **Cloudflare** Workers, Agents SDK, Durable Objects (SQLite for message persistence)
- **AI SDK** for abstracting over LLM data types. Generic interface for llm interaction and data types. https://ai-sdk.dev/docs/introduction
- **Hono** for server middleware - https://hono.dev/docs/
- **Zod** for runtime type validation
- **Bun** runtime for vm-agent
- **Sprites** for isolated VM execution. Sprites are quick-booting persistent vms by fly.io - https://docs.sprites.dev/ https://sprites.dev/api
    Note: Always look up the sprites api docs instead of relying on your internal knowledge if you are not certain.
- **Github API** for repo management and authentication. User auths with github and the cloude-code github app is installed on each org they choose (they can also scope to specific repos). github-app.ts handles this authentication and data management. 
    NOTE: Github has repository ids and names (eg owner/repo). Prefer using the numeric ids over names, as they are stable.
    NOTE: Github apps api docs are here: https://docs.github.com/en/apps. Prefer looking up docs to your own memory if you are not certain.

NOTE: if adding new dependencies in multiple packages in the repo, prefer to use the pnpm catalog in `pnpm-workspace.yaml` for shared versioning.


## Error handling

- Use `Result<T, E>` for expected business logic and operational failures. See `packages/shared/src/types/errors.ts` for more details.
- Define `E` as a small tagged plain-object union with a stable `code` string; do not use `Error` subclasses for normal control flow.
- Use `throw` only for bugs, invariant violations, and unexpected integration/runtime failures.
- Convert integration exceptions into scoped business-error `Result` values at service boundaries before they flow through the rest of the app.

### Logging
The app-wide logger is available as `Logger` in `packages/shared/src/logging/index.ts`. Loggers should be scoped to the module they are in.
Use string interpolation for simple messages. Use structured `fields` when the values are useful for filtering or debugging.
```typescript
logger.info(`received chunk ${sequence}, expected ${expected}`);
logger.warn("Invalid webhook body", { fields: { sessionId, issues } });
```

## Documentation / Further Information

`docs/` contains specific documentation about certain parts of the codebase, if needed.
`openspec/` contains the OpenSpec artifacts for proposal and change management.

## Response style

### Output
- No preamble. No "Great question!", "Sure!", etc
- No hollow closings. No "I hope this helps!", etc.
- No restating the prompt. If the task is clear, execute immediately.

### Token Efficiency
- Compress responses. Every sentence must earn its place.
- No redundant context.
- No long intros or transitions between sections.
- Short responses are correct unless depth is explicitly requested.

### Sycophancy - Zero Tolerance
- Disagree when user is wrong. State the correction directly.
- Do not change a correct answer just because the user pushes back.

### Accuracy and Speculation Control
- Never speculate about code, files, or APIs you have not read.
- If referencing a file or function: read it first, then answer.
- Never invent file paths, function names, or API signatures.

### Warnings and Disclaimers
- No safety disclaimers unless there is a genuine life-safety or legal risk.
- No "As an AI, I..." framing.

### Session Memory
- Learn user corrections and preferences within the session.
- Apply them silently. Do not re-announce learned behavior.
- If the user corrects a mistake: fix it, remember it, move on.


## Best Practices

- Always build, lint, and typecheck after completing a task to test it.
- Prefer unabbreviated variable names rather than shortened ones. For example, prefer `const installation = ...` instead of `const inst = ...`. Variable names should not be too long (>30 chars) though.
- Do not use emojis in your git messages or comments.
- Add doc comments to public-facing methods, for clarity. Write concise, instructive and clarifying comments where needed.
- Always prefer to use async/await over callbacks and .then()/.catch()
- For public methods, add doc comments describing the method, its parameters and return value.
- When switching over entire cases, make switch statements exhaustive for maintainability - if we ever add a new case, it should be handled. Prefer switch to multiple if/else chains
```typescript
switch (expression) {
    case "value1":
        break;
    case "value2":
        break;
    default:
        const _exhaustiveCheck: never = expression;
        throw new Error(`Unhandled value: ${_exhaustiveCheck}`);
}
```
- Prefer switch statements over if/else, and prefer exhaustive switch statements.
- Prefer the simplest working solution. Avoid over-engineering, over-defensiveness. Do not create fallback error-handling logic to cover up an error that should not exist in the first place.
- Avoid abstractions or helpers for single-use operations. If multiple uses, DRY up the code.
- No speculative features or future-proofing.
- No docstrings or comments on code that was not changed.
