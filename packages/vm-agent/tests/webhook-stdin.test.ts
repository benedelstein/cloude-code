import { describe, expect, it, vi } from "vitest";
import { encodeAgentInput } from "@repo/shared";
import { handleWebhookStdinLine, type WebhookStdinLogger } from "../src/lib/webhook-stdin";

describe("handleWebhookStdinLine", () => {
  function createLogger(): WebhookStdinLogger {
    return vi.fn();
  }

  it("queues chat inputs with the webhook user message id", () => {
    const runner = {
      queueStdinMessage: vi.fn(),
      cancelTurn: vi.fn(),
    };
    const logger = createLogger();

    handleWebhookStdinLine(
      encodeAgentInput({
        type: "chat",
        userMessageId: "user-message-2",
        message: { content: "follow up" },
        model: "gpt-5.2-codex",
        agentMode: "plan",
      }),
      runner,
      logger,
    );

    expect(runner.queueStdinMessage).toHaveBeenCalledWith(
      "user-message-2",
      { content: "follow up" },
      { model: "gpt-5.2-codex", agentMode: "plan" },
    );
    expect(runner.cancelTurn).not.toHaveBeenCalled();
  });

  it("rejects chat inputs without a user message id", () => {
    const runner = {
      queueStdinMessage: vi.fn(),
      cancelTurn: vi.fn(),
    };
    const logger = createLogger();

    handleWebhookStdinLine(
      JSON.stringify({ type: "chat", message: { content: "missing id" } }),
      runner,
      logger,
    );

    expect(runner.queueStdinMessage).not.toHaveBeenCalled();
    expect(logger).toHaveBeenCalledWith("warn", expect.stringContaining("Invalid stdin input"));
  });

  it("forwards cancel inputs to the runner", () => {
    const runner = {
      queueStdinMessage: vi.fn(),
      cancelTurn: vi.fn(),
    };
    const logger = createLogger();

    handleWebhookStdinLine(
      encodeAgentInput({ type: "cancel", userMessageId: "user-message-2" }),
      runner,
      logger,
    );

    expect(runner.cancelTurn).toHaveBeenCalledWith("user-message-2");
    expect(runner.queueStdinMessage).not.toHaveBeenCalled();
  });
});
