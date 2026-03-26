# API Server

Cloudflare worker server for managing session state and communicating between clients and VM.
- Cloudflare agents SDK
- Hono middleware

## Routes

### REST

| Method | Path | Description |
|--------|------|-------------|
| POST | `/sessions` | Create a new session. Body: `{ repoId: string }`. Returns `{ sessionId }` |
| GET | `/sessions/:sessionId` | Get session info (status, repoId) |
| GET | `/sessions/:sessionId/messages` | Get message history |
| DELETE | `/sessions/:sessionId` | Delete session and terminate VM |

### WebSocket

| Path | Description |
|------|-------------|
| `/agents/session/:sessionId` | WebSocket connection for real-time communication |

## Connection Flow

1. **Create session**: `POST /sessions` with `{ repoId: "owner/repo" }`
2. **Connect WebSocket**: Open connection to `/agents/session/:sessionId`
3. **Receive initial state**: Server sends `connected` and `sync.response` (message history)
4. **Monitor status**: Server sends `session.status` events as VM provisions
5. **Chat**: Send `chat.message`, receive streaming `agent.chunk` events

## Client → Server Messages

```typescript
{ type: "chat.message", content: string }    // Send a message
{ type: "sync.request" }                      // Request message history
{ type: "operation.cancel" }                  // Cancel current operation
```

## Server → Client Messages

```typescript
{ type: "connected", sessionId, status }      // Connection established
{ type: "session.status", status, message? }  // Status change (provisioning → ready)
{ type: "sync.response", messages: [] }       // Message history
{ type: "agent.chunk", chunk }                // Streaming response chunk
{ type: "agent.finish", message }             // Response complete
{ type: "user.message", message }             // Message from another client (multiplayer)
{ type: "error", code, message }              // Error
```

## Session Status

`provisioning` → `cloning` → `ready`

On reconnect: `syncing` → `attaching` → `ready`

## Example (TypeScript)

```typescript
// Create session
const { sessionId } = await fetch("/sessions", {
  method: "POST",
  body: JSON.stringify({ repoId: "owner/repo" }),
}).then(r => r.json());

// Connect WebSocket
const ws = new WebSocket(`wss://${API_URL_HOST}/agents/session/${sessionId}`);

ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);
  if (msg.type === "agent.chunk") {
    // Handle streaming chunk
  }
};

// Send message
ws.send(JSON.stringify({ type: "chat.message", content: "Hello" }));
```

## Testing and running 

Migrate the local d1 database 
```bash
pnpm db:migrate
```

```bash
cd services/api-server
pnpm dev
```

To view local db state, use `localflare`

```bash
npx localflare
```
then visit https://studio.localflare.dev 

## Deployment

The api server is deployed to Cloudflare Workers via `.github/workflows/deploy-api-server.yml`
The deploy action
1. builds and lints the app
2. Applies any d1 migrations added
3. Deploys the worker to Cloudflare Workers

To add new secrets, run:
```bash
npx wrangler secret put <secret-name>
# then enter the value when prompted
```

To add public environment variables, edit `wrangler.jsonc`