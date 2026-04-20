# VM Agent

The `@repo/vm-agent` package is the Bun process that runs inside the Sprite VM and drives the model. It's spawned by `AgentProcessRunner` (inside `SessionTurnWorkflow`) with a single `--provider` flag and speaks NDJSON over stdin/stdout.

## Process model

```
api-server / Workflow                        Sprite VM
─────────────────────                        ─────────
AgentProcessRunner ── spawns ──▶ bun run vm-agent.bundle.js --provider '<json>' --sessionId <id> --agentMode <edit|plan>
                                             │
                         stdin NDJSON  ──────▶│  runAgentHarness loop
                         stdout NDJSON ◀──────│
```

- One process per turn. The Workflow kills and respawns between turns as needed.
- Entry point: `packages/vm-agent/src/index.ts`. It parses `--provider`, validates with `AgentSettings` (Zod), and dispatches into `runAgentHarness(providerConfig, settings)`.
- Harness: `packages/vm-agent/src/agent-harness.ts`. Owns the message queue, abort controller, and the `streamText` loop.

## Wire format

All types live in `packages/shared/src/types/vm-agent.ts`. Do not hand-roll JSON.

### Input (stdin, api-server → agent)

Discriminated union `AgentInput` on `type`:

| `type` | Payload | Meaning |
|---|---|---|
| `"chat"` | `{ message, model?, agentMode? }` | New user turn. `model` / `agentMode` hot-swap before processing. |
| `"cancel"` | `{}` | Abort the current `streamText` call via `AbortController`. |
| `"resume"` | `{ sessionId }` | Currently returns an error — resumption is done via the `--sessionId` startup flag, not stdin. |

Every line is one JSON object. Use `encodeAgentInput` / `decodeAgentInput` from `@repo/shared`.

### Output (stdout, agent → api-server)

Discriminated union `AgentOutput` on `type`:

| `type` | Payload | Meaning |
|---|---|---|
| `"ready"` | `{}` | Provider setup complete; safe to send `chat`. |
| `"stream"` | `{ chunk: UIMessageChunk }` | One AI SDK UI message chunk. Forward to client. |
| `"heartbeat"` | `{}` | Emitted every 15s while a turn is active. Keeps the Workflow socket alive. |
| `"debug"` | `{ message }` | Diagnostic log line. |
| `"sessionId"` | `{ sessionId }` | Claude provider session id (for resuming). Persisted by the DO. |
| `"error"` | `{ error }` | Fatal or turn-level error. |

Emit via `process.stdout.write(encodeAgentOutput(o) + "\n")` (the harness wraps this as `emit`).

## Adding a provider

A provider is an object implementing `AgentProviderConfig<S>` in `packages/vm-agent/src/agent-harness.ts`:

```ts
interface AgentProviderConfig<S extends AgentSettings> {
  setup(ctx: ProviderSetupContext<S>): Promise<SetupResult<S["model"]>>;
}
```

`setup` returns `{ modelId, getModel, getStreamTextExtras?, cleanup? }`. The harness calls `getModel(modelId, { agentMode })` per turn, passes any `providerOptions` / `onStepFinish` from `getStreamTextExtras`, and runs `streamText`. The provider never owns the stdin loop or the abort controller.

Steps to add a new provider (e.g. `gemini`):

1. Extend the `ProviderId` enum and `AgentSettings` union in `packages/shared/src/types/providers/`. Add per-provider Zod schemas for `model` / options.
2. Create `packages/vm-agent/src/providers/gemini.ts` exporting a `geminiProvider: AgentProviderConfig<GeminiSettings>`.
3. Add a `case "gemini":` in the switch in `packages/vm-agent/src/index.ts`.
4. On the DO side, wire the provider into `SessionProvisionService` / `AgentProcessRunner` so credentials are passed in as env vars (see how `claude-code` / `openai-codex` do it). Store credentials encrypted per user via `UserProviderCredentialRepository` if OAuth-based.
5. Rebuild: `pnpm --filter @repo/vm-agent build`. The bundled JS is imported as a text module by the worker and written onto the sprite at runtime.

Exhaustiveness is enforced by TypeScript in `index.ts`'s switch — omitting a case fails the build.

## Sprite context

On startup the harness reads `/.sprite/llm.txt` from the VM and hands it to the provider via `ProviderSetupContext.spriteContext`. Providers splice it into the system prompt. See `packages/vm-agent/src/system-prompt.ts` for the default prompt structure.

## Agent mode

`AgentMode` is `"edit" | "plan"` (`packages/shared/src/types/session.ts`). Providers decide what this means — typically plan mode disables file-mutating tools. Mode can be switched at the start of any turn via the `chat` input's `agentMode` field; the harness updates internal state before `streamText`.

## Cancellation

`AgentProcessRunner` writes `{ type: "cancel" }` when the client cancels. The harness calls `currentAbortController.abort()`, which surfaces as an `AbortError` in the `streamText` loop and is emitted as a `finish` chunk with `finishReason: "abort"`. The process stays alive and waits for the next `chat`.

## Local smoke test

```bash
cd packages/vm-agent
bun run src/test-agent-aisdk.ts
```

Uses the same harness wiring but talks to stdin/stdout in your terminal.
