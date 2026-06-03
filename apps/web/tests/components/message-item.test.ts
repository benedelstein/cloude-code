import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { UIMessage } from "ai";
import { MessageItem } from "@/components/chat/message-item";

afterEach(() => {
  cleanup();
});

function assistantMessage(): UIMessage {
  return {
    id: "message-1",
    role: "assistant",
    parts: [{ type: "text", text: "Partial response" }],
  };
}

function userMessage(): UIMessage {
  return {
    id: "message-2",
    role: "user",
    parts: [{ type: "text", text: "User prompt" }],
  };
}

describe("MessageItem", () => {
  it("hides the copy action while an assistant message is streaming", () => {
    render(React.createElement(MessageItem, {
      message: assistantMessage(),
      isStreaming: true,
    }));

    expect(screen.queryByRole("button", { name: "Copy message" })).toBeNull();
  });

  it("shows a live work header while an assistant message is streaming", () => {
    const { container } = render(React.createElement(MessageItem, {
      message: {
        ...assistantMessage(),
        metadata: { startedAt: Date.now() - 5_000 },
      },
      isStreaming: true,
    }));

    expect(screen.getByText(/Working for/)).toBeTruthy();
    expect(container.querySelector("animate")).toBeTruthy();
  });

  it("shows the copy action after an assistant message has settled", () => {
    render(React.createElement(MessageItem, {
      message: assistantMessage(),
      isStreaming: false,
    }));

    expect(screen.getByRole("button", { name: "Copy message" })).toBeTruthy();
  });

  it("keeps user messages copyable immediately", () => {
    render(React.createElement(MessageItem, {
      message: userMessage(),
      isStreaming: true,
    }));

    expect(screen.getByRole("button", { name: "Copy message" })).toBeTruthy();
  });
});
