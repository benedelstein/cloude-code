"use client";

import { SessionProvider } from "@/components/providers/session-provider";
import { ChatContainer } from "@/components/chat/chat-container";
import { SessionRightSidebar } from "@/components/sidebar/session-right-sidebar";

interface SessionPageClientProps {
  sessionId: string;
}

export function SessionPageClient({
  sessionId,
}: SessionPageClientProps) {
  return (
    <SessionProvider sessionId={sessionId}>
      <SessionRightSidebar />
      <ChatContainer sessionId={sessionId} />
    </SessionProvider>
  );
}
