"use client";

import type { UIMessage } from "ai";
import { MessageList } from "@/components/chat/message-list";

const messages: UIMessage[] = [
  {
    id: "qa-assistant-message",
    role: "assistant",
    parts: [
      {
        type: "text",
        text: "Hi! How can I help?",
      },
    ],
  },
];

export default function WorkingIndicatorQaPage() {
  return (
    <main className="h-screen bg-background-secondary">
      <MessageList
        messages={messages}
        streamingMessage={null}
        isResponding
      />
    </main>
  );
}
