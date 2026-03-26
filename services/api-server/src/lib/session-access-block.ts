import type { SessionAgentDO } from "@/durable-objects/session-agent-do";
import type { Env } from "@/types";
import { createLogger } from "@/lib/logger";
import { getAgentByName } from "agents";

const logger = createLogger("session-access-block.ts");

/**
 * Triggers access-block cleanup on a session's durable object.
 * @param env - Worker environment.
 * @param sessionId - Session id to trigger access-block cleanup for.
 */
export async function requestSessionAccessBlockedCleanup(
  env: Env,
  sessionId: string,
): Promise<void> {
  try {
    const stub = await getAgentByName<Env, SessionAgentDO>(
      env.SESSION_AGENT,
      sessionId,
    );
    await stub.enforceSessionAccessBlocked(true);
  } catch (error) {
    logger.error("Failed to trigger session access-block cleanup", {
      error,
      fields: { sessionId },
    });
  }
}
