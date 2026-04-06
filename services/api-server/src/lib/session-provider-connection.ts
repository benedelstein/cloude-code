import { getAgentByName } from "agents";
import type { Logger } from "@repo/shared";
import type { Env } from "@/types";
import type { SessionAgentDO } from "@/durable-objects/session-agent-do";

/**
 * Best-effort refresh of the cached provider connection state for a session.
 * @param env Worker environment.
 * @param sessionId Session durable object id.
 * @param logger Logger for refresh failures.
 * @returns Resolves after the refresh request is attempted.
 */
export async function requestSessionProviderConnectionRefresh(
  env: Env,
  sessionId: string,
  logger: Logger,
): Promise<void> {
  try {
    const sessionAgent = await getAgentByName<Env, SessionAgentDO>(env.SESSION_AGENT, sessionId);
    await sessionAgent.refreshProviderConnection();
  } catch (error) {
    logger.error("Failed to refresh session provider connection state", {
      error,
      fields: { sessionId },
    });
  }
}
