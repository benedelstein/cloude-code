"use client";

import { useSession } from "@/components/providers/session-provider";
import { StatusBanner } from "./status-banner";
import { MessageList } from "./message-list";
import { ChatInput } from "./chat-input";

interface ChatContainerProps {
  sessionId: string;
}

export function ChatContainer({ sessionId }: ChatContainerProps) {
  const {
    messages,
    streamingMessage,
    sessionStatus,
    errorMessage,
    isReady,
    isStreaming,
    sendMessage,
    stop,
  } = useSession();

  return (
    <div className="h-screen flex flex-col">
      {/* Header */}
      <header className="shrink-0 border-b border-border px-4 py-3">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <div>
            <h1 className="font-semibold">cloude-code</h1>
            <p className="text-xs text-muted-foreground">
              Session: {sessionId.slice(0, 8)}...
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span
              className={`h-2 w-2 rounded-full ${
                sessionStatus === "ready"
                  ? "bg-green-500"
                  : "bg-yellow-500"
              }`}
            />
            <span className="text-xs text-muted-foreground capitalize">
              {sessionStatus}
            </span>
          </div>
        </div>
      </header>

      {/* Status Banner */}
      <StatusBanner
        sessionStatus={sessionStatus}
        errorMessage={errorMessage}
      />

      {/* Messages */}
      <div className="flex-1 overflow-hidden">
        <MessageList
          messages={messages}
          streamingMessage={streamingMessage}
        />
      </div>

      {/* Input */}
      <div className="shrink-0 border-t border-border">
        <div className="max-w-4xl mx-auto">
          <ChatInput
            onSend={sendMessage}
            onStop={stop}
            disabled={!isReady}
            isStreaming={isStreaming}
          />
        </div>
      </div>
    </div>
  );
}
