# Discord bot

This repo supports Discord-driven session creation in two pieces:

1. `apps/discord-bot` is a Cloudflare Worker Discord Interactions endpoint.
2. `services/api-server` owns Discord user mapping, repo routing, and session creation.

The bot Worker stays thin: it verifies Discord signatures, acknowledges `/cloude`, calls the API, and edits the original Discord interaction response.

## Current command

```text
/cloude prompt: make a change to the auth in the birthday repo
```

Discord normal `@botname ...` message mentions are not delivered to Interactions endpoints. Those require a Gateway connection. The API endpoint added here is reusable by a future Gateway bot: call `POST /discord/session-requests` with the same payload.

## Routing design

Routing is API-side in `DiscordSessionRequestService`:

1. Map Discord user ID to a Cloude user ID from `DISCORD_USER_MAP_JSON`.
2. Load the mapped user's valid GitHub token from stored Cloude credentials.
3. Enumerate the user's accessible repos from the existing repo listing/cache path.
4. Heuristically rank repos by exact owner/name, repo name, token matches, and description.
5. Fetch README excerpts for top candidates as lightweight RAG context.
6. Ask Claude Haiku to choose one candidate from repo names, descriptions, and README excerpts.
7. Fall back to a strong unique heuristic match, otherwise return candidate repos and ask for a more exact repo hint.
8. Create the session through the existing `SessionsService` with the Discord prompt as the initial message.

## API server configuration

Set these Cloudflare Worker secrets on `services/api-server`:

```bash
cd services/api-server
pnpm wrangler secret put DISCORD_SESSION_REQUEST_TOKEN
pnpm wrangler secret put DISCORD_USER_MAP_JSON
```

`DISCORD_SESSION_REQUEST_TOKEN` must match the bot Worker's `CLOUDE_DISCORD_API_TOKEN`.

`DISCORD_USER_MAP_JSON` maps Discord snowflake user IDs to existing Cloude user UUIDs:

```json
{
  "123456789012345678": "00000000-0000-0000-0000-000000000000"
}
```

## Discord Worker configuration

Set these secrets on `apps/discord-bot`:

```bash
cd apps/discord-bot
pnpm wrangler secret put DISCORD_PUBLIC_KEY
pnpm wrangler secret put CLOUDE_DISCORD_API_TOKEN
```

Deploy:

```bash
pnpm --filter @repo/discord-bot deploy
```

Use the deployed Worker URL as the Discord Interactions Endpoint URL.

## Register the slash command

For fast iteration, register as a guild command:

```bash
cd apps/discord-bot
DISCORD_APPLICATION_ID=... \
DISCORD_BOT_TOKEN=... \
DISCORD_GUILD_ID=... \
pnpm register-command
```

Omit `DISCORD_GUILD_ID` to register globally.
