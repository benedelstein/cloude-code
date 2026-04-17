# API Server

## Overview

The api-server is a Cloudflare Workers application using Hono for routing. The core abstraction is the `SessionAgentDO` Durable Object, which manages the full lifecycle of a coding session.

## Key Architecture

Note: this package follows a controller-service-repository architecture pattern. Keep separation of concerns between different layers.
1. Route (controller) is responsible for verifying input, handling errors, and returning data to the client.
2. Service (business logic) is responsible for the core logic of the application.
3. Repository (data access) is responsible for interacting with the database. (Pure CRUD operations)

Services may take other services as dependencies, for composability.
`src/routes/sessions/sessions.routes.ts` -> `src/lib/sessions/sessions.service.ts` -> `src/repositories/sessions/sessions.repository.ts`

### SessionAgentDO (`src/durable-objects/session-agent-do.ts`)

The Durable Object is the source of truth for each session. It:
- Extends the Cloudflare Agents SDK `Agent` base class
- Stores all messages in its SQLite database via repositories
- Manages WebSocket connections to clients
- Handles VM lifecycle (provisioning, health checks, cleanup)
- Starts and communicates with the `SessionTurnWorkflow` to execute agent turns reliably.

A Durable Object is a stateful, on-demand class that can write to durable SQLite storage. It starts up as needed and shuts down after inactivity. The DO acts like a "mini-server" for each session, coordinating state in a thread-safe manner.

NOTE: Prefer to split out logic into scoped, separate service files inside of `lib/` for clarity and maintainability.
Otherwise, the DO can become a giant mess of a file.

## SessionTurnWorkflow (`src/workflows/SessionTurnWorkflow.ts`)

This workflow is a durable execution context for communicating with the vm-agent process on the sprite vm. It is long-lived and resilient. It will not die on inactivity, unlike a durable object. The workflow sets up a connection to 
the agent process on the vm and communicates with it via stdin/stdout NDJSON. As it receives chunks, it forwards them
to the DO via RPC methods. If the DO is inactive, the rpc will wake it up.

This setup can survive long-running agent tasks with long gaps in between chunk outputs.

### Request Routing

Hono route handlers that authenticate requests. `src/routes/`
Within each route group is a `schema.ts` file defining the zod OpenAPI spec, and handlers that use that schema.

Some routes forward to the session agent DO. Internal DO requests use `http://do/` prefix:
- `GET /` - Session info
- `GET /messages` - All messages
etc.

### Repositories (`src/durable-objects/repositories/`)

SQLite-backed data access layer within the DO:
- `MessageRepository` - Chat message persistence
- `SecretRepository` - Encrypted secrets

D1 Repositories (`src/repositories/`)
- `AttachmentRepository` - Attachment metadata
- `UserSessionRepository` - User session persistence
- `SessionHistoryRepository` - Session history persistence


## Important Best practices

- For creating routes, define the openapi schemas in `schema.ts` and then import those into your routes (e.g. `sessions.routes.ts`). 
- Always define each return type for your routes, do not use `as any` for casting. Be type-safe!
- For route handler logic, place the logic inside `lib/<domain>/<name>.service.ts` (or inside the DO for routes that need it), not directly in the route handler. The route handler should be only for verifying input, handling errors, and returning to the client.
- Add doc comments to public-facing methods, for clarity. And add concise(!) inline comments where necessary.