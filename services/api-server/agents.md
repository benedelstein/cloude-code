# API Server

## Overview

The api-server is a Cloudflare Workers application using Hono for routing. The core abstraction is the `SessionAgentDO` Durable Object, which manages the full lifecycle of a coding session.

## Important Best practices

- For creating routes, define the openapi schemas in schema.ts and then import those into your routes (e.g. sessions.routes.ts). 
- Always define each return type for your routes, do not use `as any` for casting. Be type-safe!
- For route handler logic, prefer to place the logic inside lib/<name>.service.ts (or inside the DO for routes that need it), not directly in the route handler. The route handler should be only for verifying input, handling errors, and returning to the client.

## Key Architecture

Note: this package follows a controller-service-repository architecture pattern. Keep separation of concerns!

### SessionAgentDO (`src/durable-objects/session-agent-do.ts`)

The Durable Object is the source of truth for each session. It:
- Extends the Cloudflare Agents SDK `Agent` base class
- Stores all messages in its SQLite database via repositories
- Manages WebSocket connections to clients
- Handles VM lifecycle (provisioning, health checks, cleanup)
- Communicates with the vm-agent process on Sprites VMs via stdin/stdout NDJSON

### Request Routing

Hono route handlers that authenticate requests. `src/routes/`
Within each route group is a schema defining the OpenAPI spec, and handlers that use that schema.

Some routes forward to the session agent DO. Internal DO requests use `http://do/` prefix:
- `GET /` - Session info
- `GET /messages` - All messages
etc.

### Repositories (`src/durable-objects/repositories/`)

SQLite-backed data access layer within the DO:
- `MessageRepository` - Chat message persistence
- `AttachmentRepository` - Attachment metadata
- `SecretRepository` - Encrypted secrets

### Lib (`src/lib/`)

Business logic - Service modules for GitHub integration, pull request management, Sprites VM coordination, etc.
