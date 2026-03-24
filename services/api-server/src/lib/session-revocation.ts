import type { SessionAgentDO } from "@/durable-objects/session-agent-do";
import type { Env } from "@/types";
import { createLogger } from "@/lib/logger";
import { getAgentByName } from "agents";

const logger = createLogger("session-revocation.ts");

export async function requestSessionRevocationCleanup(
  env: Env,
  sessionId: string,
): Promise<void> {
  try {
    const stub = await getAgentByName<Env, SessionAgentDO>(
      env.SESSION_AGENT,
      sessionId,
    );
    await stub.fetch(
      new Request("http://do/revoke", {
        method: "POST",
      }),
    );
  } catch (error) {
    logger.error("Failed to trigger session revocation cleanup", {
      error,
      fields: { sessionId },
    });
  }
}
