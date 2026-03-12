"use client";

import { useState, useCallback, useRef } from "react";
import { useAgent } from "agents/react";
import { readUIMessageStream } from "ai";
import type { UIMessage, UIMessageChunk } from "ai";
import { normalizeHost } from "@/lib/utils";
import type {
  AgentState,
  ClaudeAuthState,
  MessageAttachmentRef,
  PullRequestState,
  AttachmentDescriptor,
  ServerMessage,
  SessionStatus,
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
  onError?: (error: Error) => void;
}

export interface UseCloudflareAgentReturn {
  messages: UIMessage[];
  streamingMessage: UIMessage | null;
  sessionStatus: SessionStatus;
  errorMessage: string | null;
  isHistoryLoading: boolean;
  isReady: boolean;
  isStreaming: boolean;
  isResponding: boolean;
  pendingUserMessage: UIMessage | null;
  repoFullName: string | null;
  pushedBranch: string | null;
  pullRequestUrl: string | null;
  pullRequestState: PullRequestState | null;
  editorUrl: string | null;
  claudeAuthRequired: ClaudeAuthState | null;
  sendMessage: (message: {
    content?: string;
    attachments?: MessageAttachmentRef[];
    optimisticAttachments?: AttachmentDescriptor[];
  }) => void;
  stop: () => void;
}

