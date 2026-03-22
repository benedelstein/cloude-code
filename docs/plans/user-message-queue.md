# User Message Queue - Design Document

## Goal

Replace the current single-slot `pendingUserMessage` flow with a durable FIFO user-message queue owned by the session Durable Object.

This change should:

- handle the initial bootstrap message and any later pre-ready messages through the same queueing model
- support accepting additional user messages while the agent is already responding
- make accepted user messages visible to other connected clients immediately
- remove message-sending side effects from `ensureReady()`
- keep ordering, restart behavior, and delivery semantics easy to reason about

## Why We Are Making This Change

The current design grew around one special case: the initial message passed through session init. That led to a `pendingUserMessage` field that is now doing too many jobs.

Today:

- `handleInit` stores an initial pending message until the agent is ready
- `handleChatMessage` sometimes stores a pending message and sometimes sends directly
- `ensureReady()` is not purely about readiness because it also sends the pending message after attach
- only one pending message can exist at a time

That hybrid model works for bootstrap, but it gets awkward once we want broader queue semantics.

The main problems are:

- readiness and message delivery are coupled together in a way that is easy to bypass by accident
- there is no clean path for multiple queued messages
- the sender already has optimistic UI, so the current pending state is no longer buying much for the sending client
- other clients still need a durable, server-owned view of accepted-but-not-yet-delivered user messages
- supporting "send while responding" becomes brittle if some paths enqueue and other paths call the agent directly

The new design fixes this by treating queueing as a first-class server concern instead of a special case hidden behind readiness code.

## Current State

- The web client optimistically appends the sender's own user message immediately.
- The chat input is disabled until the session is ready, so pre-ready websocket sends are mostly a race/fallback case today.
- `pendingUserMessage` is public client state, but it only supports one message.
- `ensureReady()` currently provisions, starts the agent, and sends the pending message as a side effect.
- `operation.cancel` is best-effort and does not currently integrate with any message queue.

## Design

### Core model

Introduce one FIFO queue for accepted user messages. The queue is server-owned and durable.

Every accepted user message follows the same high-level lifecycle:

1. accept the message
2. persist/broadcast it immediately
3. enqueue its delivery metadata
4. drain the queue when the session is ready and idle

This applies to:

- the initial message from `handleInit`
- rare pre-ready websocket `chat.message` requests
- later websocket `chat.message` requests submitted while a response is already in progress

### Separate acceptance from delivery

Split the current "send user message" behavior into two phases.

**Acceptance**

Acceptance happens immediately when the server decides the user message is valid.

It should:

- build the `UIMessage`
- persist it to the message repository immediately
- trigger the existing session-history/title side effects immediately
- broadcast `user.message` to other connected clients immediately
- append queue metadata for later delivery to the agent
- update public queue state so the client can render queued indicators

Acceptance is the durable source of truth that a user message exists in the conversation.

**Delivery**

Delivery is the later act of handing the queue head to the agent process.

It should:

- wait for readiness via `ensureReady()`
- only run when the session is not already responding
- send exactly one queue head at a time
- remove the delivered item from the queue only after the handoff to the agent succeeds
- leave the item queued if delivery fails

This keeps message creation/persistence separate from agent availability.

### Queue storage

Store queue metadata in server-only durable state, not in client-visible state.

Add a server-only queue structure to `ServerState`, for example:

- `queuedUserMessages: { messageId, content, attachmentIds, requestedModel? }[]`

This queue should contain only the data needed to later deliver the message to the agent. The user-visible message itself is already persisted in the normal message history.

### Public client state

Replace `pendingUserMessage` with a lighter public queue view:

- `queuedUserMessageIds: string[]`

These ids represent accepted user messages that have not yet been handed to the agent.

The client will use this to render queued indicators directly on the normal message list. We no longer need a separate pending-message rendering path.

### `ensureReady()` becomes pure

`ensureReady()` should only do readiness work:

- provision the sprite if needed
- clone the repo if needed
- ensure the agent session is started if needed

It should not send queued messages as a side effect.

That responsibility moves to a dedicated queue drain path.

### Single drain path

Add a single queue pump in the Durable Object, guarded by its own mutex/promise collapse, e.g.:

- `kickDrainQueuedMessages()`
- `drainQueuedMessages()`

`drainQueuedMessages()` should:

- return if another drain is already in progress
- return if the queue is empty
- await `ensureReady()`
- return if the session is currently responding
- deliver exactly the queue head
- update `queuedUserMessageIds` after successful handoff

