# Discord bot

This repo supports Discord-driven session creation in two pieces:

1. `apps/discord-bot` is a Cloudflare Worker Discord Interactions endpoint.
2. `services/api-server` owns Discord account linking, repo routing, and session creation.

The bot Worker stays thin: it verifies Discord signatures, acknowledges `/cloude`, calls the API, and edits the original Discord interaction response.

## Current command

```text
/cloude prompt: make a change to the auth in the birthday repo
```

Discord normal `@botname ...` message mentions are not delivered to Interactions endpoints. Those require a Gateway connection. The API endpoint added here is reusable by a future Gateway bot: call `POST /discord/session-requests` with the same payload.

## Account linking

Discord users are linked to Cloude users with short-lived, single-use link attempts:

1. A Discord user runs `/cloude`.
2. The bot calls `POST /discord/session-requests` with the Discord user ID and prompt.
3. If the Discord account is not linked, the API creates a 15-minute link attempt and returns `linkUrl`.
4. The bot replies with that link.
5. The user opens `/discord/link?token=...` in the web app.
6. If needed, the user signs in through the existing GitHub OAuth flow.
7. The web app calls `POST /discord/link/claim` with the token.
8. The API consumes the link attempt and stores a Discord account link for the signed-in Cloude user.

Permanent links expire after 90 days. Once expired, the next Discord request creates a fresh link URL and asks the user to reconnect. Link attempts store only a SHA-256 token hash.

## Routing design

Routing is API-side in `DiscordSessionRequestService`:

1. Resolve Discord user ID to an active, unexpired Cloude account link.
2. Load the linked user's valid GitHub token from stored Cloude credentials.
3. Enumerate the user's accessible repos from the existing repo listing/cache path.
4. Heuristically rank repos by exact owner/name, repo name, token matches, and description.
5. Fetch README excerpts for top candidates as lightweight RAG context.
6. Ask Claude Haiku to choose one candidate from repo names, descriptions, and README excerpts.
7. Fall back to a strong unique heuristic match, otherwise return candidate repos and ask for a more exact repo hint.
8. Create the session through the existing `SessionsService` with the Discord prompt as the initial message.

## API server configuration

Set this Cloudflare Worker secret on `services/api-server`:

```bash
cd services/api-server
pnpm wrangler secret put DISCORD_SESSION_REQUEST_TOKEN
```

`DISCORD_SESSION_REQUEST_TOKEN` must match the bot Worker's `CLOUDE_DISCORD_API_TOKEN`.

Apply the D1 migration before using the feature remotely:

```bash
cd services/api-server
pnpm db:migrate:prod
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
