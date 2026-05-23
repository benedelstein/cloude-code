# Session Access Hardening - Design Document

Status: implemented with naming drift. The current guard is
`assertSessionRepoAccess(...)` in
`services/api-server/src/lib/user-session/session-repo-access.ts`, and blocked
sessions use `access_blocked_at` / `access_block_reason` columns rather than
the `revoked_at` / `revoked_reason` names in this original plan.

## Goal

Prevent users from continuing to use a hosted session after they lose GitHub access to the underlying repo, while keeping latency acceptable.

## Current State

- Session creation already verifies repo access using the GitHub App user-access path.
- Existing sessions now re-check access on guarded HTTP routes, websocket-token mint, websocket connect, `chat.message`, and git-proxy requests.
- The expensive part of the current check is only on cache miss/expiry; the fast path is the existing `github_user_repo_access_cache`.

## Design

### Re-use the existing access check

Use the same GitHub access-check path used at session creation:
`GitHubAppService.getUserAccessibleInstallationRepoById(...)`

Do not invent a second authorization algorithm. The change is to centralize where this check is called for existing sessions.

### Session metadata

Persist these on the session record:

- `repoId`
- `installationId`
- `access_blocked_at` (nullable)
- `access_block_reason` (nullable, optional)

These IDs are stable and allow direct cached lookups without name-based resolution.

### Cache policy

Re-use the existing `github_user_repo_access_cache` and its current 5-minute TTL.

"Cached auth result" means the same existing cache entry keyed by:

- `userId`
- `installationId`
- `repoId`

This keeps the hot path fast. The slow GitHub pagination only happens on cache miss/expiry.

### Centralized guard

Create one exported core guard in `lib`:

- `assertSessionRepoAccess(env, sessionId, userId)`

Keep the plan simple by reusing that one guard from the fewest possible entrypoints instead of adding many wrappers or route-specific checks.

The guard should:

- load the session row from D1
- verify the session belongs to the user
- read `repoId`, `installationId`, `access_blocked_at`, and `access_block_reason`
- use the recovery path when access is already blocked or the installation id is missing
- call `GitHubAppService.getUserAccessibleInstallationRepoById(...)`
- if GitHub explicitly denies repo access, mark the session access-blocked and return a stable `403` error such as `REPO_ACCESS_BLOCKED`
- if the system cannot currently obtain a GitHub user access token for the check, return a temporary auth-required error instead and do not mark the session access-blocked

Use it from only these entrypoints:

- `getAuthorizedSessionAgent(...)` in `services/api-server/src/routes/sessions/sessions.routes.ts`
- websocket connect in `services/api-server/src/routes/agent.routes.ts`
- `chat.message` in `services/api-server/src/durable-objects/session-agent-do.ts`
- DO git-proxy handling in `services/api-server/src/durable-objects/session-agent-do.ts`

### Enforcement points

This gives coverage with minimal surface area:

- all session HTTP routes that already call `getAuthorizedSessionAgent(...)` become guarded automatically
- websocket connect is guarded once in `agent.routes.ts` before the request reaches the DO
- already-open websockets are handled by guarding only `chat.message`
- all git operations flowing through `/git-proxy/*` are handled in one place inside the DO, including pushes initiated by an already-running agent

This avoids spreading the check across every individual route. The existing helper `getAuthorizedSessionAgent(...)` should become the HTTP entrypoint for the centralized guard rather than adding a new check in each route handler.

`POST /sessions/:sessionId/websocket-token` is now guarded. `SessionsService.createSessionWebSocketToken(...)` calls `assertSessionRepoAccess(...)` before minting a token, and `services/api-server/src/routes/agent.routes.ts` repeats the same access check at websocket upgrade.

For already-open websockets:

- enforce access blocking on the next `chat.message`
- rely on the existing 5-minute cache window for freshness
- do not force a live GitHub call on every send unless the cache is stale

### Revocation behavior

On first detected lost access:

- mark the session access-blocked
- return/emit `REPO_ACCESS_BLOCKED`
- block all further session reads/writes
- terminate the Sprite

This is a hard-lock model, not read-only fallback.

Concretely, "mark the session access-blocked" now means:

