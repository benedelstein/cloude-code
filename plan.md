# Plan: OpenAI OAuth Flow for Codex Provider

## Overview

Implement OAuth 2.0 PKCE flow against OpenAI's auth server so users can connect their
ChatGPT Plus/Pro subscription. The OAuth token is stored encrypted per-user (same pattern
as GitHub tokens) and passed to the VM agent when using the codex-cli provider.

Additionally, replace the codex-cli wrapper with `@ai-sdk/openai` directly, since the
OAuth token works with the standard OpenAI Responses API — no CLI dependency needed on VM.

## Architecture

```
Browser popup → auth.openai.com/oauth/authorize (PKCE)
       ↓ redirect
Web callback → POST /auth/openai/token (exchange code)
       ↓
API server encrypts + stores token in D1 (openai_tokens table)
       ↓ (on session start with provider=openai)
SessionAgentDO reads user's encrypted token → decrypts → passes as OPENAI_ACCESS_TOKEN env
       ↓
vm-agent (index-openai.ts) uses @ai-sdk/openai with the token
```

## Changes

### 1. DB Migration: `0004_openai_auth.sql`

New table for per-user OpenAI OAuth tokens:

```sql
CREATE TABLE openai_tokens (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  encrypted_access_token TEXT NOT NULL,
  encrypted_refresh_token TEXT,
  token_expires_at TEXT,
  refresh_token_expires_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

One row per user (upsert on re-auth). Uses same AES-GCM encryption as GitHub tokens.

### 2. API Routes: `services/api-server/src/routes/auth/`

Add OpenAI OAuth endpoints (similar pattern to GitHub OAuth):

- **`GET /auth/openai`** — Generate OAuth URL with PKCE
  - Create PKCE code_verifier + code_challenge (S256)
  - Store state + code_verifier in `oauth_states` table (reuse existing table, add a `code_verifier` column)
  - Return URL: `https://auth.openai.com/oauth/authorize?client_id=app_EMoamEEZ73f0CkXaXp7hrann&response_type=code&redirect_uri=<callback>&code_challenge=<challenge>&code_challenge_method=S256&state=<state>&scope=openai.responses`

- **`POST /auth/openai/token`** — Exchange code for tokens
  - Validate state, retrieve code_verifier from DB
  - POST to `https://auth.openai.com/oauth/token` with code + code_verifier
  - Encrypt access_token + refresh_token
  - Upsert into `openai_tokens` table
  - Return success status

- **`GET /auth/openai/status`** — Check if user has connected OpenAI (behind authMiddleware)
  - Query `openai_tokens` for current user
  - Return `{ connected: boolean }`

- **`POST /auth/openai/disconnect`** — Remove OpenAI tokens (behind authMiddleware)
  - Delete from `openai_tokens` where user_id = current user

### 3. Update `oauth_states` table

Add `code_verifier` column to existing `oauth_states` table for PKCE support:

```sql
ALTER TABLE oauth_states ADD COLUMN code_verifier TEXT;
```

(Or create this in the new migration. GitHub OAuth doesn't use PKCE so its rows will have NULL here.)

### 4. Shared Types: `packages/shared/src/types/session.ts`

Update `AgentProvider` enum:

```typescript
export const AgentProvider = z.enum(["claude-code", "codex-cli", "openai"]);
```

Keep `codex-cli` for backward compatibility but add `openai` as the direct API option.

### 5. New VM Agent: `packages/vm-agent/src/index-openai.ts`

New entry point using `@ai-sdk/openai` directly:

- Import `createOpenAI` from `@ai-sdk/openai`
- Read `OPENAI_ACCESS_TOKEN` env var
- Create provider: `createOpenAI({ apiKey: token })`
- Use `streamText()` with the Responses API wire format
- Same NDJSON stdin/stdout protocol as other agents
- Model from `OPENAI_MODEL` env var (default: `gpt-5.3-codex`)

This file follows the same structure as `index-aisdk.ts` but is much simpler since
there's no CLI wrapper — just direct API calls.

### 6. Dependencies

- Add `@ai-sdk/openai` to pnpm catalog and vm-agent package.json
- Add build script: `build:openai` for the new bundle
- Update main `build` script to include all three bundles

### 7. Session Agent DO: `session-agent-do.ts`

Update `startAgentOnVM`:

- For `provider === "openai"`:
  - Fetch user's encrypted OpenAI token from D1 via a new helper
  - Decrypt and pass as `OPENAI_ACCESS_TOKEN` env var to VM
  - Use the `vm-agent-openai.bundle.js` bundle
  - Pass model name from session settings

This requires the DO to have access to D1 (it already does via `this.env.DB`).
Need to look up the user's token — requires knowing the user_id.
The user_id is available via `this.state.userId`.

### 8. Web App: OpenAI Connection UI

Add a "Connect OpenAI" button in the web app (settings or session creation):

- `apps/web/hooks/use-openai-auth.ts` — Similar to `use-auth.ts` popup flow
- Button opens popup to `/api/auth/openai` URL
- Callback page exchanges code, sets connected status
- Show connection status in UI (connected/not connected)

### 9. Bundle Type Declarations

Add to `services/api-server/src/types/bundle.d.ts`:

```typescript
declare module "@repo/vm-agent/dist/vm-agent-openai.bundle.js" {
  const content: string;
  export default content;
}
```

## Sequence

1. DB migration (0004)
2. Shared types update (AgentProvider enum)
3. API routes for OpenAI OAuth
4. vm-agent index-openai.ts + dependency + build
5. Session Agent DO updates
6. Bundle declarations
7. Web app hook + UI
8. Build, lint, typecheck

## Open Questions

- **Redirect URI**: The OpenAI OAuth callback URL needs to be registered. We'll use
  `<WORKER_URL>/auth/openai/callback` or route through the web app like GitHub does.
  The Codex CLI uses `http://localhost:port` callbacks, but for a cloud service we need
  a proper callback URL. This may require registering our app with OpenAI.

- **Client ID**: The Codex CLI uses `app_EMoamEEZ73f0CkXaXp7hrann` as a public client.
  We could use this same client ID (it's a public PKCE client, no secret needed), or
  register our own app. Using the Codex client ID is simpler but couples us to their app.

- **Token refresh**: OpenAI OAuth tokens expire. We need refresh logic similar to GitHub
  token refresh in the auth middleware, or refresh on-demand when starting a session.
