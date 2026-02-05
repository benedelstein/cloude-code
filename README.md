# Cloude Code ☁️

A remote agent coding environment similar to Claude Background agents and inspired by https://builders.ramp.com/post/why-we-built-our-background-agent

## Services

- api-server: Handles user connection and session management. Coordinates between vm server and client.
- vm-server: Runs a VM for the session with an agent process. Pulls in the repository and edits files, runs commands, etc.
- Clients (apps/*): Connects to the server and sends messages to the agent. Tbd.

## Development

```bash
pnpm install

pnpm build
```

Make sure envs are set
```bash
cd services/api-server && pnpm dev

cd apps/web && pnpm dev
```