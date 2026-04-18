import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useModels } from "@/hooks/use-models";
import type { ModelsResponse } from "@repo/shared";

const { getModels } = vi.hoisted(() => ({
  getModels: vi.fn(),
}));

vi.mock("@/lib/client-api", () => ({
  getModels,
}));

function createModelsResponse(provider: ModelsResponse["providers"][number]): ModelsResponse {
  return {
    providers: [provider],
  };
}

describe("useModels", () => {
  beforeEach(() => {
    getModels.mockReset();
  });

  it("loads providers and exposes lookup helpers", async () => {
    getModels.mockResolvedValue(createModelsResponse({
      providerId: "openai-codex",
      providerName: "OpenAI Codex",
      connected: true,
      requiresReauth: false,
      defaultModel: "gpt-5",
      authMethods: ["oauth"],
      models: [],
    }));

    const { result } = renderHook(() => useModels());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.providers).toHaveLength(1);
    expect(result.current.getProvider("openai-codex")?.providerName).toBe("OpenAI Codex");
    expect(result.current.isProviderConnected("openai-codex")).toBe(true);
    expect(result.current.isProviderConnected("claude-code")).toBe(false);
  });

  it("falls back to an empty provider list on failure and supports refresh", async () => {
    getModels
      .mockRejectedValueOnce(new Error("failed"))
      .mockResolvedValueOnce(createModelsResponse({
        providerId: "claude-code",
        providerName: "Claude Code",
        connected: false,
        requiresReauth: false,
        defaultModel: "claude-opus-4-1",
        authMethods: ["oauth"],
        models: [],
      }));

    const { result } = renderHook(() => useModels());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.providers).toEqual([]);

    await act(async () => {
      await result.current.refresh();
    });

    await waitFor(() => {
      expect(result.current.getProvider("claude-code")?.providerName).toBe("Claude Code");
    });
  });
});
