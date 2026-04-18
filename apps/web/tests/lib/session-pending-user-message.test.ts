import { describe, expect, it, vi } from "vitest";
import {
  buildOptimisticUserMessage,
  consumeInitialPendingUserMessage,
  storeInitialPendingUserMessage,
} from "@/lib/session-pending-user-message";
import type { AttachmentDescriptor } from "@repo/shared";
import type { UIMessage } from "ai";

describe("buildOptimisticUserMessage", () => {
  it("returns null when the message has no content or attachments", () => {
    expect(buildOptimisticUserMessage({ content: "   " })).toBeNull();
  });

  it("trims text and maps attachments into file parts", () => {
    vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValue("message-1");

    const attachments = [{
      filename: "notes.txt",
      mediaType: "text/plain",
      contentUrl: "https://example.com/notes.txt",
    }] as AttachmentDescriptor[];

    expect(buildOptimisticUserMessage({
      content: "  hello world  ",
      attachments,
    })).toEqual({
      id: "message-1",
      role: "user",
      parts: [
        { type: "text", text: "hello world" },
        {
          type: "file",
          filename: "notes.txt",
          mediaType: "text/plain",
          url: "https://example.com/notes.txt",
        },
      ],
    });
  });
});

describe("pending user message storage", () => {
  it("prefers the in-memory cache and consumes the value once", () => {
    const message: UIMessage = {
      id: "message-1",
      role: "user",
      parts: [{ type: "text", text: "hello" }],
    };

    storeInitialPendingUserMessage("session-1", message);

    expect(consumeInitialPendingUserMessage("session-1")).toEqual(message);
    expect(consumeInitialPendingUserMessage("session-1")).toBeNull();
  });

  it("reads valid messages from sessionStorage", () => {
    const message: UIMessage = {
      id: "message-2",
      role: "user",
      parts: [{ type: "text", text: "saved" }],
    };

    sessionStorage.setItem(
      "session-pending-user-message:session-2",
      JSON.stringify(message),
    );

    expect(consumeInitialPendingUserMessage("session-2")).toEqual(message);
    expect(sessionStorage.getItem("session-pending-user-message:session-2")).toBeNull();
  });

  it("ignores malformed stored payloads", () => {
    sessionStorage.setItem("session-pending-user-message:session-3", "{bad json");
    expect(consumeInitialPendingUserMessage("session-3")).toBeNull();

    sessionStorage.setItem(
      "session-pending-user-message:session-4",
      JSON.stringify({ id: 123 }),
    );
    expect(consumeInitialPendingUserMessage("session-4")).toBeNull();
  });

  it("is a no-op when window is unavailable", () => {
    vi.stubGlobal("window", undefined);

    const message: UIMessage = {
      id: "message-3",
      role: "user",
      parts: [{ type: "text", text: "hello" }],
    };

    storeInitialPendingUserMessage("session-5", message);

    expect(consumeInitialPendingUserMessage("session-5")).toBeNull();
  });
});
