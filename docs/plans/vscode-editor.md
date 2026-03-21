# VS Code Editor Feature - Design Document

## Goal

Allow users to open a VS Code editor (openvscode-server) on the session's Sprite VM, giving them direct visibility into the workspace while the agent is running.

## Current State

The feature was implemented but disabled due to a security vulnerability. The flow was:

1. User calls `POST /sessions/:sessionId/editor/open`
2. API installs openvscode-server on the Sprite, starts it on port 8080 with a random connection token
3. Sprite URL is set to `"public"` so the browser can connect directly
4. URL + connection token are returned to the client

## Security Issue

Setting `setUrlAuth("public")` makes the Sprite's HTTP-forwarded port publicly accessible with no authentication. The vulnerability is not the URL being public per se — openvscode-server itself is protected by a connection token. The real issue is that **the agent has a tool to change which port is forwarded to HTTP**.

An attacker (or a prompt-injected agent) could swap port 8080 for an unauthenticated service (e.g. a plain file server), which would then be publicly accessible with zero auth. The connection token only protects openvscode-server specifically — it can't protect arbitrary ports.

Port-forwarding is a core Sprites VM capability baked into the agent's skill set — it can't be cleanly removed. Prompt-based discouragement is a soft protection, not a hard stop. We hard-stop git operations at the proxy layer for the same reason; the editor needs the same treatment.

## Fix

**Tunnel editor traffic through the Worker using the Sprites TCP proxy API.** Never call `setUrlAuth("public")` — keep the sprite URL in `"sprite"` auth mode at all times. Even if the agent changes the forwarded port, the tunnel explicitly targets port 8080 regardless.

Sprites provides `WSS /v1/sprites/{name}/proxy` — a WebSocket-based TCP tunnel into the sprite. After a JSON handshake (`{"host": "localhost", "port": 8080}`), it relays raw TCP transparently. Auth is via the Sprites API key (server-side only, browser never sees it).

The Worker adds an authenticated `/sessions/:sessionId/editor/*` route:

- Browser authenticates with its session token (existing auth)
- Worker opens a WebSocket TCP tunnel to the sprite's port 8080 via the Sprites proxy API, using the Sprites API key
- Browser traffic is relayed through the tunnel at the TCP level — no HTTP rewriting needed
- openvscode-server requires no `--server-base-path` changes since the connection is transparent
- Connection token can be dropped (`--without-connection-token`) since the Worker handles auth

**Latency**: One extra Worker hop, but Cloudflare runs at edge PoPs. VS Code's ongoing WebSocket messages are small deltas; large initial asset bundles are cached by the browser after first load.

**Agent replacing port 8080**: The agent could theoretically kill openvscode-server and start something else on port 8080. Since the sprite is never public, this is a reliability concern (editor breaks for the user), not a security issue — no external attacker can reach it regardless.

## Files

- `services/api-server/src/routes/sessions/sessions.routes.ts` — add authenticated `/editor/*` proxy route
- `services/api-server/src/lib/sprites/WorkersSpriteClient.ts` — add `proxyTcp(port)` method wrapping the Sprites proxy WebSocket API
- `services/api-server/src/durable-objects/session-agent-editor.ts` — remove `setUrlAuth("public")`, drop connection token
- `services/api-server/src/durable-objects/session-agent-do.ts` — re-enable editor routes
