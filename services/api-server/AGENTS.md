# API Server

## Overview

The api-server is a Cloudflare Workers application using Hono for routing. The core abstraction is the `SessionAgentDO` Durable Object, which manages the full lifecycle of a coding session.

## Key Architecture

Note: this package follows a controller-service-repository architecture pattern. Keep separation of concerns between different layers.

1. Route (controller) is responsible for verifying input, handling errors, and returning data to the client.
2. Service (business logic) is responsible for the core logic of the application.
3. Repository (data access) is responsible for interacting with the database. (Pure CRUD operations)

Services may take other services as dependencies, for composability.
`src/routes/sessions/sessions.routes.ts` -> `src/lib/sessions/sessions.service.ts` -> `src/repositories/sessions.repository.ts`

### SessionAgentDO (`src/durable-objects/session-agent-do.ts`)

The Durable Object is the source of truth for each session. It:

- Extends the Cloudflare Agents SDK `Agent` base class
- Stores all messages in its SQLite database via repositories
- Manages WebSocket connections to clients
- Handles VM lifecycle (provisioning, health checks, cleanup)
- Starts and dispatches turns to the sprite's vm-agent, and receives turn data via webhook HTTP requests.

A Durable Object is a stateful, on-demand class that can write to durable SQLite storage. It starts up as needed and shuts down after inactivity. The DO acts like a "mini-server" for each session, coordinating state in a thread-safe manner.

NOTE: Prefer to split out logic into scoped, separate service files inside of `lib/` for clarity and maintainability.
Otherwise, the DO can become a giant mess of a file.

### Request Routing

Hono route handlers authenticate requests. `src/routes/`
Within each route group is a `schema.ts` file defining the Zod OpenAPI spec, and handlers use that schema.

Some routes call the session agent DO directly through typed RPC methods such as `handleGetSession()` and `handleGetMessages()`. The WebSocket proxy route still forwards upgraded requests to the DO with the `http://do/` prefix.

### Repositories (`src/durable-objects/repositories/`)

SQLite-backed data access layer within the DO:

- `MessageRepository` - Chat message persistence
- `SecretRepository` - Encrypted secrets
- `PendingChunkRepository` - Stream chunk WAL/recovery state
- `LatestPlanRepository` - Latest plan metadata
- `ServerStateRepository` - Durable server-side session state

D1 repositories (`src/repositories/`):

- `SessionsRepository` - Session list and metadata
- `UserSessionRepository` - User session persistence
- `UserRepository` - User account records
- `UserProviderCredentialRepository` and provider auth repositories - OAuth/provider credential state
- GitHub installation and repo access repositories - GitHub App installation, access, and cache state

## Important best practices

- For creating routes, define the OpenAPI schemas in `schema.ts` and then import those into your routes (for example, see `sessions.routes.ts`).
- Always define each return type for your routes, DO NOT use `as any` for casting. Be type-safe.
- For route handler logic, place the logic inside `lib/<domain>/<name>.service.ts` (or inside the DO for routes that need it), not directly in the route handler. The route handler should be only for verifying input, handling errors, and returning to the client.
- Add doc comments to public-facing methods, for clarity. Add concise inline comments where necessary.
