import type { SessionAgentDO } from "./durable-objects/session-agent-do";

export interface Env {
  // Durable Objects
  SESSION_AGENT: DurableObjectNamespace<SessionAgentDO>;

  // Environment variables
  ENVIRONMENT: string;

  // Secrets
  ANTHROPIC_API_KEY: string;
  SPRITES_API_KEY: string;
  SPRITES_API_URL: string;
  GITHUB_TOKEN: string;
  PORT: string;
}
