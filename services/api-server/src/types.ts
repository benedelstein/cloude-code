import type { SessionAgentDO } from "./durable-objects/session-agent-do";

export interface Env {
  // Durable Objects
  SESSION_AGENT: DurableObjectNamespace<SessionAgentDO>;

  // D1 Database
  DB: D1Database;

  // Environment variables
  ENVIRONMENT: string;
  WORKER_URL: string;

  // Secrets
  ANTHROPIC_API_KEY: string;
  SPRITES_API_KEY: string;
  SPRITES_API_URL: string;
  GITHUB_APP_ID: string;
  GITHUB_APP_PRIVATE_KEY: string;
  GITHUB_WEBHOOK_SECRET: string;
  GITHUB_APP_CLIENT_ID: string;
  GITHUB_APP_CLIENT_SECRET: string;
  GITHUB_APP_NAME: string;
  TOKEN_ENCRYPTION_KEY: string;
  PORT: string;
}
