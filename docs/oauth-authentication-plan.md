# OAuth Authentication for Claude Code: Research and Plan

## TL;DR

**Anthropic OAuth is not viable for third-party use.** As of February 2026, Anthropic explicitly bans using Claude subscription OAuth tokens in any third-party product, including services that run the official `claude` binary. The recommended alternative is **per-user API keys** where each user provides their own Anthropic Console API key.

## Background

### Current Architecture

cloude-code uses a single server-wide `ANTHROPIC_API_KEY` (Cloudflare Workers secret) that is:
1. Passed to Sprite VMs as an environment variable for the `claude` CLI process
2. Used directly by the API server for session title generation via `@ai-sdk/anthropic`

The credential flow:
```
Cloudflare Secret (ANTHROPIC_API_KEY)
  → SessionAgentDO.env.ANTHROPIC_API_KEY
    → Sprite VM environment variable
      → vm-agent process.env.ANTHROPIC_API_KEY
        → createClaudeCode() provider env config
          → claude CLI binary uses it for API calls
```

Key files involved:
- `services/api-server/src/types.ts:15` — Env type definition
- `services/api-server/src/durable-objects/session-agent-do.ts:640` — Passed to Sprite env
- `services/api-server/src/lib/generate-session-title.ts:55` — Used for title generation
- `packages/vm-agent/src/index-aisdk.ts:143-146` — Injected into claude provider env

### Why OAuth Won't Work

The `claude` binary on the VM does support OAuth via `claude auth login`. However, Anthropic's updated policy (February 19, 2026) states:

> "OAuth authentication (used with Free, Pro, and Max plans) is intended exclusively for Claude Code and Claude.ai. Using OAuth tokens obtained through Claude Free, Pro, or Max accounts in any other product, tool, or service — including the Agent SDK — is not permitted."

This policy covers cloude-code even though it runs the real `claude` binary, because cloude-code is a separate product running Claude Code on behalf of users. Enforcement has been aggressive — tools with 56k+ GitHub stars were forced to remove OAuth support after legal requests. Users were banned within minutes.

**Exception:** The policy includes "unless previously approved" — direct partnership with Anthropic could potentially unlock this.

## Recommended Approach: Per-User API Keys

Users provide their own Anthropic Console API key during account setup. Keys are stored encrypted (AES-GCM, same as GitHub tokens) and used per-session.

### Benefits
- Follows Anthropic's sanctioned authentication method
- Usage billing is per-user (no shared cost concerns)
- Leverages existing encrypted token storage infrastructure
- Each user controls their own rate limits and spending

### Implementation Plan

#### Phase 1: Database and Storage

**New migration** (`services/api-server/migrations/XXXX_anthropic_keys.sql`):
```sql
CREATE TABLE user_api_keys (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL DEFAULT 'anthropic',  -- future: 'bedrock', 'vertex'
  encrypted_key TEXT NOT NULL,
  label TEXT,  -- user-friendly name like "My API Key"
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, provider)
);
```

This reuses the existing `crypto.ts` encryption (AES-GCM with `TOKEN_ENCRYPTION_KEY`).

#### Phase 2: API Endpoints

**New routes** in `services/api-server/src/routes/`:

```
PUT  /api/user/api-keys/:provider   — Store/update an encrypted API key
GET  /api/user/api-keys              — List configured providers (no key values)
DELETE /api/user/api-keys/:provider  — Remove a stored key
POST /api/user/api-keys/:provider/verify — Validate key works (test API call)
```

The key is encrypted before storage and never returned in plaintext to the client. The `GET` endpoint returns only metadata (provider, label, created_at).

#### Phase 3: Session Credential Flow

**Modify `session-agent-do.ts`** to resolve the API key per-session:

```typescript
// Before starting the sprite agent, resolve the user's API key
private async resolveAnthropicApiKey(userId: string): Promise<string> {
  // 1. Check for user's personal API key
  const userKey = await this.getUserApiKey(userId, 'anthropic');
  if (userKey) return userKey;

  // 2. Fall back to server-wide key (for admin/internal use)
  if (this.env.ANTHROPIC_API_KEY) return this.env.ANTHROPIC_API_KEY;

  throw new Error('No Anthropic API key configured');
}
```

Update the sprite env setup at line 640:
```typescript
env: {
  ANTHROPIC_API_KEY: await this.resolveAnthropicApiKey(userId),
  SESSION_ID: this.state.sessionId ?? "",
},
```

Update `generateSessionTitle` calls to use the resolved key.

#### Phase 4: Frontend Integration

Add a settings page/modal where users can:
1. Enter their Anthropic API key
2. See a masked preview of configured keys
3. Test the key validity
4. Remove/rotate keys

#### Phase 5 (Future): Cloud Provider Support

Extend `user_api_keys` to support additional providers:

| Provider | Required Credentials | VM Environment Variables |
|----------|---------------------|-------------------------|
| `anthropic` | API key | `ANTHROPIC_API_KEY` |
| `bedrock` | Access key + secret + region | `CLAUDE_CODE_USE_BEDROCK=1`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION` |
| `vertex` | Service account JSON + project + region | `CLAUDE_CODE_USE_VERTEX=1`, `GOOGLE_APPLICATION_CREDENTIALS`, `CLOUD_ML_REGION` |

### Security Considerations

1. **Keys never exposed to clients** — Only metadata returned via API; decryption happens server-side
2. **Per-session decryption** — Keys decrypted only when starting a session, not cached in memory
3. **Encryption at rest** — Same AES-GCM encryption used for GitHub tokens
4. **VM isolation** — Keys are only in the Sprite VM's environment, not persisted to disk
5. **Key validation** — Test key validity before storing to catch typos
6. **Audit logging** — Log key usage (not values) for debugging

### Files to Modify

| File | Change |
|------|--------|
| `services/api-server/migrations/XXXX_anthropic_keys.sql` | New migration for `user_api_keys` table |
| `services/api-server/src/types.ts` | Make `ANTHROPIC_API_KEY` optional in Env |
| `services/api-server/src/durable-objects/session-agent-do.ts` | Resolve per-user key, pass to sprite |
| `services/api-server/src/lib/generate-session-title.ts` | Accept key from caller (already does) |
| `services/api-server/src/routes/sessions/sessions.routes.ts` | Pass user's key to title generation |
| `services/api-server/src/routes/` | New `api-keys.routes.ts` for CRUD endpoints |
| `apps/web/` | Settings UI for API key management |
| `packages/shared/src/types/` | Types for API key management messages |

### Migration Path

1. Deploy with server-wide `ANTHROPIC_API_KEY` still working (backward compatible)
2. Add per-user key support as an override
3. Once all users have configured keys, make server key optional
4. Eventually remove server-wide key if desired

## Sources

- [Anthropic bans subscription OAuth in third-party apps (WinBuzzer)](https://winbuzzer.com/2026/02/19/anthropic-bans-claude-subscription-oauth-in-third-party-apps-xcxwbn/)
- [Anthropic locks down Claude Code OAuth (Awesome Agents)](https://awesomeagents.ai/news/claude-code-oauth-policy-third-party-crackdown/)
- [Claude Code Authentication Docs](https://code.claude.com/docs/en/authentication)
