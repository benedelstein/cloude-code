# Slack client

Cloudflare Worker that receives Slack Events API callbacks and starts Cloude Code sessions through the public API.

## Slack setup

- Event request URL: `https://<worker-host>/slack/events`
- Bot event subscription: `app_mention`
- Bot scopes: `app_mentions:read`, `chat:write`

## Required secrets

```bash
cd apps/slack-client
wrangler secret put SLACK_SIGNING_SECRET
wrangler secret put SLACK_BOT_TOKEN
wrangler secret put CLOUDE_API_TOKEN
```

`CLOUDE_API_TOKEN` is the same bearer token accepted by the API server's protected routes.

## Vars

Set these in `wrangler.jsonc` or the deploy environment:

- `CLOUDE_API_URL` - API origin, for example `https://api.example.com`
- `CLOUDE_WEB_URL` - optional web origin used to link created sessions
- `CLOUDE_DEFAULT_REPO_ID` - optional numeric GitHub repo id used when commands omit `repo:<id>`

## Usage

```text
@cloude repo:123456 fix the failing tests
@cloude repo:123456 branch:main mode:plan investigate the flaky checkout flow
@cloude fix the failing tests
```

The last form requires `CLOUDE_DEFAULT_REPO_ID`.
