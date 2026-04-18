"use client";

import { useState, useCallback, useRef } from "react";
import { useAgent } from "agents/react";
import { readUIMessageStream } from "ai";
import type { UIMessage, UIMessageChunk } from "ai";
import { buildOptimisticUserMessage } from "@/lib/session-pending-user-message";
import { normalizeHost } from "@/lib/utils";
import type {
  AgentMode,
  ClientState,
  MessageAttachmentRef,
  AttachmentDescriptor,
  OperationErrorEvent,
  ServerMessage,
  SessionTodo,
  SessionPlanMetadata,
  AgentSettings,
  ProviderConnectionState,
  SessionStatus,
  SessionWebSocketTokenResponse,
  ClientMessage,
  ProviderAuthRequired,
  ProviderId,
} from "@repo/shared";

function resolveDefaultApiHost(): string {
  const configuredApiUrl = normalizeHost(process.env.NEXT_PUBLIC_API_URL ?? "");
  if (configuredApiUrl) {
    return configuredApiUrl;
  }

  return "localhost:8787";
}

const DEFAULT_API_HOST = resolveDefaultApiHost();

export interface UseCloudflareAgentOptions {
  sessionId: string;
  webSocketToken: SessionWebSocketTokenResponse;
  // Called when the socket closes with an already-expired token so the next
  // reconnect handshake uses a fresh one. Noop otherwise.
  refreshWebSocketToken?: () => void;
  initialPendingUserMessage?: UIMessage | null;
  onError?: (error: Error) => void;
}

export interface UseCloudflareAgentReturn {
  sessionId: string;
  messages: UIMessage[];
  streamingMessage: UIMessage | null;
  sessionStatus: SessionStatus | null;
  sessionErrorMessage: string | null;
  sessionErrorCode: string | null;
  operationError: OperationErrorEvent | null;
  isHistoryLoading: boolean;
  hasHydratedState: boolean;
  isReady: boolean;
  isStreaming: boolean;
  isResponding: boolean;
  pendingUserMessage: UIMessage | null;
  repoFullName: string | null;
  pushedBranch: string | null;
  pullRequestState: ClientState["pullRequest"] | null;
  todos: SessionTodo[] | null;
  plan: SessionPlanMetadata | null;
  agentSettings: AgentSettings | null;
  providerConnection: ProviderConnectionState | null;
  agentMode: AgentMode;
  setAgentMode: (mode: AgentMode) => void;
  selectedModel: string | null;
  setSelectedModel: (model: string) => void;
  selectedProvider: ProviderId | null;
  editorUrl: string | null;
  providerAuthRequired: ProviderAuthRequired;
  sendMessage: (message: {
    content?: string;
    attachments?: MessageAttachmentRef[];
    optimisticAttachments?: AttachmentDescriptor[];
  }) => void;
  stop: () => void;
}

