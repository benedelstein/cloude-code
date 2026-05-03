import { describe, expect, it } from "vitest";
import { MAX_ATTACHMENTS_PER_MESSAGE } from "../../src/types/attachments";
import {
  AgentInput,
  AgentInputMessage,
  AgentOutput,
  decodeAgentInput,
  decodeAgentOutput,
  encodeAgentInput,
  encodeAgentOutput,
} from "../../src/types/vm-agent";

describe("vm-agent schemas", () => {
  it("parses all input variants", () => {
    expect(AgentInput.parse({ type: "chat", message: { content: "hello" } }).type).toBe("chat");
    expect(AgentInput.parse({ type: "cancel" }).type).toBe("cancel");
  });

  it("rejects invalid chat input", () => {
    expect(() => AgentInput.parse({ type: "chat", message: {} })).toThrow();
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
  });

  it("roundtrips encode/decode", () => {
    const input = { type: "chat", message: { content: "ping" } } as const;
    expect(decodeAgentInput(encodeAgentInput(input))).toEqual(input);

    const output = { type: "debug", message: "pong" } as const;
    expect(decodeAgentOutput(encodeAgentOutput(output))).toEqual(output);
  });
});
