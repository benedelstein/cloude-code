import type { NotificationPayload } from "@repo/api-contract";
import type { Env } from "@/shared/types";
import type { NotificationQueueMessage } from "../types/notification.types";

const MAX_TURN_FINISHED_BODY_LENGTH = 180;

export class NotificationPublisher {
  constructor(private readonly env: Env) {}

  async publishTurnFinished(params: {
    toUserId: string;
    sessionId: string;
    messageId: string;
    sessionTitle: string;
    repoFullName: string;
    messagePreview?: string;
  }): Promise<void> {
    await this.publish({
      toUserId: params.toUserId,
      title: params.sessionTitle,
      body: buildTurnFinishedBody(params.messagePreview),
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

function buildTurnFinishedBody(
  messagePreview: string | undefined,
): string {
  const normalizedPreview = messagePreview?.replace(/\s+/g, " ").trim();
  if (!normalizedPreview) {
    return "";
  }
  if (normalizedPreview.length <= MAX_TURN_FINISHED_BODY_LENGTH) {
    return normalizedPreview;
  }
  return `${normalizedPreview.slice(0, MAX_TURN_FINISHED_BODY_LENGTH - 3)}...`;
}