Only this drain path is allowed to hand queued messages to the agent.

That means normal chat handlers should not call the agent process manager directly after this refactor. They should accept/enqueue and then kick the drain path.

### Agent-process-manager boundary

Refactor the current `handleChatMessage` logic in `AgentProcessManager` so there is a method that accepts already-validated queued delivery input:

- content
- attachment ids
- requested model

The DO queue pump should call that one method.

The current websocket-specific `handleChatMessage(payload)` can become a thin wrapper or be removed if it is no longer useful.

### Message ids

Use the existing optional `chat.message.messageId` field as the canonical user-message id when present.

The web client should always send `messageId` equal to the optimistic `UIMessage.id`.

The server should keep backward compatibility by generating a fallback id if a client does not send one.

This keeps sender optimism, persisted history, queue metadata, and queued indicators aligned around one id.

### Visibility and multiplayer behavior

Accepted user messages should be visible to all connected clients immediately, even before they are delivered to the agent.

That means:

- sender keeps its optimistic local message
- other clients receive `user.message` right away
- reconnecting clients see the accepted user message in normal synced history
- queued state is shown via `queuedUserMessageIds`

This is better than the current pending-message model because it makes acceptance durable and shared instead of keeping one unsent message in a special side channel.

### Input and queue UX

The UI should allow sending while a response is in progress.

Concretely:

- keep the input enabled whenever the session is ready and auth/upload constraints allow it
- keep a normal Send action available while the agent is responding
- also show a separate Stop action while a response is active
- render queued user messages inline in the timeline with a lightweight queued indicator such as a clock icon or `Queued` tag

We are not adding a separate queue list or queue count in this pass. The message list remains the main queue UI.

### Cancel behavior

For now, `operation.cancel` keeps simple semantics:

- it aborts the current active response if the agent is connected
- it does not try to restart the agent just to deliver a cancel
- once the abort completes and the session becomes idle again, the next queued message auto-sends

This keeps cancel behavior aligned with FIFO delivery for now.

Add a TODO to revisit this UX later. "Stop" followed by immediate queue continuation may not feel obvious enough, but we are explicitly accepting that tradeoff in this pass to keep the queue model simple.

### Error handling and race conditions

The important invariants are:

- accepted messages are persisted before any attempt to deliver them
- queue ordering is strict FIFO
- only one drain path is active at a time
- only one active agent response exists at a time
- delivery failure leaves the queue intact
- readiness work and queue delivery use separate mutexes

This avoids the main race in the current design, where one path may store a pending message while another path bypasses it and sends directly.

## Files

- `services/api-server/src/durable-objects/session-agent-do.ts` - move to accept/enqueue/drain semantics and remove `pendingUserMessage`
- `services/api-server/src/durable-objects/repositories/server-state-repository.ts` - add durable server-only queue metadata
- `packages/shared/src/types/session.ts` and `packages/shared/src/types/websocket-api.ts` - replace public pending state with queued ids and use canonical client-sent message ids
- `apps/web/hooks/use-cloudflare-agent.ts` and chat UI components - send `messageId`, allow send while responding, and render queued indicators inline

## Test Plan

- Init with an initial message persists the user message immediately and delivers it after readiness completes.
- A websocket `chat.message` received before readiness is accepted, queued, and later delivered once ready.
- A second user message sent while the first response is still running is accepted immediately, marked queued, and auto-sent after the first response completes.
- Multiple queued messages preserve strict FIFO ordering across attach/reconnect races.
- `ensureReady()` no longer sends messages as a hidden side effect.
- Cancel aborts only the active response and does not restart readiness when disconnected.
- After an abort completes, queued messages continue automatically in FIFO order for this pass.
- Delivery failure leaves the queued message durable and still marked queued.
- Sender optimism uses the same `messageId` that the server persists.
- Run `pnpm typecheck`, `pnpm lint`, and `pnpm build`.

## Assumptions

- The current UI still disables pre-ready sends in normal usage, so pre-ready websocket queueing is mostly a fallback/race path.
- Accepted user messages should be visible to all connected clients immediately.
- Queue durability belongs in server-only state; the public client state only needs ids for rendering queued badges.
- `queuedUserMessageIds` represents unsent queued messages only, not the currently active in-flight message.
- We are intentionally keeping "auto-continue after stop" for now and deferring clearer queue/stop UX to a later pass.