export function useCloudflareAgent({
  sessionId,
  webSocketToken,
  refreshWebSocketToken,
  initialPendingUserMessage = null,
  onError,
}: UseCloudflareAgentOptions): UseCloudflareAgentReturn {
  const [messages, setMessages] = useState<UIMessage[]>([]);
  const [pendingUserMessage, setPendingUserMessage] = useState<UIMessage | null>(
    initialPendingUserMessage,
  );
  const [streamingMessage, setStreamingMessage] = useState<UIMessage | null>(null);
  const [sessionStatus, setSessionStatus] = useState<SessionStatus | null>(null);
  const [sessionErrorMessage, setSessionErrorMessage] = useState<string | null>(null);
  const [operationError, setOperationError] = useState<OperationErrorEvent | null>(null);
  const [isHistoryLoading, setIsHistoryLoading] = useState(true);
  const [hasHydratedState, setHasHydratedState] = useState(false);
  const [waitingForResponse, setWaitingForResponse] = useState(initialPendingUserMessage !== null);
  const [repoFullName, setRepoFullName] = useState<string | null>(null);
  const [pushedBranch, setPushedBranch] = useState<string | null>(null);
  const [pullRequestState, setPullRequestState] = useState<ClientState["pullRequest"] | null>(null);
  const [todos, setTodos] = useState<SessionTodo[] | null>(null);
  const [plan, setPlan] = useState<SessionPlanMetadata | null>(null);
  const [editorUrl, setEditorUrl] = useState<string | null>(null);
  const [providerAuthRequired, setProviderAuthRequired] = useState<ProviderAuthRequired>(null);
  const [agentSettings, setAgentSettings] = useState<AgentSettings | null>(null);
  const [providerConnection, setProviderConnection] = useState<ProviderConnectionState | null>(null);
  const [agentMode, setAgentModeState] = useState<AgentMode | null>(null);
  const [selectedModel, setSelectedModel] = useState<string | null>(null);

  const streamControllerRef = useRef<ReadableStreamDefaultController<UIMessageChunk> | null>(null);
  const isConsumingRef = useRef(false);
  const serverAgentModeRef = useRef<AgentMode>("edit");
  const resolvedAgentMode = agentMode ?? "edit";

  const setAgentMode = useCallback((mode: AgentMode) => {
    setAgentModeState(mode);
  }, []);

  const isResponding = waitingForResponse || streamingMessage !== null;

  const resetPendingResponse = useCallback((reason: string) => {
    console.log("[agent] resetPendingResponse", reason, { hadStream: !!streamControllerRef.current, wasConsuming: isConsumingRef.current });
    setWaitingForResponse(false);
    setStreamingMessage(null);
    isConsumingRef.current = false;
    if (streamControllerRef.current) {
      try {
        streamControllerRef.current.close();
      } catch {
        // no-op: stream may already be closed
      }
      streamControllerRef.current = null;
    }
  }, []);

  // Consume the stream with readUIMessageStream
  const consumeStream = useCallback(async (stream: ReadableStream<UIMessageChunk>) => {
    if (isConsumingRef.current) {
      console.log("[agent] consumeStream skipped — already consuming");
      return;
    }
    console.log("[agent] consumeStream started");
    isConsumingRef.current = true;

    try {
      const messageStream = readUIMessageStream({
        stream,
        onError: (err) => console.error("[agent] readUIMessageStream internal error:", err),
      });

      for await (const message of messageStream) {
        setStreamingMessage(message);
      }
      console.log("[agent] consumeStream ended normally");
    } catch (err) {
      console.error("[agent] consumeStream error:", err);
    } finally {
      isConsumingRef.current = false;
      streamControllerRef.current = null;
    }
  }, []);

  const handleServerMessage = useCallback((msg: ServerMessage) => {
    switch (msg.type) {
      case "connected":
        setSessionStatus(msg.status);
        break;

      case "sync.response": {
        const synced = msg.messages as UIMessage[];
        setMessages(synced);
        const pendingChunks = (msg as { pendingChunks?: unknown[] }).pendingChunks as UIMessageChunk[] | undefined;
        console.log("[agent] sync.response", { messageCount: synced.length, pendingChunkCount: pendingChunks?.length ?? 0, hadStream: !!streamControllerRef.current });
        if (synced.length > 0) {
          setPendingUserMessage(null);
        }
        setIsHistoryLoading(false);

        // Replay buffered chunks for in-progress message (reconnect scenario).
        // Skip if a stream is already active — a sync.response can arrive
        // mid-stream (e.g. WS reconnect) and would otherwise orphan the
        // existing controller and buffer chunks into an unconsumed stream.
        if (pendingChunks && pendingChunks.length > 0) {
          if (streamControllerRef.current) {
            console.log("[agent] sync.response skipping pendingChunks replay — stream already active", { pendingChunkCount: pendingChunks.length });
          } else {
            const stream = new ReadableStream<UIMessageChunk>({
              start: (controller) => {
                streamControllerRef.current = controller;
                for (const chunk of pendingChunks) {
                  controller.enqueue(chunk);
                }
                // Leave stream open for new live chunks via agent.chunk
              },
            });
            consumeStream(stream);
          }
        }
        break;
      }

      case "agent.chunk":
        if (!streamControllerRef.current) {
          const stream = new ReadableStream<UIMessageChunk>({
            start: (controller) => {
              streamControllerRef.current = controller;
              controller.enqueue(msg.chunk as UIMessageChunk);
            },
          });
          consumeStream(stream);
        } else {
          streamControllerRef.current.enqueue(msg.chunk as UIMessageChunk);
        }
        break;

      case "agent.finish":
        if (streamControllerRef.current) {
          streamControllerRef.current.close();
          streamControllerRef.current = null;
        }
        // TODO: instead of re-sending the full message here, just use the last message from the accumulated stream in consumeStream();
        setMessages((prev) => [...prev, msg.message as UIMessage]);
        setStreamingMessage(null);
        setWaitingForResponse(false);
        break;

      case "agent.ready":
        break;

      case "user.message":
        setOperationError(null);
        setPendingUserMessage(null);
        setMessages((prev) => [...prev, msg.message as UIMessage]);
        break;

      case "operation.error":
        resetPendingResponse("operation.error");
        setOperationError(msg);
        setIsHistoryLoading(false);
        onError?.(new Error(msg.message));
        break;
    }
  }, [onError, resetPendingResponse]);

  // Use Cloudflare's useAgent hook
  const agent = useAgent<ClientState>({
    agent: "session",
    name: sessionId,
    host: DEFAULT_API_HOST,
    query: { token: webSocketToken.token },
    onMessage: (event) => {
      try {
        const msg = JSON.parse(event.data) as ServerMessage;
        handleServerMessage(msg);
      } catch (err) {
        console.error("Error parsing message:", err);
      }
    },
    onOpen: () => {
      console.log("[agent] ws onOpen");
    },
    onClose: () => {
      console.log("[agent] ws onClose", { hadStream: !!streamControllerRef.current, isConsuming: isConsumingRef.current });
      resetPendingResponse("onClose");
      setOperationError(null);
      // Token is only verified at the WS upgrade. If it's already past expiry,
      // partysocket's auto-reconnect would 401 with the stale token — fetch a
      // fresh one so the next handshake succeeds. Otherwise let partysocket
      // reconnect with the current token untouched (no extra sync churn).
      if (Date.now() >= new Date(webSocketToken.expiresAt).getTime()) {
        refreshWebSocketToken?.();
      }
    },
    onStateUpdate(state: ClientState) {
      setHasHydratedState(true);
      setPushedBranch(state.pushedBranch);
      setRepoFullName(state.repoFullName);
      // for objects, we need to diff them to prevent excessive re-renders
      setPullRequestState(prev => JSON.stringify(prev) === JSON.stringify(state.pullRequest) ? prev : state.pullRequest ?? null);
      setTodos(prev => JSON.stringify(prev) === JSON.stringify(state.todos) ? prev : state.todos);
      setPlan(prev => JSON.stringify(prev) === JSON.stringify(state.plan) ? prev : state.plan);
      setPendingUserMessage(prev => JSON.stringify(prev) === JSON.stringify(state.pendingUserMessage?.message) ? prev : state.pendingUserMessage?.message ?? null);
      setEditorUrl(state.editorUrl);
      setAgentSettings(prev => JSON.stringify(prev) === JSON.stringify(state.agentSettings) ? prev : state.agentSettings);
      setProviderConnection(prev => JSON.stringify(prev) === JSON.stringify(state.providerConnection) ? prev : state.providerConnection);
      const nextProviderAuthRequired: ProviderAuthRequired = state.providerConnection && !state.providerConnection.connected
        ? {
            providerId: state.providerConnection.provider,
            state: state.providerConnection.requiresReauth ? "reauth_required" : "auth_required",
          }
        : null;
      setProviderAuthRequired(prev => JSON.stringify(prev) === JSON.stringify(nextProviderAuthRequired) ? prev : nextProviderAuthRequired);
      // Track the server-known agent mode for diff-based sending
      serverAgentModeRef.current = state.agentMode ?? "edit";
      // Initialize agent mode from server state (only if not yet set locally)
      setAgentModeState((prev) => prev ?? state.agentMode ?? "edit");
      // Initialize selected model from server settings (only if not yet set locally)
      setSelectedModel((prev) => prev ?? state.agentSettings.model);
      setSessionStatus(state.status);
      setSessionErrorMessage(state.lastError);
    },
    onError: (message) => {
      console.log("[agent] ws onError", message);
      resetPendingResponse("onError");
      setOperationError(null);
      console.warn("Transient websocket error", { host: DEFAULT_API_HOST, sessionId, message });
    },
  });

  const sendToAgent = useCallback((message: ClientMessage) => {
    agent.send(JSON.stringify(message));
  }, [agent]);

  const sendMessage = useCallback((message: {
    content?: string;
    attachments?: MessageAttachmentRef[];
    optimisticAttachments?: AttachmentDescriptor[];
  }) => {
    const content = message.content?.trim();
    const attachmentReferences = message.attachments ?? [];
    if (!content && attachmentReferences.length === 0) {
      return;
    }
    setOperationError(null);
    const optimisticAttachments = message.optimisticAttachments ?? [];
    const userMessage = buildOptimisticUserMessage({
      content,
      attachments: optimisticAttachments,
    });
    if (userMessage) {
      setMessages((prev) => [...prev, userMessage]);
    }
    setWaitingForResponse(true);

    // Create a new stream for this response
    const stream = new ReadableStream<UIMessageChunk>({
      start: (controller) => {
        streamControllerRef.current = controller;
      },
    });

    // Start consuming the stream
    consumeStream(stream);

    // Send via useAgent's connection, include model/agentMode only if they differ from server settings
    const modelToSend = selectedModel && selectedModel !== agentSettings?.model ? selectedModel : undefined;
    const agentModeToSend = resolvedAgentMode !== serverAgentModeRef.current ? resolvedAgentMode : undefined;
    sendToAgent({
      type: "chat.message",
      content,
      attachments: attachmentReferences.length > 0 ? attachmentReferences : undefined,
      model: modelToSend,
      agentMode: agentModeToSend,
    });
  }, [sendToAgent, consumeStream, selectedModel, agentSettings?.model, resolvedAgentMode]);

  const stop = useCallback(() => {
    sendToAgent({ type: "operation.cancel" });
  }, [sendToAgent]);

  const selectedProvider = agentSettings?.provider ?? null;

  return {
    sessionId,
    repoFullName,
    messages,
    streamingMessage,
    sessionStatus,
    sessionErrorMessage,
    sessionErrorCode: null,
    operationError,
    isHistoryLoading,
    hasHydratedState,
    isReady: sessionStatus === "ready",
    isStreaming: streamingMessage !== null,
    isResponding,
    pendingUserMessage,
    pushedBranch,
    pullRequestState,
    todos,
    plan,
    agentSettings,
    providerConnection,
    agentMode: resolvedAgentMode,
    setAgentMode,
    selectedModel,
    setSelectedModel,
    selectedProvider,
    editorUrl,
    providerAuthRequired,
    sendMessage,
    stop,
  };
}