- use the `access_blocked_at` and `access_block_reason` columns on the `sessions` row in D1
- call repository methods such as `blockSessionForAccessCheckDenied(...)`, `blockSessionsForDeletedInstallation(...)`, `blockSessionsForRemovedRepos(...)`, or `clearAccessBlockAndUpdateBinding(...)`
- call that update on explicit repo-access denial from GitHub; repeated denials should preserve the existing block reason where appropriate

Do not mark the session access-blocked for temporary auth problems such as:

- no active GitHub auth session available to source a user token
- expired or invalid user OAuth state that can be fixed by logging in again

Those cases should fail closed for the current request, but the session should remain recoverable after the user re-authenticates.

After a session has been marked access-blocked:

- every future guard call enters the recovery path when `access_blocked_at IS NOT NULL`, so access can be restored if GitHub confirms the user and installation are valid again
- session HTTP routes fail because `getAuthorizedSessionAgent(...)` now runs the guard
- websocket connect fails in `agent.routes.ts`
- an already-open websocket fails on the next guarded `chat.message`
- the DO `/git-proxy/`* handler returns `403 REPO_ACCESS_BLOCKED` and does not forward the git operation to GitHub

This is what prevents further access in practice:

- the D1 session row is the durable source of truth for access-blocked state, so guarded entrypoints deny access while recovery checks still fail
- websocket-token mint is guarded directly by `SessionsService.createSessionWebSocketToken(...)`, and websocket connect is still guard-protected
- the DO still checks on `chat.message`, so an already-connected client cannot continue using the session after lost access is detected
- the agent's git push path is still blocked even if the agent keeps running briefly, because push is configured to go through the Worker/DO git proxy and that proxy now checks the same access-blocked state before forwarding
- Sprite termination is best-effort cleanup after access is blocked; the durable lock is the `access_blocked_at` check, not successful Sprite deletion

Recommended implementation detail:

- have the core guard return a structured result that distinguishes `SESSION_NOT_FOUND`, `REPO_ACCESS_BLOCKED`, `GITHUB_AUTH_REQUIRED`, `GITHUB_API_ERROR`, and `INVALID_REPO`
- for first detected lost access, persist the access block on the session row, request Sprite cleanup, then return the stable authorization failure
- for an already-blocked session, use the recovery path and clear the block if GitHub confirms access again
- for `GITHUB_AUTH_REQUIRED`, return a temporary auth failure and skip access-block writes

It is reasonable for the DO to also mirror access-blocked state in memory after it observes a blocked result. That is only an optimization for the current DO instance, not a source of truth. The durable source of truth should remain the D1 session row so that blocked access survives DO restarts and applies consistently across HTTP routes, websocket connect, and future DO instances.

### Agent still running after access is blocked

The access block must still hold even if the agent process continues running for a short period after access is lost.

The important case is git push:

- the agent's push remote is already configured to use the Worker git-proxy URL for `origin --push`
- that means any later `git push` from the sprite still flows through the session DO
- once the session is marked access-blocked, the DO `/git-proxy/*` entrypoint must reject the request before forwarding it to GitHub

This means the system does not rely on immediate Sprite deletion for correctness. Sprite deletion is cleanup. The real enforcement is:

- D1 `access_blocked_at` for durable state
- DO `chat.message` guard for interactive use
- DO `/git-proxy/*` guard for background git activity from the agent

### Git transport

Do not switch git pull/fetch to the user OAuth token in this pass.

Keep repo transport on the installation-token model and fix authorization at the session layer.

## Test Plan

- Create a session, remove the user's repo access, and verify access still works until the 5-minute cache expires.
- After cache expiry, verify REST session reads fail with `403 REPO_ACCESS_BLOCKED`.
- Verify websocket-token mint and websocket connect are denied after access is blocked.
- Verify an already-open websocket is blocked on the next `chat.message` after lost access is detected.
- Verify the Sprite cleanup path is requested on first blocked-access detection.
- Verify git proxy push is blocked for access-blocked sessions.
- Verify `codex-cli` without OpenAI OAuth fails with `OPENAI_AUTH_REQUIRED`.
- Verify `codex-cli` with per-user OpenAI OAuth still works.
- Run `pnpm typecheck`, `pnpm lint`, and `pnpm build`.

## Assumptions

- Soft launch: no quota work in this pass.
- No idle cleanup or archive-time Sprite deletion in this pass.
- Re-use the current 5-minute repo-access cache TTL.
- Existing open sockets are cut off on the next guarded send, not instantly at the moment GitHub access changes.
