import type { UserSessionsPublishMessage } from "@/shared/types/user-sessions";
import type { Env } from "@/shared/types";
import type { Logger } from "@repo/shared";

export class UserSessionsPublisher {
  private readonly env: Env;
  private readonly logger: Logger;

  constructor(params: { env: Env; logger: Logger }) {
    this.env = params.env;
    this.logger = params.logger;
  }

  async invalidateSessionSummary(params: {
    userId: string;
    sessionId: string;
  }): Promise<void> {
    await this.publish(params.userId, {
      type: "session.summary.invalidate",
      sessionId: params.sessionId,
    });
  }

  async removeSessionSummary(params: {
    userId: string;
    sessionId: string;
  }): Promise<void> {
    await this.publish(params.userId, {
      type: "session.summary.remove",
      sessionId: params.sessionId,
    });
  }

  async requestResync(userId: string): Promise<void> {
    await this.publish(userId, {
      type: "session.list.resync_required",
    });
  }

  private async publish(
    userId: string,
    message: UserSessionsPublishMessage,
  ): Promise<void> {
    const stub = this.env.USER_SESSIONS.getByName(userId);
    const response = await stub.fetch("http://user-sessions/publish", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-User-Id": userId,
      },
      body: JSON.stringify(message),
    });

    if (!response.ok) {
      this.logger.warn("Failed to publish user sessions update", {
        fields: {
          userId,
          type: message.type,
          status: response.status,
        },
      });
    }
  }
}

export function createUserSessionsPublisher(
  env: Env,
  logger: Logger,
): UserSessionsPublisher {
  return new UserSessionsPublisher({ env, logger });
}
