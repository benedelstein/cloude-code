# Agent DO State Refactoring

## Problem

Currently the session-agent-do state is a mess. The file is 1500+ lines, there are states strewn all over the place, and there is unclear state transitioning logic. 
It is incredibly bug-prone.

Moreover, instance-specific state is persisted to Sqlite, which survives restarts. This can cause issues where the vm state is corrupted and cannot be recovered.
i.e. 
1) set some state,
2) initiate some task where the state acts as a guard 
3) the DO restarts (due to a deploy or hibernation),
4) and then we try to recover, but the state is stuck and prevents retrying.

For example, we previously set the state to attaching when trying to reconnect to the agent,
and blocked further reconnects if the state was not `ready`. Then if the attach did not complete when the DO died/restarted,
and we tried to reconnect when a new instance was awakened, the state would be stuck as `attaching` even though no attach call was being performed. So we could not recover. 

### State Partitioning

Some state is instance-specific, and some state is meant to be persisted. 

Examples of persisted state (safe across object restarts):
- settings (agent provider and model)
- pushedBranch 
- todos
- sessionId, userId, repoFullName
- pendingUserMessage - if do restarts, we still want to send the message after.


Examples of memory-only state:
- status
- claudeAuthRequired
- messageAccumulator
- pendingChunks
- agentWebsocketSession

If we don't use memory-only state, we have to handle resetting these values on restart. The sync is challenging.

The other challenging part is that AgentState is both persistent and automatically propagated to clients. (This is handled by the Agent class internally).
The auto-propagation is nice, but we don't necessarily always want to persist it across do restarts.


### Agent process

The agent process running on the sprite is currently identified by `state.agentProcessId`.
If the DO restarts, we lose our connection to that process. Even if one currently is running on the sprite, we should just start a new process
and orphan or kill the old one. It doesn't matter and is simpler. 

So state.agentProcessId isn't really relevant anymore, execpt for cleaning up old processes. We could rename it to `lastKnownAgentProcessId` to make this explicit.


### Status

`status` is kind of a catch-all for multiple DO statuses. 
- The VM agent status
- The sprite startup status

We also have a generic `error` status that is impossible to recover from.

Is there a way to make this more granular?

Given that status should probably be memory-only, we need a way to propagate it to the client. We can rely on the `agent.status` websocket message for this?

### AgentState flat fields

We have a lot of flat fields like `pullRequestUrl`, `pullRequestNumber`, `pullRequestState`, `pendingUserMessage`, `pendingAttachmentIds`

Would be better to refactor some of these like:

```typescript
{
    pullRequest?: {
        url: string;
        number: number;
        state: PullRequestState;
    }
    // ...
}
```

### Startup scripts

The DO needs to go through several steps before it is ready to serve messages.

1) Create the sprite 
2) Generate a git proxy secret
3) Provision the sprite
    a) Clone the repo
    b) Set up git config
    c) Start the agent
4) Send the pending user message, if any

This is made more challenging by the fact that several client requests come in in short succession, and the state provisioning is not synchronous.

In the http create request, we create the sprite and kick off asynchronous provisioning, returning to the client. 
The client then connects to the websocket, but cannot send messages until the async provisioning is complete.

The durable object acts like a stateful server, but it can hibernate after a while.

## Solution

**AgentState should only include durable data that can survive restarts.**
- lastKnownAgentProcessId - safe to persists because it is named as "last known", not current.
- sessionId, userId, repo info
- settings
- pr stuff
- todos
- plan
- pending message

**Memory-only state for vm agent coordination.**
- isResponding
- agentWebsocketSession
- agent provider auth state

** Consider what status checkpoints are really needed and how to represent them**
1. Sprite created
2. repo cloned.
3. Session terminated. 

1. Agent credentials fetched. 
2. Agent Started. 
3. Agent ready for traffic.
4. Agent killed.

Error states - how to recover? 

**server-only visible state**
all AgentState is propagated to the client. 
There are some fields we don't care to propagate
- agentProcessId
- agentSessionId

