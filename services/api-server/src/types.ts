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
  PORT: string;
}
