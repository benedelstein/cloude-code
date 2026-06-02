import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { MessageList } from "@/components/chat/message-list";

vi.mock("@/lib/client-api", () => ({
  listRepos: vi.fn(async () => ({ installUrl: null })),
}));

const originalScrollIntoView = Element.prototype.scrollIntoView;

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  cleanup();
});

afterAll(() => {
  Element.prototype.scrollIntoView = originalScrollIntoView;
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

  it("renders running setup inline below the pending user message", () => {
    render(React.createElement(MessageList, {
      messages: [],
      streamingMessage: null,
      pendingUserMessage: {
        id: "pending-1",
        role: "user",
        parts: [{ type: "text", text: "hello there" }],
      },
      sessionSetupRun: {
        id: "setup-1",
        mode: "create",
        status: "running",
        startedAt: "2026-06-02T00:00:00.000Z",
        completedAt: null,
        tasks: [
          {
            id: "cloud_container",
            status: "completed",
            startedAt: "2026-06-02T00:00:00.000Z",
            completedAt: "2026-06-02T00:00:01.000Z",
            error: null,
            output: null,
          },
          {
            id: "initial_agent_start",
            status: "running",
            startedAt: "2026-06-02T00:00:01.000Z",
            completedAt: null,
            error: null,
            output: null,
          },
        ],
      },
      providerId: "openai-codex",
    }));

    expect(screen.getByText("Initializing session")).toBeTruthy();
    expect(screen.getByText("Set up cloud container")).toBeTruthy();
    expect(screen.getByText("Starting agent process")).toBeTruthy();

    const messageText = screen.getByText("hello there");
    const setupText = screen.getByText("Initializing session");
    expect(messageText.compareDocumentPosition(setupText) & Node.DOCUMENT_POSITION_FOLLOWING)
      .toBeTruthy();
  });

  it("keeps completed setup visible while the setup run still exists", () => {
    render(React.createElement(MessageList, {
      messages: [],
      streamingMessage: null,
      isResponding: true,
      sessionSetupRun: {
        id: "setup-1",
        mode: "create",
        status: "completed",
        startedAt: "2026-06-02T00:00:00.000Z",
        completedAt: "2026-06-02T00:00:02.000Z",
        tasks: [
          {
            id: "cloud_container",
            status: "completed",
            startedAt: "2026-06-02T00:00:00.000Z",
            completedAt: "2026-06-02T00:00:01.000Z",
            error: null,
            output: null,
          },
        ],
      },
    }));

    expect(screen.getByRole("status", { name: "Initialized session" })).toBeTruthy();
    expect(screen.queryByRole("status", { name: "Working" })).toBeNull();
  });

  it("renders failed setup script output collapsed behind a disclosure", () => {
    render(React.createElement(MessageList, {
      messages: [],
      streamingMessage: null,
      sessionSetupRun: {
        id: "setup-1",
        mode: "create",
        status: "completed",
        startedAt: "2026-06-02T00:00:00.000Z",
        completedAt: "2026-06-02T00:00:02.000Z",
        tasks: [
          {
            id: "setup_script",
            status: "failed",
            startedAt: "2026-06-02T00:00:00.000Z",
            completedAt: "2026-06-02T00:00:01.000Z",
            error: "Startup script failed with exit code 1 after 10ms",
            output: {
              stdout: "",
              stderr: "setup failed",
              exitCode: 1,
              truncated: true,
            },
          },
        ],
      },
    }));

    expect(screen.getByText("Initialized session")).toBeTruthy();
    expect(screen.queryByText("setup failed")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Initialized session/ }));

    expect(screen.getByText("Setup script failed")).toBeTruthy();
    expect(screen.getByText("truncated")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Setup script output/ }));
    expect(screen.getByText("setup failed")).toBeTruthy();
  });
});
