import type { UserSessionsRpc } from "@/shared/types/user-sessions";
import type { Env } from "@/shared/types";
import type { Logger } from "@repo/shared";

export class UserSessionsPublisher {
  private readonly env: Env;
  private readonly logger: Logger;

  constructor(params: { env: Env; logger: Logger }) {
    this.env = params.env;
    this.logger = params.logger;
  }

  async createSessionSummary(params: {
    userId: string;
    sessionId: string;
  }): Promise<void> {
    await this.publish(params.userId, "session.summary.create", (stub) =>
      stub.createSessionSummary(params)
    );
  }

  async invalidateSessionSummary(params: {
    userId: string;
    sessionId: string;
  }): Promise<void> {
    await this.publish(params.userId, "session.summary.invalidate", (stub) =>
      stub.invalidateSessionSummary(params)
    );
  }

  async removeSessionSummary(params: {
    userId: string;
    sessionId: string;
  }): Promise<void> {
    await this.publish(params.userId, "session.summary.remove", (stub) =>
      stub.removeSessionSummary(params)
    );
  }

  async requestResync(userId: string): Promise<void> {
    await this.publish(userId, "session.list.resync_required", (stub) =>
      stub.requestResync({ userId })
    );
  }

  private async publish(
    userId: string,
    type: string,
    publish: (stub: UserSessionsRpc) => Promise<void>,
  ): Promise<void> {
    try {
      const stub = this.env.USER_SESSIONS.getByName(
        userId,
      ) as unknown as UserSessionsRpc;
      await publish(stub);
    } catch (error) {
      this.logger.warn("Failed to publish user sessions update", {
        error,
        fields: {
          userId,
          type,
        },
      });
      throw error;
    }
  }
}

export function createUserSessionsPublisher(
  env: Env,
  logger: Logger,
): UserSessionsPublisher {
  return new UserSessionsPublisher({ env, logger });
}
