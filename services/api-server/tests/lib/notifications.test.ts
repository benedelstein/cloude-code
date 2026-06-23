import { describe, expect, it, vi } from "vitest";
import type { FcmSendResult } from "../../src/modules/notifications/providers/fcm.provider";
import { FcmTokenRepository } from "../../src/modules/notifications/repositories/fcm-token.repository";
import { NotificationPublisher } from "../../src/modules/notifications/services/notification-publisher.service";
import { NotificationQueueConsumer } from "../../src/modules/notifications/services/notification-queue-consumer.service";
import { createLogger } from "../../src/shared/logging";
import type { NotificationQueueMessage } from "../../src/modules/notifications/types/notification.types";
import type { Env } from "../../src/shared/types";

type PreparedStatement = {
  bind: (...values: unknown[]) => PreparedStatement;
  first: <T>() => Promise<T | null>;
  all: <T>() => Promise<{ results: T[] }>;
  run: () => Promise<{ meta: { changes: number } }>;
};

function createMockDatabase(options: {
  allRows?: unknown[][];
} = {}) {
  const calls: Array<{ query: string; bindings: unknown[] }> = [];
  const allRowsQueue = [...(options.allRows ?? [])];

  const database = {
    prepare(query: string): PreparedStatement {
      const call = { query, bindings: [] as unknown[] };
      calls.push(call);
      return {
        bind(...values: unknown[]) {
          call.bindings = values;
          return this;
        },
        async first<T>() {
          return null as T | null;
        },
        async all<T>() {
          return { results: (allRowsQueue.shift() ?? []) as T[] };
        },
        async run() {
          return { meta: { changes: 1 } };
        },
      };
    },
    async batch(statements: PreparedStatement[]) {
      return await Promise.all(statements.map((statement) => statement.run()));
    },
  } as unknown as D1Database;

  return { database, calls };
}

function createNotificationEvent(): NotificationQueueMessage {
  return {
    id: "notification-1",
    toUserId: "user-1",
    title: "Fix notification copy",
    body: "Here is the final answer.",
    payload: {
      type: "TURN_FINISHED",
      version: 1,
      sessionId: "123e4567-e89b-12d3-a456-426614174000",
      messageId: "message-1",
      repoFullName: "owner/repo",
    },
    createdAt: "2026-06-13T00:00:00.000Z",
  };
}

describe("FcmTokenRepository", () => {
  it("upserts device tokens", async () => {
    const { database, calls } = createMockDatabase();
    const repository = new FcmTokenRepository(database);

    await repository.upsert({
      userId: "user-1",
      deviceId: "device-1",
      token: "fcm-token",
      platform: "ios",
    });

    expect(calls[0]?.query).toContain("DELETE FROM fcm_tokens");
    expect(calls[0]?.bindings).toEqual(["fcm-token", "user-1", "device-1"]);
    expect(calls[1]?.query).toContain("ON CONFLICT(user_id, device_id) DO UPDATE");
    expect(calls[1]?.bindings).toEqual(["user-1", "device-1", "fcm-token", "ios"]);
  });

  it("deletes tokens", async () => {
    const { database, calls } = createMockDatabase();
    const repository = new FcmTokenRepository(database);

    await repository.deleteToken("fcm-token");

    expect(calls[0]?.query).toContain("DELETE FROM fcm_tokens");
    expect(calls[0]?.bindings).toEqual(["fcm-token"]);
  });
});

