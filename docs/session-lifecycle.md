# Session Lifecycle

How a `SessionAgentDO` moves from creation to ready, how it handles restarts, and where to look when it's wedged.

For per-turn details (RPC surface, chunk serialization, crash recovery inside a turn) see `docs/turn-workflow.md`. This doc covers the surrounding DO state machine.

## Status values

Defined in `packages/shared/src/types/session.ts`:

| Status | Meaning |
|---|---|
| `initializing` | DO constructor ran but `handleInit` not yet called. Pre-provisioning. |
| `provisioning` | `SessionProvisionService` is requesting a Sprite VM and waiting for it to boot. |
| `cloning` | Sprite is up; cloning the repo onto the sprite's disk. |
| `attaching` | After DO restart: reattaching to an existing sprite and agent process. |
| `ready` | Fully connected; can accept chat messages. |

`status` lives on `ClientState` and is **synthesized from `ServerState` checkpoints on every DO instantiation** — it is reset on restart so it can't get stuck. See `session-agent-derived-state.ts`.

## Happy path (new session)

```
Client POST /sessions ─▶ sessions.service creates D1 row, returns sessionId
Client WS /agents/session/:id ─▶ Hono upgrades ─▶ SessionAgentDO.fetch
  │
  DO constructor: ClientState.status = "initializing" (resets any stale restart state)
  │
  handleInit (first ws connect):
    SessionProvisionService.start()
      status = "provisioning"  ─▶ WorkersSpriteClient.create(spriteName)
      status = "cloning"       ─▶ git clone via git-proxy token
      status = "ready"         ─▶ write vm-agent bundle to sprite, record readiness
  │
  First chat.message from client:
    SessionChatDispatchService.dispatch()
      MessageRepository.create(userMessage)
      serverState.activeUserMessageId = id
      AgentWorkflowCoordinator.dispatchTurn() ─▶ runWorkflow(...) (new SessionTurnWorkflow)
```

The workflow then runs per `docs/turn-workflow.md` — `prepareWorkflowTurn` RPC, `AgentProcessRunner` spawn, NDJSON stream, chunk forwarding.

## Restart path (DO evicted, same sprite alive)

A DO is evicted after inactivity. The sprite and `vm-agent` process may still be alive.

```
Client reconnects WS ─▶ new DO instance
  │
  DO constructor:
    ClientState.status = "initializing" (reset)
    serverState loaded from SQLite ─▶ has spriteName + agent session id
  │
  handleInit:
    status = "attaching"
    SessionProvisionService.reattach(spriteName)
      - ping sprite health
      - if sprite dead → fall back to provisioning a fresh one (status = "provisioning" again)
    status = "ready"
  │
  AgentWorkflowCoordinator.reconcile()
    - if there's a live workflow instance id → resume subscription to its events
    - if workflow is dead and there's an unfinished user message → redispatch turn
    - rehydrate MessageAccumulator from pending_message_chunks
```

## Durable state (what survives a DO restart)

Stored in the DO's SQLite (per session):

- `messages` — full chat history (`message-repository.ts`)
- `pending_message_chunks` — UIMessageChunks not yet assembled into a final message (`pending-chunk-repository.ts`)
- `server_state` — single row with: `activeUserMessageId`, `activeAgentProcessId`, `spriteName`, `agentSessionId`, last workflow instance id, provisioning errors, pushed branch, baseBranch, PR info (`server-state-repository.ts`)
- `secrets` — encrypted per-session secrets (`secret-repository.ts`)
- `latest_plan` — most recent structured plan from the plan tool (`latest-plan-repository.ts`)

Stored in D1 (cross-session, global):

- `sessions` row (owner, repo, archived, title, timestamps)
- Users, installations, OAuth state, per-user encrypted provider credentials — see `docs/api-server-map.md` for the full list.

## Fields that are intentionally reset on restart

In `ClientState`:

- `status` — recomputed from `ServerState`
- `lastError` — cleared so old errors don't stick
- `pendingUserMessage` — derived from `activeUserMessageId` + unfinished chunks

See the comment block on `ClientState` in `packages/shared/src/types/session.ts`.

## Access blocks

A session can be blocked at runtime (GitHub installation deleted, repo removed, etc.). `SessionAccessBlockReason` enumerates the causes. Enforced by `session-access-block.ts` on every message dispatch and WS connect. A blocked session surfaces to the client via `session.status` with a human-readable message.

## Provider connection state

`SessionProviderConnectionService` computes `ClientState.providerConnection` per the session's fixed provider. States:

- `connected: true` — credentials valid, ready to run turns
- `connected: false, requiresReauth: false` — user never connected this provider
- `connected: false, requiresReauth: true` — token expired or revoked; user must reauth

If a turn starts while disconnected, the DO emits a provider-specific error rather than spinning up the VM.

## When a session is stuck

Most common causes and where to look:

1. **`status` stuck at `provisioning`** — check `ServerState.lastError` and the worker logs for `SessionProvisionService`. Sprite may have failed to boot.
2. **`status` stuck at `cloning`** — git-proxy token rejected, or the installation lost access to the repo. Check `SessionAccessBlockReason` and `github-app.ts` logs.
3. **Status is `ready` but messages don't stream** — Workflow may be dead. Check `AgentWorkflowCoordinator` logs for the latest workflow instance id. A new dispatch should mint a fresh workflow (we never reuse a dead one).
4. **Stuck as `syncing` after restart** — known open bug (see `Todos.md`). The `pending_message_chunks` rehydration can miss a cancel signal if the agent process PID rotated. Manual fix: send cancel, wait, send a new message.

Runtime mitigations:

- `scripts/destroy-session-sprites.sh` — force-kill the sprite
- `scripts/kill-sprite-processes.ts` — kill just the agent process, keep the sprite
