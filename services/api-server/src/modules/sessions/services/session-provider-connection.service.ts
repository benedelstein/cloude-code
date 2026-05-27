import { getAgentByName, type Agent } from "agents";
import type { Logger } from "@repo/shared";
import type { Env } from "@/shared/types";
import type { SessionAgentRpc } from "@/shared/types/session-agent";

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
    const sessionAgent = await getAgentByName<Env, Agent<Env, unknown, Record<string, unknown>>>(
      env.SESSION_AGENT as unknown as DurableObjectNamespace<Agent<Env, unknown, Record<string, unknown>>>,
      sessionId,
    ) as unknown as SessionAgentRpc;
    await sessionAgent.refreshProviderConnection();
  } catch (error) {
    logger.error("Failed to refresh session provider connection state", {
      error,
      fields: { sessionId },
    });
  }
}
