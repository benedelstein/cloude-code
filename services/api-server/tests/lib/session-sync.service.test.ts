import { describe, expect, it, vi } from "vitest";
import { DEFAULT_AGENT_SETTINGS, type ClientState } from "@repo/shared";
import type { UIMessage, UIMessageChunk } from "ai";
import type { MessageRepository } from "../../src/modules/session-agent/repositories/message.repository";
import type { ServerState } from "../../src/modules/session-agent/repositories/server-state.repository";
import { SessionSyncService } from "../../src/modules/session-agent/services/session-sync.service";

const sessionId = "123e4567-e89b-12d3-a456-426614174000";

function createServerState(overrides: Partial<ServerState> = {}): ServerState {
  return {
    initialized: true,
    sessionId,
    userId: "123e4567-e89b-12d3-a456-426614174001",
    spriteName: null,
    repoCloned: false,
    agentSessionId: null,
    agentProcessId: null,
    activeUserMessageId: null,
    startupToolchain: null,
    startupScriptCompleted: false,
    finalNetworkPolicyApplied: false,
    ...overrides,
  };
}

function createClientState(overrides: Partial<ClientState> = {}): ClientState {
  return {
    repoFullName: "ben/repo",
    status: "ready",
    sessionSetupRun: null,
    agentSettings: { ...DEFAULT_AGENT_SETTINGS },
    pullRequest: null,
    pushedBranch: null,
    baseBranch: null,
    todos: null,
    plan: null,
    pendingUserMessage: null,
    activeTurn: null,
    editorUrl: null,
    providerConnection: null,
    agentMode: "edit",
    lastError: null,
    createdAt: new Date("2026-06-05T00:00:00.000Z"),
    ...overrides,
  };
}

describe("SessionSyncService", () => {
  it("builds the connected message from current session state", () => {
    const service = new SessionSyncService({
      messageRepository: { getAllBySession: vi.fn() } as unknown as MessageRepository,
      getServerState: () => createServerState(),
      getClientState: () => createClientState(),
      getPendingChunks: () => undefined,
    });

    expect(service.buildConnectedMessage()).toEqual({
      type: "connected",
      sessionId,
      status: "ready",
    });
  });

  it("builds sync response from stored messages, pending chunks, and active turn", () => {
    const message: UIMessage = { id: "message-1", role: "user", parts: [] };
    const pendingChunk = { type: "text-delta" } as unknown as UIMessageChunk;
    const messageRepository = {
      getAllBySession: vi.fn(() => [{
        sessionId,
        createdAt: "2026-06-05T00:00:00.000Z",
        message,
      }]),
    } as unknown as MessageRepository;
    const service = new SessionSyncService({
      messageRepository,
      getServerState: () => createServerState({ activeUserMessageId: "user-message-1" }),
      getClientState: () => createClientState(),
      getPendingChunks: () => [pendingChunk],
    });

    expect(service.buildSyncResponse()).toEqual({
      type: "sync.response",
      messages: [message],
      pendingChunks: [pendingChunk],
      activeTurn: { userMessageId: "user-message-1" },
    });
    expect(messageRepository.getAllBySession).toHaveBeenCalledWith(sessionId);
  });

  it("builds an empty sync response before session initialization", () => {
    const messageRepository = {
      getAllBySession: vi.fn(),
    } as unknown as MessageRepository;
    const service = new SessionSyncService({
      messageRepository,
      getServerState: () => createServerState({ sessionId: null }),
      getClientState: () => createClientState(),
      getPendingChunks: () => undefined,
    });

    expect(service.buildSyncResponse()).toEqual({
      type: "sync.response",
      messages: [],
      activeTurn: null,
    });
    expect(messageRepository.getAllBySession).not.toHaveBeenCalled();
  });
});
