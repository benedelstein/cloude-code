import type { SessionAgentDO } from "./durable-objects/session-agent-do";

export interface Env {
  // Durable Objects
  SESSION_AGENT: DurableObjectNamespace<SessionAgentDO>;

  // D1 Database
  DB: D1Database;
  ATTACHMENTS_BUCKET: R2Bucket;

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
  GITHUB_APP_SLUG: string;
  TOKEN_ENCRYPTION_KEY: string;
  WEBSOCKET_TOKEN_SIGNING_KEY: string;
  ALLOWED_GITHUB_LOGINS: string;
  PORT: string;

  // Codex CLI provider (optional)
  OPENAI_API_KEY?: string;
  /** JSON string of codex OAuth tokens (contents of ~/.codex/auth.json) */
  CODEX_AUTH_JSON?: string;
}
