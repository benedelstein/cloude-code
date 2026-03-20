import type { SqlFn, Repository } from "./types";

/**
 * Durable server-only session state — never synced to clients.
 * Tracks provisioning checkpoints so steps can be skipped on DO restart.
 */
export type ServerState = {
  /** True after handleInit has been called (sets sessionId, userId, etc.) */
  initialized: boolean;
  /** The DO's sessionId — null until handleInit is called (DO name bug workaround) */
  sessionId: string | null;
  /** Sprite VM name — null until sprite is created */
  spriteName: string | null;
  /** True after the repo has been cloned onto the sprite */
  repoCloned: boolean;
  /** Claude or Codex session ID for resuming agent state across restarts */
  agentSessionId: string | null;
  /** Process ID of the last known agent process (for cleanup only) */
  lastKnownAgentProcessId: number | null;
};

function defaultServerState(): ServerState {
  return {
    initialized: false,
    sessionId: null,
    spriteName: null,
    repoCloned: false,
    agentSessionId: null,
    lastKnownAgentProcessId: null,
  };
}

export class ServerStateRepository implements Repository {
  constructor(private sql: SqlFn) {}

  migrate(): void {
    this.sql`
      CREATE TABLE IF NOT EXISTS server_state (
        id TEXT PRIMARY KEY NOT NULL,
        state TEXT NOT NULL DEFAULT '{}'
      )
    `;
  }

  get(): ServerState {
    const rows = this.sql<{ state: string }>`SELECT state FROM server_state WHERE id = 'state'`;
    if (!rows[0]?.state) return defaultServerState();
    return JSON.parse(rows[0].state) as ServerState;
  }

  update(partial: Partial<ServerState>): void {
    const current = this.get();
    const next = { ...current, ...partial };
    this.sql`INSERT OR REPLACE INTO server_state (id, state) VALUES ('state', ${JSON.stringify(next)})`;
  }
}
