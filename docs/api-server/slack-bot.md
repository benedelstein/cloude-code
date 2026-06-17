# Slack bot and integration session requests

`apps/slack-bot` is a Cloudflare Worker Slack slash-command adapter for Cloude integration session requests.
It verifies Slack request signatures, acknowledges `/cloude`, adapts Slack's user shape into the generic
integration request payload, calls the API server, and posts the final ephemeral response to Slack's `response_url`.

## Current command

```text
/cloude make a change to the auth in the birthday repo
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
    "provider": "slack",
    "id": "U1234567890",
    "displayName": "ben",
    "teamId": "T1234567890"
  },
  "prompt": "make a change to the auth in the birthday repo"
}
```

## Slack Worker configuration

Set these secrets on `apps/slack-bot`:

```bash
cd apps/slack-bot
pnpm wrangler secret put SLACK_SIGNING_SECRET
pnpm wrangler secret put INTEGRATION_SESSION_REQUEST_TOKEN
```

Set `API_BASE_URL` in `wrangler.jsonc` for the deployed API server URL.

Deploy:

```bash
pnpm --filter @repo/slack-bot deploy
```

Use the deployed Worker URL as the Slack slash command Request URL.