```typescript
type ServerState = {
    /** set after the init method is complete */
    initialized: boolean;
    sessionId: string;
    spriteCreated: boolean;
    repoCloned: boolean;
    lastKnownAgentProcessId: number | null;
}

// visible to both client and server, but only the server can set it.
type ClientState = {
    settings: SessionSettings;
    repoFullName: string | null;
    /** Detected base branch afer clone */
    baseBranch: string | null;
    // these fields are only set so they can be sent to the client using the agent syntax sugar. 
    // they will be reset when the DO restarts. 
    lastError: string | null;
    /** not an authoritative status. just for the client to display. */
    status: AgentStatus; // synthesized from both provisioningStatus and agentConnectionStatus
    claudeAuthRequired: ClaudeAuthState | null;
}

class SessionAgentDO extends Agent<Env, ClientState> {
    // ...
    private readonly ServerStateRepository: ServerStateRepository;
    private agentWebsocketSession: SpriteWebsocketSession | null = null;
    private messageAccumulator: MessageAccumulator;
    private pendingChunks: UIMessageChunk[];
    private isResponding: boolean;
    private ensureReadyPromise: Promise<void> | null = null;
    // private agentConnectionStatus: "connecting" | "connected" | "disconnected";
    // private provisioningStatus: "provisioning" | "provisioned" | "error";
    private ServerState: ServerState;

    constructor(ctx: DurableObjectState, env: Env, logger: Logger) {
        super(ctx, env);
        // ...
        this.serverState = this.ctx.storage.get("serverState") ?? {
            spriteCreated: false,
            repoCloned: false,
            baseBranch: null,
        };
        // calculate synthesized client states from server state.
        this.updatePartialState({
            status: this.synthesizeStatus(),
            lastError: null,
            claudeAuthRequired: null
        });
    }

    onConnect(connection: Connection): void {
        super.onConnect(connection);
        // Always call ensureReady - it skips completed steps via serverState checkpoints.
        // Handles both first-time provisioning (if handleInit hasn't finished yet) and reattach.
        ctx.waitUntil(this.ensureReady());
    }

    private synthesizeStatus(): AgentStatus {
        if (!this.serverState.initialized) {
            return "initializing";
        }
        if (!this.serverState.spriteCreated) {
            return "provisioning";
        }
        if (!this.serverState.repoCloned) {
            return "cloning";
        }
        if (!this.agentWebsocketSession.isConnected) {
            return "connecting";
        }
        return "ready";
    }

    // Single entry point for getting the session to a ready state.
    // Called by both handleInit (HTTP) and onConnect (WebSocket).
    // Uses a mutex so concurrent callers share one in-flight operation.
    // Each step is idempotent - skipped if already completed via serverState checkpoints.
    ensureReady(): Promise<void> {
        if (this.ensureReadyPromise) return this.ensureReadyPromise;
        this.ensureReadyPromise = this._ensureReady().finally(() => {
            this.ensureReadyPromise = null;
        });
        return this.ensureReadyPromise;
    }

    private async _ensureReady(): Promise<void> {
        if (this.serverState.terminated) throw new Error("Session terminated");

        if (!this.serverState.spriteCreated) {
            // create sprite...
            this.updatePartialState({ status: this.synthesizeStatus() });
            this.updateServerState({ spriteCreated: true });
        }

        if (!this.serverState.repoCloned) {
            // clone repo...
            this.updatePartialState({ status: this.synthesizeStatus() });
            this.updateServerState({ repoCloned: true });
        }

        // start/reattach agent - same flow for both first-time and reattach.
        if (!this.agentWebsocketSession?.isConnected) {
            this.updatePartialState({ status: this.synthesizeStatus() });
            await this._startAgent();
            this.updatePartialState({ status: this.synthesizeStatus() });
        }
    }

    private async _startAgent(): Promise<void> {
        // one flow for both starting and reattaching the agent.
    }
}
```

We'll create a new sqlite table and repository for this with similar api to updateState. just a json blob that we write to in storage and decode from.

```typescript
export class ServerStateRepository implements Repository {
    constructor(private sql: SqlFn) {}

    migrate(): void {
        this.sql`CREATE TABLE IF NOT EXISTS server_state (
            id TEXT PRIMARY KEY NOT NULL,
            state TEXT NOT NULL DEFAULT '{}'
        )`;
    }

    update(state: ServerState): void {
        this.sql`INSERT OR REPLACE INTO server_state (id, state) VALUES ('state', ${JSON.stringify(state)})`;
    }

    get(): ServerState | null {
        const rows = this.sql`SELECT state FROM server_state WHERE id = 'state'`;
        if (!rows[0]?.state) return null;
        return JSON.parse(rows[0].state);
    }
}
```

We need to disallow clients from calling setState on AgentState - its currently exposed. [DONE]


### File Separation

The DO file cannot be 1k+ lines. It needs to be manageable.

We need to extract out certain logic into separate files. 

Unfortunately we can't extend the class (like swift) into multiple files, so we have to pass scoped context into these files. 

`src/durable-objects/lib`

```typescript
// src/durable-objects/lib/agent-process-manager.ts
export class AgentProcessManager {
    // manages the websocket session
    private readonly logger: Logger;
    private readonly env: Env;
    private readonly spritesCoordinator: SpritesCoordinator;
    private readonly messageAccumulator: MessageAccumulator;
    agentWebsocketSession: SpriteWebsocketSession | null = null; // can this be shared with the DO? 

    async startAgentSession(session: SpriteWebsocketSession): Promise<void> {
        // ...
        this.agentWebsocketSession = sprite.createSession("env", commands, {
            cwd: WORKSPACE_DIR,
            tty: false,
            env: baseEnv,
        });

        this.setupAgentSessionHandlers(this.agentWebsocketSession!);
        await this.agentWebsocketSession.start();
    }

    private handleAgentStdout(data: string): void {
        // ...
    }

    private handleAgentServerMessage(msg: SpriteServerMessage): void {
        // ...
    }
}

// ...
{
    // .. inside session-agent-do.ts
    private readonly agentProcessManager: AgentProcessManager;

    private startAgentSession(): Promise<void> {
        return this.agentProcessManager.startAgentSession(this.agentWebsocketSession!);
    }
}
```