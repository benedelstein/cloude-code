# Session Access Hardening - Design Document

## Goal

Prevent users from continuing to use a hosted session after they lose GitHub access to the underlying repo, while keeping latency acceptable for soft launch. In the same change, remove server-funded Codex auth fallback so `codex-cli` only works with per-user OpenAI OAuth.

## Current State

- Session creation already verifies repo access using the GitHub App user-access path.
- Existing sessions do not re-check that access later.
- The expensive part of the current check is only on cache miss/expiry; the fast path is the existing `github_user_repo_access_cache`.
- `codex-cli` can still fall back to server-level OpenAI credentials.

## Design

### Re-use the existing access check

Use the same GitHub access-check path used at session creation:
`GitHubAppService.getUserAccessibleInstallationRepoById(...)`

Do not invent a second authorization algorithm. The change is to centralize where this check is called for existing sessions.

### Session metadata

Persist these on the session record:
- `repoId`
- `installationId`
- `revoked_at` (nullable)
- `revoked_reason` (nullable, optional)

These IDs are stable and allow direct cached lookups without name-based resolution.

### Cache policy

Re-use the existing `github_user_repo_access_cache` and its current 5-minute TTL.

"Cached auth result" means the same existing cache entry keyed by:
- `userId`
- `installationId`
- `repoId`

This keeps the hot path fast. The slow GitHub pagination only happens on cache miss/expiry.

### Centralized guard

Create one exported core guard in `lib`, plus:
- one middleware wrapper for session-scoped HTTP routes
- one exported function for DO/websocket/git-proxy code paths

The guard should:
1. Load session metadata
2. Fail fast if the session is already revoked
3. Re-use the existing GitHub access-check method
4. On denial, mark the session revoked and return a stable `403` error such as `REPO_ACCESS_REVOKED`

### Enforcement points

Run the centralized guard on:
- session REST reads (`/sessions/:id`, `/messages`, `/plan`)
- editor routes
- PR routes
- websocket connect
- `chat.message` in the DO
- git proxy push

Do **not** guard websocket-token mint in this pass.

For already-open websockets:
- enforce revocation on the next `chat.message`
- rely on the existing 5-minute cache window for freshness
- do not force a live GitHub call on every send unless the cache is stale

### Revocation behavior

On first detected revoked access:
- mark the session revoked
- return/emit `REPO_ACCESS_REVOKED`
- block all further session reads/writes
- terminate the Sprite

This is a hard-lock model, not read-only fallback.

### Git transport

Do not switch git pull/fetch to the user OAuth token in this pass.

Keep repo transport on the installation-token model and fix authorization at the session layer.

### Codex auth hardening

Remove:
- `env.CODEX_AUTH_JSON` fallback
- `env.OPENAI_API_KEY` fallback

`codex-cli` should only start if the user has stored `openai_tokens`. Otherwise fail with `OPENAI_AUTH_REQUIRED`.

## Test Plan

- Create a session, remove the user's repo access, and verify access still works until the 5-minute cache expires.
- After cache expiry, verify REST session reads fail with `403 REPO_ACCESS_REVOKED`.
- Verify websocket connect is denied after revocation.
- Verify an already-open websocket is blocked on the next `chat.message` after revocation is detected.
- Verify the Sprite is deleted on first revoked-access detection.
- Verify git proxy push is blocked for revoked sessions.
- Verify `codex-cli` without OpenAI OAuth fails with `OPENAI_AUTH_REQUIRED`.
- Verify `codex-cli` with per-user OpenAI OAuth still works.
- Run `pnpm typecheck`, `pnpm lint`, and `pnpm build`.

## Assumptions

- Soft launch: no quota work in this pass.
- No idle cleanup or archive-time Sprite deletion in this pass.
- Re-use the current 5-minute repo-access cache TTL.
- Existing open sockets are cut off on the next guarded send, not instantly at the moment GitHub access changes.
