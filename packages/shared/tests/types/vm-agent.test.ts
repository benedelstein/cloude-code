import { describe, expect, it } from "vitest";
import {
  AgentInput,
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
