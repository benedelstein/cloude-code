"use client";

import { useState, useCallback, useRef } from "react";
import { useAgent } from "agents/react";
import { readUIMessageStream } from "ai";
import type { UIMessage, UIMessageChunk } from "ai";
import type {
  AgentState,
  PullRequestState,
  ServerMessage,
  SessionStatus,
} from "@repo/shared";

const DEFAULT_API_HOST = process.env.NEXT_PUBLIC_API_HOST ?? "localhost:8787";

export interface UseCloudflareAgentOptions {
  sessionId: string;
  host?: string;
  onError?: (error: Error) => void;
}

export interface UseCloudflareAgentReturn {
  messages: UIMessage[];
  streamingMessage: UIMessage | null;
  sessionStatus: SessionStatus;
  errorMessage: string | null;
  isReady: boolean;
  isStreaming: boolean;
  isResponding: boolean;
  pendingMessage: string | null;
  repoFullName: string | null;
  pushedBranch: string | null;
  pullRequestUrl: string | null;
  pullRequestState: PullRequestState | null;
  sendMessage: (content: string) => void;
  stop: () => void;
}

export function useCloudflareAgent({
  sessionId,
  host,
  onError,
}: UseCloudflareAgentOptions): UseCloudflareAgentReturn {
  const [messages, setMessages] = useState<UIMessage[]>([]);
  const [pendingMessage, setPendingMessage] = useState<string | null>(null);
  const [streamingMessage, setStreamingMessage] = useState<UIMessage | null>(null);
  const [sessionStatus, setSessionStatus] = useState<SessionStatus>("provisioning");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isResponding, setIsResponding] = useState(false);
  const [repoFullName, setRepoFullName] = useState<string | null>(null);
  const [pushedBranch, setPushedBranch] = useState<string | null>(null);
  const [pullRequestUrl, setPullRequestUrl] = useState<string | null>(null);
  const [pullRequestState, setPullRequestState] = useState<PullRequestState | null>(null);

  const streamControllerRef = useRef<ReadableStreamDefaultController<UIMessageChunk> | null>(null);
  const isConsumingRef = useRef(false);

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
        break;
      }

      case "session.status":
        setSessionStatus(msg.status);
        if (msg.status === "error" && msg.message) {
          setErrorMessage(msg.message);
        }
        break;

      case "agent.chunk":
        // setIsResponding(false);
        if (streamControllerRef.current) {
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
        setMessages((prev) => [...prev, msg.message as UIMessage]);
        break;

      case "error":
        setErrorMessage(msg.message);
        onError?.(new Error(msg.message));
        break;
    }
  }, [onError]);

  // Use Cloudflare's useAgent hook
  const agent = useAgent<AgentState>({
    agent: "session",
    name: sessionId,
    host: host ?? DEFAULT_API_HOST,
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
      if (state.pendingMessage !== undefined) {
        setPendingMessage(state.pendingMessage);
      }
    },
    onError: (message) => {
      setSessionStatus("error");
      setErrorMessage("Connection error");
      console.error("Connection error", message);
      onError?.(new Error("Connection error"));
    },
  });

  const sendMessage = useCallback((content: string) => {
    // Create optimistic user message
    const userMessage: UIMessage = {
      id: crypto.randomUUID(),
      role: "user",
      parts: [{ type: "text", text: content }],
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
    agent.send(JSON.stringify({ type: "chat.message", content }));
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
    isReady: sessionStatus === "ready",
    isStreaming: streamingMessage !== null,
    isResponding,
    pendingMessage,
    pushedBranch,
    pullRequestUrl,
    pullRequestState,
    sendMessage,
    stop,
  };
}
