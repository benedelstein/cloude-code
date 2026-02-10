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

## Starting the Tunnel

```bash
cloudflared tunnel run --url http://localhost:8787 cloude-code-tunnel
```

Run this alongside `pnpm dev:api` to receive webhooks locally.
