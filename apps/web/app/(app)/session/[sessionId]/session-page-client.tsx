"use client";

import { SessionProvider } from "@/components/providers/session-provider";
import { ChatContainer } from "@/components/chat/chat-container";

interface SessionPageClientProps {
  sessionId: string;
}

export function SessionPageClient({ sessionId }: SessionPageClientProps) {
  return (
    <SessionProvider sessionId={sessionId}>
      <ChatContainer sessionId={sessionId} />
    </SessionProvider>
  );
}
