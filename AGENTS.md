# CLAUDE.md

This file provides guidance to ai agents when working with code in this repository.

## Project Overview

cloude-code is a cloud-hosted agent service. It runs agents inside isolated VMs (Fly.io Sprites) that are connected to an API server via WebSockets. Users connect to the API serve and create a session to make changes in a repository. The session gets its own Durable Object, which provisions a Sprite VM, clones the repository, and runs an agent process on the vm and communicates with the API server. 

The Durable Object is the source of truth and coordinator for the session. It stores all messages in its sqlite db, handles comms with a long-lived Workflow for the agent execution, and communicates with clients.

The workflow `SessionTurnWorkflow` is a long-lived workflow that communicates with the agent process running on the vm and forwards data back to the DO.

## Build & Development Commands

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
NOTE: You have access to the /screenshot skill to test visual changes on the web app. If you make visual changes, check your work by using /screenshot with a localhost url.
        If you need to know which session url to use, you could look one up from the local d1 db or ask the user.
NOTE: If you are tasked with committing to git, prefer concise messages. 

### Package-specific commands

```bash
# API Server (services/api-server)
cd services/api-server
pnpm dev           # wrangler dev
pnpm deploy        # wrangler deploy

# VM Agent (packages/vm-agent)
cd packages/vm-agent
pnpm build         # bun build to dist/vm-agent.bundle.js
bun run src/test-agent.ts  # Test agent locally

# Shared types (packages/shared)
cd packages/shared
pnpm build         # tsc
```

## Architecture

### Packages

- **@repo/shared** (`packages/shared/`) - Shared types and Zod schemas for data transfer, session state, and vm-agent I/O. All client/server messages are validated through discriminated unions.
Note: If a type should be used by multiple packages, always put it in shared instead of duplicating the interface in those packages.

- **@repo/vm-agent** (`packages/vm-agent/`) - Runs inside the Sprite VM. Wraps the Claude Agent SDK in streaming input mode, communicates via stdin/stdout NDJSON with the Durable Object. Uses Bun runtime.

- **@repo/api-server** (`services/api-server/`) - Cloudflare Workers API using Hono. The `SessionAgentDO` Durable Object manages the full session lifecycle.

- **@repo/web** (`apps/web/`) - Next.js web client

### Key Files

- `services/api-server/src/durable-objects/session-agent-do.ts` - Core session management, VM lifecycle, WebSocket handling
- `packages/vm-agent/src/index.ts` - Claude Agent SDK wrapper with streaming input mode
- `packages/shared/src/types/websocket-api.ts` - WebSocket message schemas

### Environment & Secrets

Required secrets for `api-server` (set via `wrangler secret put`):
- `ANTHROPIC_API_KEY`
- `SPRITES_API_KEY`
- ... others

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

## Best Practices

- Always build, lint, and typecheck after completing a task to test it.
- Prefer unabbreviated variable names rather than shortened ones. For example, prefer `const installation = ...` instead of `const inst = ...`. Variable names should not be too long (>30 chars) though.
- Do not use emojis in your git messages or comments.
- Write concise, instructive and clarifying comments where needed.
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
- Prefer the simplest working solution. Avoid over-engineering, over-defensiveness. Do not create fallback error-handling logic to cover up an error that should not exist in the first place.
- Avoid abstractions or helpers for single-use operations. If multiple uses, DRY up the code.
- No speculative features or future-proofing.
- No docstrings or comments on code that was not changed.

## Documentation / Further Information

The docs/ folder contains specific documentation about certain parts of the codebase, if needed.
`docs/plans` contains artifacts about implementation plans for larger features. If you are planning a larger feature, you must create a plan file in that folder. Use `TEMPLATE.md` as a starting point. Once a plan's implmentation has been completed, move it to `docs/plans/complete/`



## Response style

### Output
- No preamble. No "Great question!", "Sure!", "Of course!", "Certainly!", "Absolutely!".
- No hollow closings. No "I hope this helps!", "Let me know if you need anything!".
- No restating the prompt. If the task is clear, execute immediately.

### Token Efficiency
- Compress responses. Every sentence must earn its place.
- No redundant context. Do not repeat information already established in the session.
- No long intros or transitions between sections.
- Short responses are correct unless depth is explicitly requested.

### Sycophancy - Zero Tolerance
- Never say "You're absolutely right!" unless the user made a verifiable correct statement.
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

### Scope Control
- Do not add features beyond what was asked.
- Do not refactor surrounding code when fixing a bug.