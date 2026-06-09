import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProviderModelEffortSelector } from "@/components/model-providers/provider-model-effort-selector";
import type { ClaudeAuthHandle } from "@/hooks/use-provider-auth";

function claudeAuthHandle(overrides: Partial<ClaudeAuthHandle> = {}): ClaudeAuthHandle {
  return {
    providerId: "claude-code",
    connected: false,
    requiresReauth: true,
    loading: false,
    error: null,
    connect: vi.fn(async () => undefined),
    disconnect: vi.fn(async () => undefined),
    awaitingCode: false,
    code: "",
    setCode: vi.fn(),
    submittingCode: false,
    submitCode: vi.fn(async () => undefined),
    cancelCodeEntry: vi.fn(),
    ...overrides,
  };
}

describe("ProviderModelEffortSelector", () => {
  afterEach(() => {
    cleanup();
  });

  it("shows a reconnect provider control and hides effort when auth is required", () => {
    render(React.createElement(ProviderModelEffortSelector, {
      selectedProvider: "claude-code",
      selectedModel: "claude-sonnet-4",
      selectedEffort: "high",
      providerAuthHandles: [claudeAuthHandle()],
      onModelSelect: vi.fn(),
      onEffortSelect: vi.fn(),
      onConnect: vi.fn(),
      authRequired: true,
      authRequiredLabel: "Reconnect Claude to continue",
    }));

    expect(screen.getByText("Reconnect Claude Code")).toBeTruthy();
    expect(screen.getByAltText("Claude")).toBeTruthy();
    expect(screen.getByLabelText("Reconnect Claude to continue")).toBeTruthy();
    expect(screen.queryByText("High")).toBeNull();
  });
});