describe("NotificationPublisher", () => {
  it("enqueues turn finished notification payloads", async () => {
    const send = vi.fn<(message: NotificationQueueMessage) => Promise<void>>()
      .mockResolvedValue();
    const publisher = new NotificationPublisher({
      TURN_NOTIFICATION_QUEUE: { send },
    } as unknown as Env);

    await publisher.publishTurnFinished({
      toUserId: "user-1",
      sessionId: "123e4567-e89b-12d3-a456-426614174000",
      messageId: "message-1",
      sessionTitle: "Fix notification copy",
      repoFullName: "owner/repo",
      messagePreview: "Here is the final answer.",
    });

    expect(send).toHaveBeenCalledWith(expect.objectContaining({
      toUserId: "user-1",
      title: "Fix notification copy",
      body: "Here is the final answer.",
      payload: {
        type: "TURN_FINISHED",
        version: 1,
        sessionId: "123e4567-e89b-12d3-a456-426614174000",
        messageId: "message-1",
        repoFullName: "owner/repo",
      },
    }));
  });

  it("uses an empty body when the finished turn has no text", async () => {
    const send = vi.fn<(message: NotificationQueueMessage) => Promise<void>>()
      .mockResolvedValue();
    const publisher = new NotificationPublisher({
      TURN_NOTIFICATION_QUEUE: { send },
    } as unknown as Env);

    await publisher.publishTurnFinished({
      toUserId: "user-1",
      sessionId: "123e4567-e89b-12d3-a456-426614174000",
      messageId: "message-1",
      sessionTitle: "Fix notification copy",
      repoFullName: "owner/repo",
    });

    expect(send).toHaveBeenCalledWith(expect.objectContaining({
      title: "Fix notification copy",
      body: "",
    }));
  });
});

describe("NotificationQueueConsumer", () => {
  it("sends queued notifications to active tokens", async () => {
    const { database } = createMockDatabase({
      allRows: [[
        {
          user_id: "user-1",
          device_id: "device-1",
          token: "fcm-token",
          platform: "ios",
          created_at: "2026-06-13 00:00:00",
          updated_at: "2026-06-13 00:00:00",
          last_seen_at: "2026-06-13 00:00:00",
        },
      ]],
    });
    const send = vi.fn<() => Promise<FcmSendResult>>()
      .mockResolvedValue({ ok: true });
    const consumer = new NotificationQueueConsumer({
      logger: createLogger("notifications.test.ts"),
      tokenRepository: new FcmTokenRepository(database),
      fcmProvider: { send },
    });
    const event = createNotificationEvent();

    await consumer.handleMessage(event);

    expect(send).toHaveBeenCalledWith({ token: "fcm-token", event });
  });

  it("deletes tokens on invalid FCM token failures", async () => {
    const { database, calls } = createMockDatabase({
      allRows: [[
        {
          user_id: "user-1",
          device_id: "device-1",
          token: "dead-token",
          platform: "ios",
          created_at: "2026-06-13 00:00:00",
          updated_at: "2026-06-13 00:00:00",
          last_seen_at: "2026-06-13 00:00:00",
        },
      ]],
    });
    const send = vi.fn<() => Promise<FcmSendResult>>()
      .mockResolvedValue({
        ok: false,
        error: { code: "INVALID_TOKEN", message: "Unregistered", status: 404 },
      });
    const consumer = new NotificationQueueConsumer({
      logger: createLogger("notifications.test.ts"),
      tokenRepository: new FcmTokenRepository(database),
      fcmProvider: { send },
    });

    await consumer.handleMessage(createNotificationEvent());

    expect(calls.at(-1)?.query).toContain("DELETE FROM fcm_tokens");
    expect(calls.at(-1)?.bindings).toEqual(["dead-token"]);
  });

  it("does not retry the queue message when one token transiently fails", async () => {
    const { database } = createMockDatabase({
      allRows: [[
        {
          user_id: "user-1",
          device_id: "device-1",
          token: "delivered-token",
          platform: "ios",
          created_at: "2026-06-13 00:00:00",
          updated_at: "2026-06-13 00:00:00",
          last_seen_at: "2026-06-13 00:00:00",
        },
        {
          user_id: "user-1",
          device_id: "device-2",
          token: "failing-token",
          platform: "ios",
          created_at: "2026-06-13 00:00:00",
          updated_at: "2026-06-13 00:00:00",
          last_seen_at: "2026-06-13 00:00:00",
        },
      ]],
    });
    const send = vi.fn<(params: {
      token: string;
      event: NotificationQueueMessage;
    }) => Promise<FcmSendResult>>()
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({
        ok: false,
        error: { code: "TRANSIENT", message: "Temporary failure", status: 503 },
      });
    const consumer = new NotificationQueueConsumer({
      logger: createLogger("notifications.test.ts"),
      tokenRepository: new FcmTokenRepository(database),
      fcmProvider: { send },
    });

    await expect(consumer.handleMessage(createNotificationEvent())).resolves.toBeUndefined();
    expect(send).toHaveBeenCalledTimes(2);
  });
});
