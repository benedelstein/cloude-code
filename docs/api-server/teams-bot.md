# Microsoft Teams bot and integration session requests

`apps/teams-bot` is a Cloudflare Worker adapter for Microsoft Teams Outgoing Webhooks. Teams users
invoke it by mentioning the webhook in a public channel, and the Worker adapts the Bot Framework-style
activity into a Cloude integration session request.

Teams Outgoing Webhooks send an HTTP POST to the configured callback URL, authenticate it with an
`Authorization: HMAC <signature>` header, and expect a synchronous JSON message response. The Worker
validates the HMAC-SHA256 signature using the security token Teams shows when the webhook is created.

## Current command

```text
@Cloude make a change to the auth in the birthday repo
```

## Generic API shape

The Worker calls the API server with the shared integration client token:

```http
POST /integrations/session-requests
Authorization: Bearer <integration-session-request-token>
Content-Type: application/json
```

```json
{
  "externalUser": {
    "provider": "teams",
    "id": "00000000-0000-0000-0000-000000000000",
    "displayName": "Ben",
    "tenantId": "tenant-id",
    "teamId": "team-id"
  },
  "prompt": "make a change to the auth in the birthday repo"
}
```

## Teams Worker configuration

Set these secrets on `apps/teams-bot`:

```bash
cd apps/teams-bot
pnpm wrangler secret put TEAMS_OUTGOING_WEBHOOK_SECRET
pnpm wrangler secret put INTEGRATION_SESSION_REQUEST_TOKEN
```

Set `API_BASE_URL` in `wrangler.jsonc` for the deployed API server URL.

Deploy:

```bash
pnpm --filter @repo/teams-bot deploy
```

Use the deployed Worker URL as the Teams Outgoing Webhook callback URL.

## Teams setup notes

Create the Outgoing Webhook from a team, set its callback URL to the deployed Worker URL, then copy the
HMAC security token into `TEAMS_OUTGOING_WEBHOOK_SECRET`. Outgoing Webhooks are scoped to a team, require
an `@mention`, and only work in public channels.

Teams expects the webhook response quickly, so this adapter performs session creation synchronously and
returns the final message directly in the webhook response.
