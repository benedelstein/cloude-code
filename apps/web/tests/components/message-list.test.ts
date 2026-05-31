import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MessageList } from "@/components/chat/message-list";

vi.mock("@/lib/client-api", () => ({
  listRepos: vi.fn(async () => ({ installUrl: null })),
}));

afterEach(() => {
  cleanup();
});

describe("MessageList", () => {
  it("renders blocked repository access as a recoverable session state", () => {
    render(React.createElement(MessageList, {
      messages: [],
      streamingMessage: null,
      sessionErrorMessage: "The GitHub App installation no longer has access to this repository.",
      sessionErrorCode: "REPO_ACCESS_BLOCKED",
    }));

    expect(screen.getByRole("heading", { name: "Repository access blocked" })).toBeTruthy();
    expect(screen.getByText("The GitHub App installation no longer has access to this repository."))
      .toBeTruthy();
  });
});
