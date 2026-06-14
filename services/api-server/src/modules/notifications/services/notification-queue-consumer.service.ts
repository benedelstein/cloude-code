import type { Logger } from "@repo/shared";
import type { FcmTokenRepository } from "../repositories/fcm-token.repository";
import type {
  FcmSendResult,
  NotificationQueueMessage,
} from "../types/notification.types";

export interface NotificationQueueConsumerDeps {
  logger: Logger;
  tokenRepository: FcmTokenRepository;
  fcmProvider: {
    send(params: {
      token: string;
      event: NotificationQueueMessage;
    }): Promise<FcmSendResult>;
  };
}

export class NotificationQueueConsumer {
  private readonly logger: Logger;
  private readonly tokenRepository: FcmTokenRepository;
  private readonly fcmProvider: NotificationQueueConsumerDeps["fcmProvider"];

  constructor(deps: NotificationQueueConsumerDeps) {
    this.logger = deps.logger.scope("notification-queue-consumer");
    this.tokenRepository = deps.tokenRepository;
    this.fcmProvider = deps.fcmProvider;
  }

  async handleMessage(event: NotificationQueueMessage): Promise<void> {
    switch (event.payload.type) {
      case "TURN_FINISHED":
        await this.deliverToActiveTokens(event);
        return;
    }
  }

  private async deliverToActiveTokens(event: NotificationQueueMessage): Promise<void> {
    const tokens = await this.tokenRepository.listActiveForUser(event.toUserId);
    if (tokens.length === 0) {
      this.logger.info("No active FCM tokens for notification", {
        fields: {
          notificationId: event.id,
          notificationType: event.payload.type,
          toUserId: event.toUserId,
        },
      });
      return;
    }

    const transientFailures: Array<{ deviceId: string; status?: number }> = [];
    for (const token of tokens) {
      const result = await this.fcmProvider.send({
        token: token.token,
        event,
      });
      if (result.ok) {
        continue;
      }

      switch (result.error.code) {
        case "TERMINAL_TOKEN":
          await this.tokenRepository.invalidateToken(token.token);
          this.logger.info("Invalidated terminal FCM token", {
            fields: {
              notificationId: event.id,
              toUserId: event.toUserId,
              deviceId: token.deviceId,
              status: result.error.status,
            },
          });
          break;
        case "TRANSIENT":
          transientFailures.push({
            deviceId: token.deviceId,
            status: result.error.status,
          });
          this.logger.warn("FCM send failed transiently", {
            fields: {
              notificationId: event.id,
              toUserId: event.toUserId,
              deviceId: token.deviceId,
              status: result.error.status ?? null,
            },
          });
          break;
        default: {
          const exhaustiveCheck: never = result.error;
          throw new Error(`Unhandled FCM send error: ${JSON.stringify(exhaustiveCheck)}`);
        }
      }
    }

    if (transientFailures.length > 0) {
      throw new Error("FCM transient notification delivery failure");
    }
  }
}
