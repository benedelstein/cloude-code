import React from "react";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type { SessionSetupRun, SessionSetupTask } from "@repo/shared";
import { MessageList } from "@/components/chat/message-list";

afterEach(() => {
  cleanup();
});

const startedAt = "2026-06-05T00:00:00.000Z";

Element.prototype.scrollIntoView = function scrollIntoView() {};

function setupTask(id: SessionSetupTask["id"], status: SessionSetupTask["status"]): SessionSetupTask {
  const base = {
    id,
    status,
    startedAt: status === "pending" ? null : startedAt,
    completedAt: status === "completed" ? startedAt : null,
    error: null,
  };

  switch (id) {
    case "cloud_container":
    case "repository":
    case "network_policy":
      return { ...base, id, isBlocking: true };
    case "setup_script":
      return { ...base, id, isBlocking: false, output: null, skipReason: null };
  }
}

function runningSetupRun(): SessionSetupRun {
  return {
    id: "setup-run-1",
    status: "running",
    startedAt,
    completedAt: null,
    tasks: [
      setupTask("cloud_container", "running"),
      setupTask("repository", "pending"),
      setupTask("setup_script", "pending"),
      setupTask("network_policy", "pending"),
    ],
  };
}

function cloudCount(container: HTMLElement): number {
  return container.querySelectorAll("svg[viewBox='0 0 64 44']").length;
}

describe("MessageList", () => {
  it("does not render an extra working cloud while setup is running", () => {
    const { container } = render(React.createElement(MessageList, {
      messages: [],
      streamingMessage: null,
      sessionSetupRun: runningSetupRun(),
      isResponding: true,
    }));

    expect(cloudCount(container)).toBe(1);
  });

  it("renders one working cloud while the agent is responding outside setup", () => {
    const { container } = render(React.createElement(MessageList, {
      messages: [],
      streamingMessage: null,
      isResponding: true,
    }));

    expect(cloudCount(container)).toBe(1);
  });
});
