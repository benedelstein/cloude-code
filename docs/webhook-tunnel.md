# Webhook Tunnel Setup

Use `cloudflared` to expose your local dev server for GitHub webhook delivery.

## Prerequisites

```bash
brew install cloudflared
```

## First-Time Setup

```bash
# Auth with Cloudflare
cloudflared tunnel login

# Create the tunnel
cloudflared tunnel create cloude-code-tunnel

# Route a subdomain to it
cloudflared tunnel route dns cloude-code-tunnel <subdomain.yourdomain.com>
```

Then set your GitHub App webhook URL to:

```
https://<subdomain.yourdomain.com>/webhooks/github
```

## Starting the Local Stack

Use the unified local launcher to run web, API server, and tunnel together in Turbo TUI:

```bash
pnpm dev:local
```

This starts:

- `@repo/web#dev`
- `@repo/api-server#dev`
- `@repo/scripts#dev` (Cloudflare tunnel to `http://localhost:8787`)

You can still run `pnpm dev:web` and `pnpm dev:api` independently when needed.
