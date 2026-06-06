import { describe, expect, it } from "vitest";
import { MAX_ATTACHMENTS_PER_MESSAGE } from "../../src/types/attachments";
import { ClientMessage, ServerMessage } from "../../src/types/websocket-api";

describe("websocket api schemas", () => {
  it("parses valid client/server messages", () => {
    const client = ClientMessage.parse({
      type: "chat.message",
      content: "hello",
      messageId: "123e4567-e89b-12d3-a456-426614174000",
    });
    expect(client.type).toBe("chat.message");

    const server = ServerMessage.parse({
      type: "connected",
      sessionId: "123e4567-e89b-12d3-a456-426614174000",
      status: "ready",
    });
    expect(server.type).toBe("connected");
  });

  it("parses session mark-read client messages", () => {
    const client = ClientMessage.parse({
      type: "session.mark_read",
      messageId: "assistant-message-1",
    });

    expect(client).toEqual({
      type: "session.mark_read",
      messageId: "assistant-message-1",
    });
    expect(() => ClientMessage.parse({
      type: "session.mark_read",
      messageId: "",
    })).toThrow();
  });

  it("rejects invalid messages", () => {
    expect(() => ClientMessage.parse({ type: "unknown" })).toThrow();
    expect(() => ServerMessage.parse({ type: "connected", sessionId: "not-a-uuid", status: "ready" })).toThrow();
  });

  it("enforces chat content or attachments refinement", () => {
    expect(() => ClientMessage.parse({ type: "chat.message" })).toThrow();

    const withAttachment = ClientMessage.parse({
      type: "chat.message",
      attachments: [{ attachmentId: "123e4567-e89b-12d3-a456-426614174000" }],
    });
    expect(withAttachment.type).toBe("chat.message");
  });

  it("parses active turn state on sync responses", () => {
    const server = ServerMessage.parse({
      type: "sync.response",
      messages: [],
      activeTurn: { userMessageId: "user-message-1" },
    });

    expect(server.type).toBe("sync.response");
    expect(server.activeTurn?.userMessageId).toBe("user-message-1");
  });

  it("limits chat messages to five attachments", () => {
    const attachment = {
      attachmentId: "123e4567-e89b-12d3-a456-426614174000",
    };

    expect(() => ClientMessage.parse({
      type: "chat.message",
      attachments: Array.from(
        { length: MAX_ATTACHMENTS_PER_MESSAGE },
        () => attachment,
      ),
    })).not.toThrow();

    expect(() => ClientMessage.parse({
      type: "chat.message",
      attachments: Array.from(
        { length: MAX_ATTACHMENTS_PER_MESSAGE + 1 },
        () => attachment,
      ),
    })).toThrow();
  });
});
