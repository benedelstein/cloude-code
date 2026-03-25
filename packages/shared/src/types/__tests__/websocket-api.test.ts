import { describe, expect, it } from "vitest";
import { ClientMessage, ServerMessage } from "../websocket-api";

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
});
