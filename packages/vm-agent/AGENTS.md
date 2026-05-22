# VM Agent

Runs inside the Sprite VM using Bun. Shared protocol types live in `@repo/shared`.

## Map

- `src/index-webhook.ts` - current production entrypoint; file-based initial turn plus DO webhooks.
- `src/index-ndjson.ts` - legacy stdin/stdout NDJSON entrypoint.
- `src/lib/agent-harness.ts` - shared AI SDK harness for queueing, cancellation, and `streamText`.
- `src/webhook-agent-runner.ts` - webhook-mode lifecycle around the harness.
- `src/providers/` - Claude Code and OpenAI Codex adapters.
- `src/lib/chunk-batcher.ts` - batches streamed chunks for webhook delivery.
- `src/lib/webhook-*.ts` - webhook client, stdin, and initial-message helpers.

## Commands

```bash
pnpm build
pnpm test
pnpm lint
pnpm typecheck
```
