# CLAUDE.md

This file provides guidance to ai agents when working with code in this repository.

## Project Overview

cloude-code is a cloud-hosted agent service. It runs agents inside isolated VMs (Fly.io Sprites) that are connected to an API server via WebSockets. Users connect to the API serve and create a session to make changes in a repository. The session gets its own Durable Object, which provisions a Sprite VM, clones the repository, and runs an agent process on the vm and communicates with the API server. 

The Durable Object is the source of truth and coordinator for the session. It stores all messages in its sqlite db, handles websocket comms and forwards responses to and from the agent process on the vm (via stdin/stdout).

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

NOTE: After making changes, make sure to build and lint and typecheck the repo.
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

- **@repo/shared** (`packages/shared/`) - Shared types and Zod schemas for the WebSocket protocol, session state, and vm-agent I/O. All client/server messages are validated through discriminated unions.

- **@repo/vm-agent** (`packages/vm-agent/`) - Runs inside the Sprite VM. Wraps the Claude Agent SDK in streaming input mode, communicates via stdin/stdout NDJSON with the Durable Object. Uses Bun runtime.

- **@repo/api-server** (`services/api-server/`) - Cloudflare Workers API using Hono. The `SessionAgentDO` Durable Object manages the full session lifecycle.

### Key Files

- `services/api-server/src/durable-objects/session-agent-do.ts` - Core session management, Sprite lifecycle, WebSocket handling
- `packages/vm-agent/src/index.ts` - Claude Agent SDK wrapper with streaming input mode
- `packages/shared/src/types/protocol.ts` - WebSocket message schemas
- `packages/shared/src/types/vm-agent.ts` - NDJSON protocol between DO and vm-agent

### Environment & Secrets

Required secrets for `api-server` (set via `wrangler secret put`):
- `ANTHROPIC_API_KEY`
- `SPRITES_API_KEY`
- ... others

## Tech Stack

- **pnpm workspaces** with Turbo for monorepo orchestration
- **Cloudflare Workers** with Durable Objects (SQLite for message persistence)
- **Hono** for server middleware
- **Zod** for runtime type validation
- **Bun** runtime for vm-agent
- **Sprites** for isolated VM execution. Sprites are 

NOTE: if adding new dependencies in multiple packages in the repo, prefer to use the pnpm catalog in `pnpm-workspace.yaml` for shared versioning.