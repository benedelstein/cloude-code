in agent-harness.ts

ensureSetup currently returns false if setup fails, and then the loop continues.
It never reaches onTurnEnd, so the webhook runner never arms idle shutdown and
the heartbeat interval keeps running. Setup failure should be fatal: emit the
error, call a setup-failure callback, and exit the loop.

Keep setup lazy. It should still run only after the first queued message is
claimed, but setup should run once and throw on failure.

```typescript
async function ensureSetup(): Promise<void> {
    if (setupResult) { return; }

    let spriteContext = "";
    try {
        spriteContext = readFileSync("/.sprite/llm.txt", { encoding: "utf-8" }).trim();
    } catch (error) {
        emit({
            type: "debug",
            message:
                "Could not read /.sprite/llm.txt" +
                (error instanceof Error ? error.message : String(error)),
        });
    }

    setupResult = await config.setup({
        emit,
        settings,
        agentMode,
        sessionSuffix,
        args,
        spriteContext,
    });

    emit({ type: "ready" });

    if (setupResult.cleanup) {
        const cleanup = setupResult.cleanup;
        process.on("beforeExit", async () => {
            try {
                await cleanup();
            } catch (error) {
                emit({ type: "debug", message: `Cleanup error: ${String(error)}` });
            }
        });
    }
}

async function runLoop(): Promise<void> {
    while (!stopped) {
        const entry = await consumeUserMessageQueue();
        if (stopped || entry === SHUTDOWN_POISON) { break; }

        // Mark the claimed turn before setup so scoped cancel can still find
        // it after the entry has been shifted out of pendingMessages.
        currentEntry = entry;

        try {
            await ensureSetup();
        } catch (error) {
            emit({ type: "error", error: String(error) });
            stopped = true;
            currentEntry = null;
            await onSetupError?.(error);
            return;
        }

        try {
            if (entry.abortController.signal.aborted) {
                await onTurnEnd?.({ finishReason: "abort", aborted: true });
                continue;
            }

            emit({
                type: "debug",
                message: `processing message: contentLength=${entry.message.content?.length ?? 0}, attachments=${entry.message.attachments?.length ?? 0}`,
            });

            onTurnStart?.(entry.message, entry.turnId);
            const result = await processMessage(entry);
            await onTurnEnd?.(result);
        } catch (error) {
            emit({ type: "error", error: String(error) });
            await onTurnEnd?.({ aborted: false });
        } finally {
            currentEntry = null;
        }
    }
}
```

The setup failure callback must not call harness.shutdown(), because the harness
loop is awaiting the callback. Reuse shutdown code by factoring runner shutdown
into two layers:

- external shutdown owns stopping/canceling the harness first.
- setup failure is already inside the harness loop, so it only runs the shared
  outbound drain and exit layer.

Shared runner drain/exit layer:

```typescript
private async drainOutboundWithDeadline(): Promise<void> {
    const drain = Promise.allSettled([
        this.batcher.flushNow(),
        this.webhookEventHandler.awaitAll(),
    ]).then(() => undefined);
    const deadline = new Promise<void>((resolve) => {
        setTimeout(resolve, SHUTDOWN_DRAIN_TIMEOUT_MS);
    });
    await Promise.race([drain, deadline]);
}

private async finishShutdown(exitCode: number): Promise<void> {
    this.cancelIdleTimer();
    this.cancelHeartbeatInterval();

    await this.drainOutboundWithDeadline();

    this.log("debug", "shutdown complete", { exitCode });
    this.onShutdown(exitCode);
}
```

finishShutdown should not check `this.shuttingDown`. The caller owns setting the
guard before invoking it. If finishShutdown checks the flag itself, both normal
shutdown and setup-failure shutdown can accidentally no-op after setting
`this.shuttingDown = true`.

Startup failure is fatal, but it should still drain gracefully before exiting.
Use exit code 1 after the error event has had a bounded chance to reach the DO.

Normal external shutdown:

```typescript
async shutdown(exitCode = 0): Promise<void> {
    if (this.shuttingDown) { return; }
    this.shuttingDown = true;
    this.log("debug", "shutting down.");

    const canceled = this.harness.cancelTurn();
    if (canceled) {
        this.log("debug", "cancelled in-flight turn");
    }
    await this.harness.shutdown();

    await this.finishShutdown(exitCode);
}
```

Setup-failure shutdown:

```typescript
private async onSetupError(_error: unknown): Promise<void> {
    if (this.shuttingDown) { return; }
    this.shuttingDown = true;
    this.log("debug", "shutting down after setup error.");

    await this.finishShutdown(1);
}
```

Race to note: if an external SIGTERM shutdown starts while ensureSetup is
running, normal shutdown sets `shuttingDown` and waits for the harness loop. If
setup then fails, onSetupError returns early because shutdown is already in
progress. The error event was still emitted before onSetupError, so normal
shutdown should drain it. The resulting exit code may be 0 because external
shutdown won the race; that is acceptable for SIGTERM/process shutdown.

Normal shutdown also needs to await event webhooks. Today shutdown waits for the
harness and chunk batcher, but ready/error/sessionId events are posted
fire-and-forget. Add a small event handler that tracks pending event posts.

```typescript
class WebhookEventHandler {
    private pending = new Set<Promise<void>>();

    constructor(private readonly httpClient: WebhookClient) {}

    post(event: AgentEvent): void {
        const promise = this.httpClient.post("/events", { event });
        this.pending.add(promise);
        void promise
            .catch(() => undefined)
            .finally(() => this.pending.delete(promise));
    }

    async awaitAll(): Promise<void> {
        await Promise.allSettled([...this.pending]);
    }
}
```

Do not clear pending inside awaitAll(). Completed requests remove themselves in
finally, and clearing can hide event posts added while awaitAll() is waiting.
awaitAll() should snapshot the current pending set with `[...this.pending]` and
wait for that snapshot only. Do not loop until the set is empty, because newly
added events or retrying work should not extend shutdown indefinitely.

The `catch(() => undefined)` before `finally` is intentional. WebhookClient
currently resolves after retry exhaustion, but if it ever starts rejecting,
event tracking should not create unhandled promise rejections.

Update WebhookAgentRunner to use the event handler for ready/error/sessionId:

```typescript
case "ready":
case "error":
case "sessionId":
    this.log("debug", "emit event -> /events", { ...output });
    this.webhookEventHandler.post(output);
    return;
```

Because finishShutdown drains outbound events, normal shutdown now also drains
pending event posts after the harness loop exits.

```typescript
await this.harness.shutdown();
await this.finishShutdown(exitCode);
```

Change onShutdown from `() => void` to `(exitCode?: number) => void`, with the
default:

```typescript
this.onShutdown = opts.onShutdown ?? ((exitCode = 0) => process.exit(exitCode));
```

Tests to add:

- agent harness setup failure emits one error, calls onSetupError, exits the
  loop, and does not call onTurnEnd.
- webhook runner setup failure posts the error event and waits for that post
  before calling onShutdown(1).
- normal webhook runner shutdown waits for pending event posts.
- event tracking does not leave unhandled rejections if a tracked event post
  rejects.
- setup failure does not process queued messages after the failed setup.
- shutdown drops queued-but-not-started turns; only the active turn needs
  cancellation/drain because queued turns have not emitted chunks.
