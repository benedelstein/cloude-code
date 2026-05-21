import { describe, expect, it } from "vitest";
import { MAX_ATTACHMENTS_PER_MESSAGE } from "../../src/types/attachments";
import {
  AgentChunksWebhookBody,
  AgentEventsWebhookBody,
  AgentInput,
  AgentInputMessage,
  AgentOutput,
  SequencedAgentStreamOutput,
  decodeAgentInput,
  decodeAgentOutput,
  encodeAgentInput,
  encodeAgentOutput,
} from "../../src/types/vm-agent";

describe("vm-agent schemas", () => {
  it("parses all input variants", () => {
    expect(AgentInput.parse({
      type: "chat",
      userMessageId: "user-message-1",
      message: { content: "hello" },
    }).type).toBe("chat");
    expect(AgentInput.parse({ type: "cancel", userMessageId: "user-message-1" }).type).toBe("cancel");
  });

  it("rejects invalid chat input", () => {
    expect(() => AgentInput.parse({ type: "chat", message: {} })).toThrow();
    expect(() => AgentInput.parse({ type: "chat", message: { content: "hello" } })).toThrow();
  });

  it("limits input messages to five attachments", () => {
    const attachment = {
      filename: "image.png",
      mediaType: "image/png",
      dataUrl: "data:image/png;base64,abc",
    };

    expect(() => AgentInputMessage.parse({
      attachments: Array.from(
        { length: MAX_ATTACHMENTS_PER_MESSAGE },
        () => attachment,
      ),
    })).not.toThrow();

    expect(() => AgentInputMessage.parse({
      attachments: Array.from(
        { length: MAX_ATTACHMENTS_PER_MESSAGE + 1 },
        () => attachment,
      ),
    })).toThrow();
  });

  it("parses all output variants", () => {
    expect(AgentOutput.parse({ type: "ready" }).type).toBe("ready");
    expect(AgentOutput.parse({ type: "debug", message: "m" }).type).toBe("debug");
    expect(AgentOutput.parse({ type: "error", error: "e" }).type).toBe("error");
    expect(AgentOutput.parse({ type: "stream", chunk: { any: "value" } }).type).toBe("stream");
    expect(AgentOutput.parse({ type: "sessionId", sessionId: "s" }).type).toBe("sessionId");
    expect(AgentOutput.parse({ type: "cancel_ack", userMessageId: "user-message-1" }).type).toBe("cancel_ack");
  });

  it("parses sequenced stream chunk webhook batches", () => {
    expect(
      SequencedAgentStreamOutput.parse({
        type: "stream",
        sequence: 0,
        chunk: { type: "finish", finishReason: "stop" },
      }),
    ).toEqual({
      type: "stream",
      sequence: 0,
      chunk: { type: "finish", finishReason: "stop" },
    });

    expect(
      AgentChunksWebhookBody.parse({
        userMessageId: "user-message-1",
        chunks: [
          {
            type: "stream",
            sequence: 0,
            chunk: { type: "finish", finishReason: "stop" },
          },
        ],
      }).chunks[0]?.type,
    ).toBe("stream");

    expect(
      AgentEventsWebhookBody.parse({
        event: { type: "debug", message: "ready-ish" },
      }).event.type,
    ).toBe("debug");
  });

  it("roundtrips encode/decode", () => {
    const input = {
      type: "chat",
      userMessageId: "user-message-1",
      message: { content: "ping" },
    } as const;
    expect(decodeAgentInput(encodeAgentInput(input))).toEqual(input);

    const output = { type: "debug", message: "pong" } as const;
    expect(decodeAgentOutput(encodeAgentOutput(output))).toEqual(output);
  });
});
