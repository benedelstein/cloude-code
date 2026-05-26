import type { SessionAgentRpc } from "@/shared/types/session-agent";
import type { Env } from "@/shared/types";
import { createLogger } from "@/shared/logging";
import { getAgentByName, type Agent } from "agents";

const logger = createLogger("session-access-block.service.ts");

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
    const stub = await getAgentByName<Env, Agent<Env, unknown, Record<string, unknown>>>(
      env.SESSION_AGENT as unknown as DurableObjectNamespace<Agent<Env, unknown, Record<string, unknown>>>,
      sessionId,
    ) as unknown as SessionAgentRpc;
    await stub.enforceSessionAccessBlocked(true);
  } catch (error) {
    logger.error("Failed to trigger session access-block cleanup", {
      error,
      fields: { sessionId },
    });
  }
}
