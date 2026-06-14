import type { NotificationPayload } from "@repo/shared";
import type { Env } from "@/shared/types";
import type { NotificationQueueMessage } from "../types/notification.types";

export class NotificationPublisher {
  constructor(private readonly env: Env) {}

  async publishTurnFinished(params: {
    toUserId: string;
    sessionId: string;
    messageId: string;
    repoFullName: string;
  }): Promise<void> {
    await this.publish({
      toUserId: params.toUserId,
      title: "Agent turn finished",
      body: `${params.repoFullName} is ready to review.`,
      payload: {
        type: "TURN_FINISHED",
        version: 1,
        sessionId: params.sessionId,
        messageId: params.messageId,
        repoFullName: params.repoFullName,
      },
    });
  }

  private async publish(params: {
    toUserId: string;
    title: string;
    body: string;
    payload: NotificationPayload;
  }): Promise<void> {
    const message: NotificationQueueMessage = {
      id: crypto.randomUUID(),
      toUserId: params.toUserId,
      title: params.title,
      body: params.body,
      payload: params.payload,
      createdAt: new Date().toISOString(),
    };

    await this.env.TURN_NOTIFICATION_QUEUE.send(message);
  }
}
