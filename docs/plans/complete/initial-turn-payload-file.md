# Plan: Initial Message File

Status: implemented. `SpriteAgentProcessManager.writeInitialMessageFile(...)`
writes the per-turn payload with mode `0600`, `buildAgentArgs(...)` passes
`--initialMessagePath`, and `packages/vm-agent/src/lib/webhook-initial-message.ts`
reads, validates, and unlinks the file. `--initialMessage` still exists as a
vm-agent local fallback, but production spawning uses `--initialMessagePath`.

## Context

Webhook-mode agent turns currently pass the initial user message through sprite exec argv as `--initialMessage`. `SpriteWebsocketSession` encodes exec argv into the request URL, so long prompts or image attachments can exceed URL/request-line limits before the vm-agent process starts.

Move the large initial message out of argv. Keep the small turn control values in argv so the change stays targeted to the payload that can grow with prompt length and attachment data URLs.

## Architecture

Add a per-turn initial-message file written by the API server before spawning the webhook vm-agent.

The API server will:

- write the `AgentInputMessage` JSON under `/home/sprite/.cloude/turns/<uuid>.json`
- use mode `0600` and keep the file outside `/home/sprite/workspace`
- keep settings, agent mode, user message id, optional agent session id, and optional requested model in argv
- pass `--initialMessagePath <path>` instead of `--initialMessage <json>` through sprite exec argv

The vm-agent webhook entrypoint will:

- accept `--initialMessagePath`
- read and parse the file at startup as `AgentInputMessage`
- unlink the file after a successful read
- start the turn using argv metadata plus the file-backed initial message

Keep the old `--initialMessage` path only as a short-term local test fallback if needed, but production spawning should use `--initialMessagePath`.

No database migrations, websocket schema changes, or public API changes are needed.

### Tradeoffs & Other options considered

Stdin was rejected because webhook mode intentionally runs spawn-and-forget with websocket-backed stdin detached. Reintroducing stdin would make startup depend on write ordering, EOF behavior, and websocket lifetime again.

A DO-hosted pull endpoint was also considered. It would avoid temporary files, but it adds another authenticated internal route and a network dependency during vm-agent startup. The API server already writes credential files and the agent script to the sprite before exec, so writing one more scoped payload file fits the existing startup flow.

The temporary file should be treated as required in production. A missing or invalid message file should fail startup loudly rather than falling back to an empty or stale message.

## Testing

- Add or update unit coverage around `SpriteAgentProcessManager` arg construction so `initialMessage` is not present in exec argv and `initialMessagePath` is present.
- Add vm-agent entrypoint coverage or a focused integration test that reads an initial message file, validates it, unlinks it, and queues the initial message.
- Run a local webhook runner test with a long prompt and with an image-like attachment payload.
- Run repo validation: `pnpm build`, `pnpm lint`, and `pnpm typecheck`.
