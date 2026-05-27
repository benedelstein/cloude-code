import type { SessionAgentRpc } from "@/shared/types/session-agent";
import type { Env } from "@/shared/types";

export type SessionAgentStub = SessionAgentRpc & {
  fetch(request: Request): Promise<Response>;
};

export async function getSessionAgentStub(
  env: Env,
  sessionId: string,
): Promise<SessionAgentStub> {
  const stub = env.SESSION_AGENT.getByName(sessionId);
  return stub as unknown as SessionAgentStub;
}