export function useCloudflareAgent({
  sessionId,
  onError,
}: UseCloudflareAgentOptions): UseCloudflareAgentReturn {
  const resolvedHost = DEFAULT_API_HOST;
  const [messages, setMessages] = useState<UIMessage[]>([]);
  const [pendingUserMessage, setPendingUserMessage] = useState<UIMessage | null>(null);
  const [streamingMessage, setStreamingMessage] = useState<UIMessage | null>(null);
  const [sessionStatus, setSessionStatus] = useState<SessionStatus>("provisioning");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isHistoryLoading, setIsHistoryLoading] = useState(true);
  const [isResponding, setIsResponding] = useState(false);
  const [repoFullName, setRepoFullName] = useState<string | null>(null);
  const [pushedBranch, setPushedBranch] = useState<string | null>(null);
  const [pullRequestUrl, setPullRequestUrl] = useState<string | null>(null);
  const [pullRequestState, setPullRequestState] = useState<PullRequestState | null>(null);
  const [editorUrl, setEditorUrl] = useState<string | null>(null);
  const [claudeAuthRequired, setClaudeAuthRequired] = useState<ClaudeAuthState | null>(null);

  const streamControllerRef = useRef<ReadableStreamDefaultController<UIMessageChunk> | null>(null);
  const isConsumingRef = useRef(false);

  const resetPendingResponse = useCallback(() => {
    setIsResponding(false);
    setStreamingMessage(null);
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
    if (isConsumingRef.current) return;
    isConsumingRef.current = true;

    try {
      const messageStream = readUIMessageStream({ stream });

      for await (const message of messageStream) {
        setStreamingMessage(message);
      }
    } catch (err) {
      console.error("Error consuming stream:", err);
    } finally {
      isConsumingRef.current = false;
    }
  }, []);

  const handleServerMessage = useCallback((msg: ServerMessage) => {
    switch (msg.type) {
      case "connected":
        console.log("Connected to agent", msg);
        setSessionStatus(msg.status);
        break;

      case "sync.response": {
        const synced = msg.messages as UIMessage[];
        setMessages(synced);
        setIsHistoryLoading(false);
        break;
      }

      case "session.status":
        setSessionStatus(msg.status);
        if (msg.status === "error" && msg.message) {
          setErrorMessage(msg.message);
        }
        break;

      case "agent.chunk":
        setIsResponding(true);
        if (!streamControllerRef.current) {
          // First chunk for a server-initiated response (e.g. pending message) —
          // create a stream so the UI can render it
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
        setIsResponding(false);
        if (streamControllerRef.current) {
          streamControllerRef.current.close();
          streamControllerRef.current = null;
        }
        setMessages((prev) => [...prev, msg.message as UIMessage]);
        setStreamingMessage(null);
        break;

      case "agent.ready":
        break;

      case "user.message":
        setIsResponding(true);
        setMessages((prev) => [...prev, msg.message as UIMessage]);
        break;

      case "error":
        resetPendingResponse();
        setErrorMessage(msg.message);
        setIsHistoryLoading(false);
        onError?.(new Error(msg.message));
        break;
    }
  }, [onError, resetPendingResponse]);

  // Use Cloudflare's useAgent hook
  const agent = useAgent<AgentState>({
    agent: "session",
    name: sessionId,
    host: resolvedHost,
    onMessage: (event) => {
      try {
        const msg = JSON.parse(event.data) as ServerMessage;
        handleServerMessage(msg);
      } catch (err) {
        console.error("Error parsing message:", err);
      }
    },
    onOpen: () => {
      // Connection established - useAgent handles this
    },
    onClose: () => {
      // useAgent will auto-reconnect
      resetPendingResponse();
    },
    onStateUpdate(state: AgentState, source) {
      console.log("state update", state, source);
      if (state.pushedBranch !== undefined) {
        setPushedBranch(state.pushedBranch);
      }
      if (state.repoFullName !== undefined) {
        setRepoFullName(state.repoFullName);
      }
      if (state.pullRequestUrl !== undefined) {
        setPullRequestUrl(state.pullRequestUrl);
      }
      if (state.pullRequestState !== undefined) {
        setPullRequestState(state.pullRequestState);
      }
      if (state.pendingUserMessage !== undefined) {
        setPendingUserMessage(state.pendingUserMessage);
      }
      if (state.editorUrl !== undefined) {
        setEditorUrl(state.editorUrl);
      }
      if (state.claudeAuthRequired !== undefined) {
        setClaudeAuthRequired(state.claudeAuthRequired);
      }
    },
    onError: (message) => {
      resetPendingResponse();
      setSessionStatus("error");
      setErrorMessage("Connection error");
      setIsHistoryLoading(false);
      console.error("Connection error", { host: resolvedHost, sessionId, message });
      onError?.(new Error(`Connection error (${resolvedHost})`));
    },
  });

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

    // Create optimistic user message
    const parts: UIMessage["parts"] = [];
    if (content) {
      parts.push({ type: "text", text: content });
    }
    const optimisticAttachments = message.optimisticAttachments ?? [];
    for (const attachment of optimisticAttachments) {
      parts.push({
        type: "file",
        mediaType: attachment.mediaType,
        filename: attachment.filename,
        url: attachment.contentUrl,
      } as UIMessage["parts"][number]);
    }
    const userMessage: UIMessage = {
      id: crypto.randomUUID(),
      role: "user",
      parts,
    };
    setMessages((prev) => [...prev, userMessage]);
    setIsResponding(true);

    // Create a new stream for this response
    const stream = new ReadableStream<UIMessageChunk>({
      start: (controller) => {
        streamControllerRef.current = controller;
      },
    });

    // Start consuming the stream
    consumeStream(stream);

    // Send via useAgent's connection
    agent.send(JSON.stringify({
      type: "chat.message",
      content,
      attachments: attachmentReferences.length > 0 ? attachmentReferences : undefined,
    }));
  }, [agent, consumeStream]);

  const stop = useCallback(() => {
    agent.send(JSON.stringify({ type: "operation.cancel" }));
  }, [agent]);

  return {
    repoFullName,
    messages,
    streamingMessage,
    sessionStatus,
    errorMessage,
    isHistoryLoading,
    isReady: sessionStatus === "ready",
    isStreaming: streamingMessage !== null,
    isResponding,
    pendingUserMessage,
    pushedBranch,
    pullRequestUrl,
    pullRequestState,
    editorUrl,
    claudeAuthRequired,
    sendMessage,
    stop,
  };
}
