# Microsoft Teams bot and integration session requests

`apps/teams-bot` is a Cloudflare Worker adapter for Microsoft Teams Bot Framework activities. It uses the
Bot Framework REST protocol directly instead of the Bot Framework SDK, keeping the Worker small and
function-based.

This is intentionally not a Teams Outgoing Webhook. Outgoing Webhooks must return the final response
synchronously and can time out before Cloude finishes repo routing and session creation. The Bot Framework
flow lets the Worker acknowledge Teams immediately, send a quick "Creating a Cloude session..." reply, and
then post the final result asynchronously to the conversation.

## Current command

```text
@Cloude make a change to the auth in the birthday repo
```

## Runtime flow

1. Teams sends a Bot Framework activity to the Worker messaging endpoint.
2. The Worker validates the Bot Framework bearer JWT using Microsoft OpenID/JWKS metadata.
3. The Worker returns `202 Accepted` quickly.
4. The Worker replies to the activity with `Creating a Cloude session...`.
5. The Worker calls `POST /integrations/session-requests` with `provider: "teams"`.
6. The Worker sends the final result to the conversation through the Bot Connector REST API.

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
pnpm wrangler secret put MICROSOFT_APP_ID
pnpm wrangler secret put MICROSOFT_APP_PASSWORD
pnpm wrangler secret put INTEGRATION_SESSION_REQUEST_TOKEN
```

For multi-tenant bots, keep `MICROSOFT_APP_TENANT_ID=botframework.com`. For single-tenant bots, set it to
the tenant ID that owns the bot app registration.

Set `API_BASE_URL` in `wrangler.jsonc` for the deployed API server URL.

Deploy:

```bash
pnpm --filter @repo/teams-bot deploy
```

Use the deployed Worker URL as the Azure Bot messaging endpoint.

## Microsoft references

- Bot Connector authentication: https://learn.microsoft.com/en-us/azure/bot-service/rest-api/bot-framework-rest-connector-authentication?view=azure-bot-service-4.0
- Bot Connector REST API: https://learn.microsoft.com/en-us/azure/bot-service/rest-api/bot-framework-rest-connector-api-reference?view=azure-bot-service-4.0
- Teams proactive messages: https://learn.microsoft.com/en-us/microsoftteams/platform/bots/how-to/conversations/send-proactive-messages
